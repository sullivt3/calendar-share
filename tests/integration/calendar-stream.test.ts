import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, expect, it } from "vitest";
import { auth } from "../../src/server/auth";
import { db } from "../../src/server/db";
import { createSpace, invite, acceptInvitation, setSharing, leaveSpace } from "../../src/server/spaces";
import { calendarStream } from "../../src/server/calendar-stream";
import { GET as eventsGET } from "../../src/app/api/spaces/[spaceId]/events/route";
const origin = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const query = "?start=2026-11-01T00:00:00Z&end=2026-12-01T00:00:00Z";
const emails = [`stream-a-${randomUUID()}@example.test`, `stream-b-${randomUUID()}@example.test`];
const users: string[] = [], cookies: string[] = [];
let space = "", calendar = "", event = "";
beforeAll(async () => {
  for (const email of emails) {
    const response = await auth.api.signUpEmail({ body: { email, name: "Stream Test", password: "stream-only-password" }, asResponse: true });
    cookies.push(response.headers.getSetCookie().map(v => v.split(";")[0]).join("; "));
    users.push((await db.user.findUniqueOrThrow({ where: { email } })).id);
  }
  space = (await createSpace(users[0], "Stream space")).id;
  await acceptInvitation(users[1], (await invite(users[0], space)).token);
  const connection = await db.providerConnection.create({ data: { userId: users[0], provider: "MOCK", externalId: randomUUID() } });
  calendar = (await db.calendar.create({ data: { connectionId: connection.id, externalId: randomUUID(), name: "Shared metadata" } })).id;
  event = (await db.event.create({ data: { calendarId: calendar, externalId: "provider-secret", title: "NEVER_SEND_TITLE", location: "NEVER_SEND_LOCATION", description: "NEVER_SEND_DESCRIPTION", privacy: "PRIVATE", start: new Date("2026-11-03T12:00:00Z"), end: new Date("2026-11-03T13:00:00Z") } })).id;
  await setSharing(users[0], space, calendar, "FULL_DETAILS", true);
});
afterAll(async () => {
  await db.sharedSpace.deleteMany({ where: { id: space } });
  await db.user.deleteMany({ where: { email: { in: emails } } }); await db.$disconnect();
});
const req = (cookie?: string, signal?: AbortSignal) => new Request(origin + "/api/spaces/" + space + "/stream" + query, { headers: cookie ? { cookie } : {}, signal });
const decode = new TextDecoder();
async function frame(reader: ReadableStreamDefaultReader<Uint8Array>, match: string) {
  for (let i = 0; i < 30; i++) {
    const read = await reader.read(); if (read.done) throw new Error("Stream ended early");
    const text = decode.decode(read.value);
    expect(text).not.toContain("NEVER_SEND");
    if (text.includes(match)) return text;
  }
  throw new Error("Expected stream signal was not received");
}
it("uses no-store REST serialization and requires authorization before streaming", async () => {
  expect((await calendarStream(req(), space, 50)).status).toBe(401);
  const response = await eventsGET(new Request(origin + "/events" + query, { headers: { cookie: cookies[1] } }), { params: Promise.resolve({ spaceId: space }) });
  expect(response.headers.get("cache-control")).toContain("no-store");
  const json = await response.json();
  expect(JSON.stringify(json)).not.toContain("NEVER_SEND");
  expect(json.events[0].title).toBe("Busy");
  const unauthorized = await eventsGET(new Request(origin + "/events" + query), { params: Promise.resolve({ spaceId: space }) });
  expect(unauthorized.status).toBe(401);
});
it("sends data-free change signals, ignores private-title changes and revokes departed members", async () => {
  const abort = new AbortController();
  const response = await calendarStream(req(cookies[1], abort.signal), space, 80);
  expect(response.headers.get("content-type")).toBe("text/event-stream");
  const reader = response.body!.getReader();
  try {
    expect(await frame(reader, "event: invalidate")).toBe(`event: invalidate\ndata: {}\n\n`);
    await db.event.update({ where: { id: event }, data: { title: "NEVER_SEND_CHANGED_TITLE" } });
    expect(await frame(reader, "keep-alive")).toContain(": keep-alive");
    const added = await db.event.create({ data: {
      calendarId: calendar, externalId: randomUUID(), title: "NEVER_SEND_NEW_EVENT",
      start: new Date("2026-11-03T14:00:00Z"), end: new Date("2026-11-03T15:00:00Z"), privacy: "PUBLIC",
    } });
    await frame(reader, "event: invalidate");
    await db.event.delete({ where: { id: added.id } });
    await frame(reader, "event: invalidate");
    await db.event.update({ where: { id: event }, data: { start: new Date("2026-11-03T12:30:00Z") } });
    await frame(reader, "event: invalidate");
    await setSharing(users[0], space, calendar, "NOT_SHARED");
    await frame(reader, "event: invalidate");
    await leaveSpace(users[1], space);
    await frame(reader, "event: revoked");
    expect((await reader.read()).done).toBe(true);
  } finally { abort.abort(); await reader.cancel(); }
});
it("revalidates the session while a connection is open", async () => {
  const abort = new AbortController();
  const response = await calendarStream(req(cookies[0], abort.signal), space, 80);
  const reader = response.body!.getReader();
  try {
    await frame(reader, "event: invalidate");
    await db.session.deleteMany({ where: { userId: users[0] } });
    await frame(reader, "event: revoked");
    expect((await reader.read()).done).toBe(true);
  } finally { abort.abort(); await reader.cancel(); }
});
