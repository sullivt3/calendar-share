import { randomUUID } from "node:crypto";
import { db } from "../db";
import { seal, unseal } from "../credentials";
import { fenced } from "../sync/queue";
import { CancelledJob } from "../google/errors";
import { rollingWindow } from "../google/normalize";
import { disableCalendar } from "../sync/discovery";
import { microsoftEventSchema } from "./contracts";
import { normalizeMicrosoftEvent } from "./normalize";
import { MicrosoftError } from "./errors";
import type { MicrosoftJobContext } from "./context";
import type { Prisma } from "../../generated/prisma/client";
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
function read(value: string | null, context: string) {
  if (!value) return undefined;
  const result = unseal(value, context); if (typeof result !== "string") throw new MicrosoftError("INVALID_DATA"); return result;
}
export async function syncMicrosoftCalendar(ctx: MicrosoftJobContext, resetAllowed = true): Promise<void> {
  const calendar = await ctx.calendar(), prefix = "microsoft:sync:" + calendar.id, window = rollingWindow();
  let state = await fenced(ctx.lease, async tx => {
    const previous = await tx.syncState.upsert({ where: { calendarId: calendar.id }, create: { calendarId: calendar.id }, update: {} });
    if (previous.phase !== "IDLE") return previous;
    const full = !calendar.isPrimary || !previous.syncTokenCiphertext || previous.windowStart?.getTime() !== window.start.getTime();
    return tx.syncState.update({ where: { calendarId: calendar.id }, data: { phase: "FETCH", fullSync: full,
      snapshotId: full ? randomUUID() : null, pageTokenCiphertext: null, pendingTokenCiphertext: null, pageCount: 0,
      targetWindowStart: window.start, targetWindowEnd: window.end } });
  });
  try {
    while (state.phase === "FETCH") {
      await ctx.calendar();
      const link = read(state.pageTokenCiphertext, prefix + ":page") ?? (!state.fullSync ? read(state.syncTokenCiphertext, prefix + ":cursor") : undefined);
      const range = { start: state.targetWindowStart!.toISOString(), end: state.targetWindowEnd!.toISOString() };
      const page = await ctx.use(token => calendar.isPrimary ? ctx.gateway.primaryDelta(token, range, link) : ctx.gateway.calendarView(token, calendar.externalId, range, link));
      const items = page.value.map(item => microsoftEventSchema.parse(item));
      const next = page["@odata.nextLink"], delta = page["@odata.deltaLink"];
      if (next === link && next || (calendar.isPrimary && !next && !delta)) throw new MicrosoftError("INVALID_DATA");
      state = await fenced(ctx.lease, async tx => {
        const current = await tx.calendar.findUniqueOrThrow({ where: { id: calendar.id } });
        if (!current.isEnabled || !current.syncEnabled) throw new CancelledJob();
        for (const item of items) await tx.sourceEvent.upsert({ where: { calendarId_externalId: { calendarId: calendar.id, externalId: item.id } },
          create: { calendarId: calendar.id, externalId: item.id, payload: json(item), snapshotId: state.snapshotId, dirty: true },
          update: { payload: json(item), dirty: true, ...(state.fullSync ? { snapshotId: state.snapshotId } : {}) } });
        if (state.pageCount >= 1000 || await tx.sourceEvent.count({ where: { calendarId: calendar.id, ...(state.fullSync ? { snapshotId: state.snapshotId } : {}) } }) > 50000) throw new MicrosoftError("DATA_LIMIT");
        if (!next && state.fullSync) await tx.sourceEvent.deleteMany({ where: { calendarId: calendar.id, OR: [{ snapshotId: null }, { snapshotId: { not: state.snapshotId! } }] } });
        return tx.syncState.update({ where: { calendarId: calendar.id }, data: { pageCount: { increment: 1 },
          pageTokenCiphertext: next ? seal(next, prefix + ":page") : null,
          ...(!next ? { phase: "MATERIALIZE", pendingTokenCiphertext: delta ? seal(delta, prefix + ":pending") : null } : {}) } });
      });
    }
    const records = await db.sourceEvent.findMany({ where: { calendarId: calendar.id, dirty: true } });
    for (let i = 0; i < records.length; i += 100) {
      await fenced(ctx.lease, async tx => {
        const current = await tx.calendar.findUniqueOrThrow({ where: { id: calendar.id } });
        if (!current.isEnabled || !current.syncEnabled) throw new CancelledJob();
        for (const record of records.slice(i, i + 100)) {
          const event = normalizeMicrosoftEvent(microsoftEventSchema.parse(record.payload));
          if (event) await tx.event.upsert({ where: { calendarId_externalId: { calendarId: calendar.id, externalId: record.externalId } }, create: { calendarId: calendar.id, ...event }, update: event });
          else await tx.event.deleteMany({ where: { calendarId: calendar.id, externalId: record.externalId } });
          await tx.sourceEvent.update({ where: { id: record.id }, data: { dirty: false } });
        }
      });
    }
    await fenced(ctx.lease, async tx => {
      const current = await tx.calendar.findUniqueOrThrow({ where: { id: calendar.id } });
      if (!current.isEnabled || !current.syncEnabled) throw new CancelledJob();
      if (state.fullSync) {
        const source = await tx.sourceEvent.findMany({ where: { calendarId: calendar.id }, select: { externalId: true } });
        await tx.event.deleteMany({ where: { calendarId: calendar.id, externalId: { notIn: source.map(s => s.externalId) } } });
      }
      if (await tx.event.count({ where: { calendarId: calendar.id } }) > 20000) throw new MicrosoftError("DATA_LIMIT");
      const pending = read(state.pendingTokenCiphertext, prefix + ":pending");
      if (calendar.isPrimary && !pending) throw new MicrosoftError("INVALID_DATA");
      await tx.syncState.update({ where: { calendarId: calendar.id }, data: { phase: "IDLE", fullSync: false,
        syncTokenCiphertext: pending ? seal(pending, prefix + ":cursor") : null, pendingTokenCiphertext: null, pageTokenCiphertext: null,
        windowStart: state.targetWindowStart, windowEnd: state.targetWindowEnd, lastSuccessAt: new Date(), snapshotId: null } });
      await tx.calendar.update({ where: { id: calendar.id }, data: { lastSyncedAt: new Date(), lastErrorCode: null, nextSyncAt: new Date(Date.now() + 15 * 60000) } });
      await tx.providerConnection.update({ where: { id: calendar.connectionId }, data: { status: "CONNECTED", lastErrorCode: null } });
    });
  } catch (error) {
    if (error instanceof MicrosoftError && error.code === "CURSOR_EXPIRED" && resetAllowed) {
      await fenced(ctx.lease, async tx => {
        await tx.event.deleteMany({ where: { calendarId: calendar.id } }); await tx.sourceEvent.deleteMany({ where: { calendarId: calendar.id } });
        await tx.syncState.deleteMany({ where: { calendarId: calendar.id } }); await tx.calendar.update({ where: { id: calendar.id }, data: { lastSyncedAt: null } });
      });
      return syncMicrosoftCalendar(ctx, false);
    }
    if (error instanceof MicrosoftError && ["ACCESS_DENIED", "NOT_FOUND"].includes(error.code)) {
      await fenced(ctx.lease, tx => disableCalendar(tx, calendar.id, calendar.connectionId, "ACCESS_DENIED")); return;
    }
    throw error;
  }
}
