import { db } from "./db";
import { SpaceError, lock, member } from "./spaces";
import { projectEvent } from "./event-projection";
import { rangeSchema, type CalendarRange, type CalendarInfo, type CalendarData } from "../shared/calendar";
export async function calendarData(userId: string, spaceId: string, input: CalendarRange): Promise<CalendarData> {
  const range = rangeSchema.parse(input);
  return db.$transaction(async tx => {
    await lock(tx, spaceId); await member(tx, userId, spaceId);
    const space = await tx.sharedSpace.findUniqueOrThrow({ where: { id: spaceId }, select: {
      id: true, name: true, members: { orderBy: [{ joinedAt: "asc" }, { userId: "asc" }], select: {
        user: { select: { id: true, name: true, preference: true } },
      } },
    } });
    const members = space.members.map(({ user }, i) => ({
      id: user.id, name: user.name, color: user.preference?.displayColor ?? (i === 0 ? "#2563eb" : "#8b5cf6"),
    }));
    const raw = await tx.calendar.findMany({ where: { OR: [
      { connection: { userId } },
      { connection: { user: { memberships: { some: { spaceId } } } }, shares: { some: { spaceId, mode: { not: "NOT_SHARED" } } } },
    ] }, select: {
      id: true, name: true, mockProvider: true, lastSyncedAt: true,
      connection: { select: { userId: true, provider: true } },
      shares: { where: { spaceId }, select: { mode: true, includeDescription: true } },
    }, orderBy: { id: "asc" } });
    const calendars: CalendarInfo[] = raw.map(c => {
      const owner = members.find(m => m.id === c.connection.userId);
      if (!owner) throw new SpaceError(404, "Calendar not found.");
      return {
        id: c.id, name: c.name, ownerId: owner.id, ownerName: owner.name, color: owner.color,
        provider: c.mockProvider ?? c.connection.provider, isMock: c.connection.provider === "MOCK",
        mode: c.shares[0]?.mode ?? "NOT_SHARED", includeDescription: c.shares[0]?.includeDescription ?? false,
        lastSyncedAt: c.lastSyncedAt?.toISOString() ?? null,
      };
    });
    const selected = calendars.filter(c => (!range.person || range.person === c.ownerId) &&
      (!range.calendar || range.calendar === c.id) && (!range.provider || range.provider === c.provider));
    const events = await tx.event.findMany({ where: {
      calendarId: { in: selected.map(c => c.id) }, cancelled: false,
      OR: [
        { allDay: false, start: { lt: new Date(range.end) }, end: { gt: new Date(range.start) } },
        { allDay: true, start: { lt: new Date(range.end.slice(0, 10) + "T00:00:00Z") },
          end: { gt: new Date(range.start.slice(0, 10) + "T00:00:00Z") } },
      ],
    }, orderBy: [{ start: "asc" }, { id: "asc" }], take: 2001 });
    if (events.length > 2000) throw new SpaceError(422, "Too many events. Choose a shorter date range.");
    const preference = space.members.find(m => m.user.id === userId)?.user.preference;
    return {
      space: { id: space.id, name: space.name }, members, calendars,
      events: events.map(e => projectEvent(e, selected.find(c => c.id === e.calendarId)!, userId)),
      preference: { displayColor: preference?.displayColor ?? null, theme: preference?.theme ?? "SYSTEM" },
    };
  }, { timeout: 10000 });
}
