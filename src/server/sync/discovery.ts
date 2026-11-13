import { GoogleError } from "../google/errors";
import { googleCalendarSchema, type GoogleCalendar } from "../google/contracts";
import { enqueue, fenced, type Tx } from "./queue";
import type { JobContext } from "./context";
export async function disableCalendar(tx: Tx, calendarId: string, connectionId: string, error: string | null = null) {
  await tx.calendar.update({ where: { id: calendarId }, data: { isEnabled: false, syncEnabled: false, lastErrorCode: error, lastSyncedAt: null } });
  await tx.calendarShare.deleteMany({ where: { calendarId } });
  await tx.event.deleteMany({ where: { calendarId } });
  await tx.sourceEvent.deleteMany({ where: { calendarId } });
  await tx.syncState.deleteMany({ where: { calendarId } });
  await enqueue(tx, "WATCH", connectionId, calendarId);
}
export async function discoverCalendars(ctx: JobContext) {
  await ctx.connection();
  const items: GoogleCalendar[] = [];
  const pages = new Set<string>();
  let page: string | undefined;
  do {
    const result = await ctx.use(token => ctx.gateway.calendars(token, page));
    items.push(...result.items.map(item => googleCalendarSchema.parse(item)));
    if (items.length > 1000) throw new GoogleError("DATA_LIMIT");
    page = result.nextPageToken;
    if (page && pages.has(page)) throw new GoogleError("INVALID_DATA");
    if (page) pages.add(page);
  } while (page);
  await fenced(ctx.lease, async tx => {
    const existing = await tx.calendar.findMany({ where: { connectionId: ctx.lease.connectionId } });
    const active = new Set<string>();
    for (const item of items) {
      if (item.deleted || !["owner", "writer", "writerWithoutPrivateAccess", "reader"].includes(item.accessRole ?? "")) continue;
      const zone = item.timeZone ?? "UTC";
      try { new Intl.DateTimeFormat("en", { timeZone: zone }).format(); } catch { throw new GoogleError("INVALID_DATA"); }
      active.add(item.id);
      const previous = existing.find(c => c.externalId === item.id);
      const calendar = await tx.calendar.upsert({
        where: { connectionId_externalId: { connectionId: ctx.lease.connectionId, externalId: item.id } },
        create: { connectionId: ctx.lease.connectionId, externalId: item.id, name: item.summary ?? "Google calendar", timeZone: zone, isEnabled: true, syncEnabled: false },
        update: { name: item.summary ?? "Google calendar", timeZone: zone, isEnabled: true,
          ...(previous?.lastErrorCode === "ACCESS_DENIED" ? { lastErrorCode: null } : {}) },
      });
      if (previous && previous.timeZone !== zone) {
        await tx.sourceEvent.updateMany({ where: { calendarId: calendar.id }, data: { dirty: true } });
        if (calendar.syncEnabled) await enqueue(tx, "SYNC", calendar.connectionId, calendar.id);
      }
    }
    for (const old of existing) if (!active.has(old.externalId) && (old.isEnabled || old.syncEnabled))
      await disableCalendar(tx, old.id, old.connectionId, "ACCESS_DENIED");
    await tx.providerConnection.update({ where: { id: ctx.lease.connectionId }, data: {
      status: "CONNECTED", lastErrorCode: null, nextDiscoveryAt: new Date(Date.now() + 6 * 3600000),
    } });
  });
}
