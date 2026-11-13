import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { db } from "../../src/server/db";
import { createSpace, invite, acceptInvitation, setSharing, leaveSpace } from "../../src/server/spaces";
import { calendarData } from "../../src/server/calendar";
import { loadMockCalendars } from "../../src/server/mock-calendars";
const users: string[] = [], spaces: string[] = [];
const range = { start: "2026-11-01T00:00:00Z", end: "2026-12-01T00:00:00Z" };
let space = "", other = "", calendar = "", eventId = "";
beforeAll(async () => {
  for (let i = 0; i < 3; i++) users.push((await db.user.create({ data: { name: "Calendar Test " + i, email: `calendar-${randomUUID()}@example.test` } })).id);
  space = (await createSpace(users[0], "Calendar privacy")).id; spaces.push(space);
  other = (await createSpace(users[0], "Other space")).id; spaces.push(other);
  await acceptInvitation(users[1], (await invite(users[0], space)).token);
  await acceptInvitation(users[2], (await invite(users[0], other)).token);
  const connection = await db.providerConnection.create({ data: { userId: users[0], provider: "MOCK", externalId: randomUUID() } });
  calendar = (await db.calendar.create({ data: { connectionId: connection.id, externalId: randomUUID(), name: "Private calendar", mockProvider: "GOOGLE" } })).id;
  eventId = (await db.event.create({ data: { calendarId: calendar, externalId: "provider-secret", title: "SECRET_EVENT", start: new Date("2026-11-05T14:00:00Z"), end: new Date("2026-11-05T15:00:00Z"), privacy: "PUBLIC", description: "SECRET_DESCRIPTION", location: "SECRET_LOCATION" } })).id;
});
afterAll(async () => {
  await db.sharedSpace.deleteMany({ where: { id: { in: spaces } } });
  await db.user.deleteMany({ where: { id: { in: users } } }); await db.$disconnect();
});
it("authorizes before reading events and defaults all calendars to private", async () => {
  await expect(calendarData(users[2], space, range)).rejects.toMatchObject({ status: 404 });
  expect((await calendarData(users[1], space, range)).events).toHaveLength(0);
  expect((await calendarData(users[0], space, range)).events[0].title).toBe("SECRET_EVENT");
});
it("redacts in the API service, isolates spaces, and revokes without deleting cached events", async () => {
  await setSharing(users[0], space, calendar, "BUSY_ONLY");
  expect(JSON.stringify((await calendarData(users[1], space, range)).events)).not.toContain("SECRET");
  expect((await calendarData(users[2], other, range)).events).toHaveLength(0);
  await setSharing(users[0], space, calendar, "FULL_DETAILS");
  const full = (await calendarData(users[1], space, range)).events[0];
  expect(full.title).toBe("SECRET_EVENT"); expect(full).not.toHaveProperty("description");
  await setSharing(users[0], space, calendar, "FULL_DETAILS", true);
  expect((await calendarData(users[1], space, range)).events[0]).toHaveProperty("description", "SECRET_DESCRIPTION");
  await db.event.update({ where: { id: eventId }, data: { privacy: "PRIVATE" } });
  expect(JSON.stringify((await calendarData(users[1], space, range)).events)).not.toContain("SECRET");
  await setSharing(users[0], space, calendar, "NOT_SHARED");
  expect((await calendarData(users[1], space, range)).events).toHaveLength(0);
  expect(await db.event.count({ where: { id: eventId } })).toBe(1);
});
it("handles overlap, cancellation, all-day dates, and server-side filters", async () => {
  const connection = await db.calendar.findUniqueOrThrow({ where: { id: calendar } });
  const cancelled = await db.event.create({ data: { calendarId: calendar, externalId: randomUUID(), title: "Cancelled secret", start: new Date("2026-11-05T00:00:00Z"), end: new Date("2026-11-06T00:00:00Z"), allDay: true, cancelled: true } });
  const spanning = await db.event.create({ data: { calendarId: calendar, externalId: randomUUID(), title: "Spanning", start: new Date("2026-10-31T23:00:00Z"), end: new Date("2026-11-01T02:00:00Z") } });
  const allDay = await db.event.create({ data: { calendarId: calendar, externalId: randomUUID(), title: "All day", start: new Date("2026-11-01T00:00:00Z"), end: new Date("2026-11-02T00:00:00Z"), allDay: true } });
  const data = await calendarData(users[0], space, { ...range, provider: "GOOGLE", calendar: connection.id });
  expect(data.events.some(e => e.id === spanning.id)).toBe(true);
  expect(data.events.some(e => e.id === cancelled.id)).toBe(false);
  expect(data.events.find(e => e.id === allDay.id)?.end).toBe("2026-11-02");
  expect((await calendarData(users[0], space, { ...range, person: users[1] })).events).toHaveLength(0);
  expect((await calendarData(users[0], space, { ...range, provider: "APPLE" })).events).toHaveLength(0);
  expect((await calendarData(users[0], space, { start: "2026-11-01T00:00:00+14:00", end: "2026-11-02T00:00:00+14:00" })).events.some(e => e.id === allDay.id)).toBe(true);
});
it("loads idempotent, marked, owner-private samples and rejects outsider/prod access", async () => {
  process.env.ENABLE_MOCK_CALENDARS = "true";
  await expect(loadMockCalendars(users[2], space)).rejects.toMatchObject({ status: 404 });
  await loadMockCalendars(users[1], space);
  const count = await db.event.count();
  await loadMockCalendars(users[1], space);
  expect(await db.event.count()).toBe(count);
  expect(await db.calendar.count({ where: { connection: { userId: users[1] } } })).toBe(3);
  expect(await db.calendarShare.count({ where: { calendar: { connection: { userId: users[1] } } } })).toBe(0);
  vi.stubEnv("NODE_ENV", "production");
  try { await expect(loadMockCalendars(users[1], space)).rejects.toMatchObject({ status: 403 }); }
  finally { vi.unstubAllEnvs(); }
  process.env.ENABLE_MOCK_CALENDARS = "false";
  await expect(loadMockCalendars(users[1], space)).rejects.toMatchObject({ status: 403 });
});
it("blocks a departed member immediately", async () => {
  await leaveSpace(users[1], space);
  await expect(calendarData(users[1], space, range)).rejects.toMatchObject({ status: 404 });
});
