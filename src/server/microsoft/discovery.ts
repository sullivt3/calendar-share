import { enqueue, fenced } from "../sync/queue";
import { disableCalendar } from "../sync/discovery";
import { MicrosoftError } from "./errors";
import type { MicrosoftJobContext } from "./context";
export async function discoverMicrosoftCalendars(ctx: MicrosoftJobContext) {
  const primary = await ctx.use(token => ctx.gateway.defaultCalendar(token));
  if (!primary.owner?.address) throw new MicrosoftError("INVALID_DATA");
  const owner = primary.owner.address.toLowerCase(), items = [primary], seen = new Set<string>();
  let link: string | undefined;
  do {
    const page = await ctx.use(token => ctx.gateway.calendars(token, link)); items.push(...page.value);
    if (items.length > 1000) throw new MicrosoftError("DATA_LIMIT");
    link = page["@odata.nextLink"]; if (link && seen.has(link)) throw new MicrosoftError("INVALID_DATA"); if (link) seen.add(link);
  } while (link);
  await fenced(ctx.lease, async tx => {
    const existing = await tx.calendar.findMany({ where: { connectionId: ctx.lease.connectionId } });
    const active = new Set<string>();
    for (const item of items) {
      if (item.owner?.address?.toLowerCase() !== owner) continue; // Delegated/shared mailboxes are outside this read grant.
      active.add(item.id);
      const previous = existing.find(c => c.externalId === item.id);
      const calendar = await tx.calendar.upsert({ where: { connectionId_externalId: { connectionId: ctx.lease.connectionId, externalId: item.id } },
        create: { connectionId: ctx.lease.connectionId, externalId: item.id, name: item.name ?? "Outlook calendar", isPrimary: item.id === primary.id },
        update: { name: item.name ?? "Outlook calendar", isEnabled: true, isPrimary: item.id === primary.id } });
      if (previous && previous.isPrimary !== calendar.isPrimary) {
        await tx.syncState.deleteMany({ where: { calendarId: calendar.id } });
        await tx.calendar.update({ where: { id: calendar.id }, data: { lastSyncedAt: null } });
        if (calendar.syncEnabled) await enqueue(tx, "SYNC", calendar.connectionId, calendar.id);
      }
    }
    const previous = await tx.calendar.findMany({ where: { connectionId: ctx.lease.connectionId } });
    for (const item of previous) if (!active.has(item.externalId) && item.isEnabled) await disableCalendar(tx, item.id, item.connectionId, "ACCESS_DENIED");
    await tx.providerConnection.update({ where: { id: ctx.lease.connectionId }, data: { status: "CONNECTED", lastErrorCode: null, nextDiscoveryAt: new Date(Date.now() + 6 * 3600000) } });
  });
}
