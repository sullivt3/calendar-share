import { randomUUID } from "node:crypto";
import { db } from "../db";
import { seal, unseal } from "../credentials";
import { GoogleError, CancelledJob } from "../google/errors";
import { googleEventSchema } from "../google/contracts";
import { normalizeGoogleEvent, rollingWindow } from "../google/normalize";
import { fenced } from "./queue";
import { disableCalendar } from "./discovery";
import type { JobContext } from "./context";
import type { Prisma } from "../../generated/prisma/client";
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
function cursor(value: string | null, context: string): string | undefined {
  if (!value) return undefined;
  const result = unseal(value, context);
  if (typeof result !== "string") throw new GoogleError("INVALID_DATA");
  return result;
}
export async function syncCalendar(ctx: JobContext, canReset = true): Promise<void> {
  const calendar = await ctx.calendar();
  const context = "sync:" + calendar.id;
  let state = await fenced(ctx.lease, async tx => {
    const previous = await tx.syncState.upsert({ where: { calendarId: calendar.id }, create: { calendarId: calendar.id }, update: {} });
    if (previous.phase !== "IDLE") return previous;
    const window = rollingWindow();
    if (!previous.windowStart || previous.windowStart.getTime() !== window.start.getTime())
      await tx.sourceEvent.updateMany({ where: { calendarId: calendar.id }, data: { dirty: true } });
    return tx.syncState.update({ where: { calendarId: calendar.id }, data: {
      phase: "FETCH", fullSync: !previous.syncTokenCiphertext, snapshotId: previous.syncTokenCiphertext ? null : randomUUID(),
      pageTokenCiphertext: null, pendingTokenCiphertext: null, pageCount: 0,
      targetWindowStart: window.start, targetWindowEnd: window.end,
    } });
  });
  try {
    while (state.phase === "FETCH") {
      await ctx.calendar();
      const base = cursor(state.syncTokenCiphertext, context + ":cursor");
      const page = cursor(state.pageTokenCiphertext, context + ":page");
      const result = await ctx.use(token => ctx.gateway.events(token, calendar.externalId, base, page));
      const items = result.items.map(item => googleEventSchema.parse(item));
      if (!result.nextPageToken && !result.nextSyncToken) throw new GoogleError("INVALID_DATA");
      if (result.nextPageToken && result.nextPageToken === page) throw new GoogleError("INVALID_DATA");
      state = await fenced(ctx.lease, async tx => {
        const current = await tx.calendar.findUniqueOrThrow({ where: { id: calendar.id } });
        if (!current.syncEnabled || !current.isEnabled) throw new CancelledJob();
        for (const item of items) await tx.sourceEvent.upsert({
          where: { calendarId_externalId: { calendarId: calendar.id, externalId: item.id } },
          create: { calendarId: calendar.id, externalId: item.id, payload: json(item), snapshotId: state.snapshotId, dirty: true },
          update: { payload: json(item), dirty: true, ...(state.fullSync ? { snapshotId: state.snapshotId } : {}) },
        });
        if (await tx.sourceEvent.count({ where: { calendarId: calendar.id, ...(state.fullSync ? { snapshotId: state.snapshotId } : {}) } }) > 50000 || state.pageCount >= 1000) throw new GoogleError("DATA_LIMIT");
        const next = await tx.syncState.update({ where: { calendarId: calendar.id }, data: {
          pageCount: { increment: 1 },
          pageTokenCiphertext: result.nextPageToken ? seal(result.nextPageToken, context + ":page") : null,
          ...(!result.nextPageToken ? { phase: "MATERIALIZE", pendingTokenCiphertext: seal(result.nextSyncToken!, context + ":pending") } : {}),
        } });
        if (!result.nextPageToken && state.fullSync) await tx.sourceEvent.deleteMany({
          where: { calendarId: calendar.id, OR: [{ snapshotId: null }, { snapshotId: { not: state.snapshotId! } }] },
        });
        return next;
      });
    }
    await ctx.calendar();
    const records = await db.sourceEvent.findMany({ where: { calendarId: calendar.id } });
    const all = new Map(records.map(record => [record.externalId, googleEventSchema.parse(record.payload)]));
    const dirty = records.filter(r => state.fullSync || r.dirty);
    const series = new Set<string>(), seen = new Set<string>();
    for (const record of dirty) {
      const item = all.get(record.externalId)!;
      if (item.recurringEventId) { series.add(item.recurringEventId); continue; }
      if (item.recurrence?.length && item.status !== "cancelled") { series.add(item.id); continue; }
      const normalized = normalizeGoogleEvent(item, calendar.timeZone);
      await fenced(ctx.lease, async tx => {
        const current = await tx.calendar.findUniqueOrThrow({ where: { id: calendar.id } });
        if (!current.syncEnabled || !current.isEnabled) throw new CancelledJob();
        await tx.event.deleteMany({ where: { calendarId: calendar.id, seriesId: item.id } });
        if (normalized) await tx.event.upsert({
          where: { calendarId_externalId: { calendarId: calendar.id, externalId: item.id } },
          create: { calendarId: calendar.id, ...normalized }, update: normalized,
        });
        else await tx.event.deleteMany({ where: { calendarId: calendar.id, externalId: item.id } });
        await tx.sourceEvent.update({ where: { id: record.id }, data: { dirty: false } });
      });
      if (normalized) seen.add(item.id);
      if (seen.size > 20000) throw new GoogleError("DATA_LIMIT");
    }
    for (const masterId of series) {
      await ctx.calendar();
      let master = all.get(masterId);
      if (!master) {
        try { master = googleEventSchema.parse(await ctx.use(token => ctx.gateway.event(token, calendar.externalId, masterId))); }
        catch (e) { if (e instanceof GoogleError && ["NOT_FOUND", "CURSOR_EXPIRED"].includes(e.code)) master = { id: masterId, status: "cancelled" }; else throw e; }
      }
      const expanded = new Map<string, ReturnType<typeof normalizeGoogleEvent>>();
      if (master.status !== "cancelled" && master.recurrence?.length) {
        let page: string | undefined;
        const pages = new Set<string>();
        do {
          const result = await ctx.use(token => ctx.gateway.instances(token, calendar.externalId, masterId,
            state.targetWindowStart!.toISOString(), state.targetWindowEnd!.toISOString(), page));
          for (const raw of result.items) {
            const item = googleEventSchema.parse(raw);
            if (item.recurringEventId && item.recurringEventId !== masterId) throw new GoogleError("INVALID_DATA");
            expanded.set(item.id, normalizeGoogleEvent({ ...item, recurringEventId: masterId }, calendar.timeZone, master));
          }
          if (expanded.size > 20000 || pages.size >= 1000) throw new GoogleError("DATA_LIMIT");
          page = result.nextPageToken;
          if (page && pages.has(page)) throw new GoogleError("INVALID_DATA");
          if (page) pages.add(page);
        } while (page);
      }
      const active = [...expanded.values()].filter((value): value is NonNullable<typeof value> => !!value);
      for (let offset = 0; offset < active.length; offset += 100) {
        await fenced(ctx.lease, async tx => {
          const current = await tx.calendar.findUniqueOrThrow({ where: { id: calendar.id } });
          if (!current.syncEnabled || !current.isEnabled) throw new CancelledJob();
          for (const item of active.slice(offset, offset + 100)) await tx.event.upsert({
            where: { calendarId_externalId: { calendarId: calendar.id, externalId: item.externalId } },
            create: { calendarId: calendar.id, ...item }, update: item,
          });
        });
      }
      active.forEach(item => seen.add(item.externalId));
      if (seen.size > 20000) throw new GoogleError("DATA_LIMIT");
      await fenced(ctx.lease, async tx => {
        const current = await tx.calendar.findUniqueOrThrow({ where: { id: calendar.id } });
        if (!current.syncEnabled || !current.isEnabled) throw new CancelledJob();
        await tx.event.deleteMany({ where: { calendarId: calendar.id, OR: [
          { externalId: masterId }, // A former one-off may have become a recurring master.
          { seriesId: masterId, externalId: { notIn: active.map(item => item.externalId) } },
        ] } });
        const done = records.filter(record => {
          const item = all.get(record.externalId)!;
          return item.id === masterId || item.recurringEventId === masterId;
        }).map(record => record.id);
        await tx.sourceEvent.updateMany({ where: { id: { in: done } }, data: { dirty: false } });
      });
    }
    await fenced(ctx.lease, async tx => {
      const current = await tx.calendar.findUniqueOrThrow({ where: { id: calendar.id } });
      if (!current.syncEnabled || !current.isEnabled) throw new CancelledJob();
      if (state.fullSync) await tx.event.deleteMany({ where: { calendarId: calendar.id, externalId: { notIn: [...seen] } } });
      const pending = cursor(state.pendingTokenCiphertext, context + ":pending");
      if (!pending) throw new GoogleError("INVALID_DATA");
      await tx.syncState.update({ where: { calendarId: calendar.id }, data: {
        phase: "IDLE", syncTokenCiphertext: seal(pending, context + ":cursor"), pendingTokenCiphertext: null,
        pageTokenCiphertext: null, snapshotId: null, fullSync: false,
        windowStart: state.targetWindowStart, windowEnd: state.targetWindowEnd, lastSuccessAt: new Date(),
      } });
      await tx.calendar.update({ where: { id: calendar.id }, data: { lastSyncedAt: new Date(),
        nextSyncAt: new Date(Date.now() + 15 * 60000), lastErrorCode: null } });
      await tx.providerConnection.update({ where: { id: ctx.lease.connectionId }, data: { status: "CONNECTED", lastErrorCode: null } });
    });
  } catch (error) {
    if (error instanceof GoogleError && error.code === "CURSOR_EXPIRED" && canReset) {
      await fenced(ctx.lease, async tx => {
        await tx.event.deleteMany({ where: { calendarId: calendar.id } });
        await tx.sourceEvent.deleteMany({ where: { calendarId: calendar.id } });
        await tx.syncState.deleteMany({ where: { calendarId: calendar.id } });
        await tx.calendar.update({ where: { id: calendar.id }, data: { lastSyncedAt: null } });
      });
      return syncCalendar(ctx, false);
    }
    if (error instanceof GoogleError && ["NOT_FOUND", "ACCESS_DENIED"].includes(error.code)) {
      await fenced(ctx.lease, tx => disableCalendar(tx, calendar.id, calendar.connectionId, "ACCESS_DENIED"));
      return;
    }
    throw error;
  }
}
