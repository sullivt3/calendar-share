import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, afterEach, expect, it, vi } from "vitest";
import { db } from "../../src/server/db";
import { seal, unseal } from "../../src/server/credentials";
import { GOOGLE_SCOPES } from "../../src/server/google/contracts";
import { GoogleError, LostLease } from "../../src/server/google/errors";
import { selectGoogleCalendar, disconnectGoogle, listConnections } from "../../src/server/connections";
import { enqueue, claimJob, fenced, finishJob } from "../../src/server/sync/queue";
import { runOne } from "../../src/server/sync/runner";
import { createSpace, invite, acceptInvitation, setSharing } from "../../src/server/spaces";
import { calendarData } from "../../src/server/calendar";
import { googleNotification } from "../../src/server/google/webhook";
import { FakeGoogle, sampleGoogleEvent } from "../fixtures/google";
import { googleTestEnvironment } from "../fixtures/google-env";
const users: string[] = [];
beforeAll(googleTestEnvironment);
afterEach(async () => { await db.user.deleteMany({ where: { id: { in: users.splice(0) } } }); });
afterAll(async () => { await db.$disconnect(); vi.unstubAllEnvs(); });
async function fixture(selected = true, expired = false) {
  const fake = new FakeGoogle();
  const user = await db.user.create({ data: { name: "Google sync test", email: randomUUID() + "@example.test" } }); users.push(user.id);
  const id = randomUUID();
  const connection = await db.providerConnection.create({ data: { id, userId: user.id, provider: "GOOGLE", externalId: randomUUID(),
    credentialCiphertext: seal({ ...fake.tokens(), expiresAt: expired ? 0 : Date.now() + 3600000 }, "connection:" + id), grantedScopes: GOOGLE_SCOPES.join(" ") } });
  const calendar = await db.calendar.create({ data: { connectionId: id, externalId: fake.calendarsData[0].id, name: "Google test", timeZone: "America/New_York", syncEnabled: selected } });
  const queue = async (kind: "SYNC" | "WATCH" | "DISCOVER" = "SYNC") => db.$transaction(tx => enqueue(tx, kind, id, kind === "DISCOVER" ? null : calendar.id));
  const work = async () => { expect(await runOne(() => fake)).toBe(true); };
  const retry = async () => { await db.syncJob.updateMany({ where: { connectionId: id }, data: { runAt: new Date(0) } }); await db.providerConnection.update({ where: { id }, data: { nextAllowedAt: new Date(0) } }); };
  return { fake, user, connection, calendar, queue, work, retry };
}
it("discovers paginated readable calendars without selecting or sharing them", async () => {
  const f = await fixture(false); await f.queue("DISCOVER"); await f.work();
  const calendars = await db.calendar.findMany({ where: { connectionId: f.connection.id } });
  expect(calendars).toHaveLength(2); expect(calendars.every(c => !c.syncEnabled)).toBe(true);
  expect(await db.calendarShare.count({ where: { calendar: { connectionId: f.connection.id } } })).toBe(0);
  f.fake.calendarsData = []; await f.queue("DISCOVER"); await f.work();
  expect(await db.calendar.count({ where: { connectionId: f.connection.id, isEnabled: true } })).toBe(0);
});
it("checkpoints pagination, refreshes encrypted credentials and resumes without duplicates", async () => {
  const f = await fixture(true, true); f.fake.source.push(sampleGoogleEvent("second")); f.fake.failSecondPage = true;
  await f.queue(); await f.work();
  const state = await db.syncState.findUniqueOrThrow({ where: { calendarId: f.calendar.id } });
  expect(state.phase).toBe("FETCH"); expect(state.syncTokenCiphertext).toBeNull();
  expect(state.pageTokenCiphertext).not.toContain("events-page-2"); expect(f.fake.refreshed).toBe(1);
  expect(await db.event.count({ where: { calendarId: f.calendar.id } })).toBe(0);
  await f.retry(); await f.work();
  expect(await db.event.count({ where: { calendarId: f.calendar.id } })).toBe(2);
  expect(f.fake.eventCalls.map(c => c.page)).toEqual([undefined, "events-page-2", "events-page-2"]);
  const complete = await db.syncState.findUniqueOrThrow({ where: { calendarId: f.calendar.id } });
  expect(unseal(complete.syncTokenCiphertext!, "sync:" + f.calendar.id + ":cursor")).toBe("cursor-1");
  expect(complete.phase).toBe("IDLE");
  expect((await db.providerConnection.findUniqueOrThrow({ where: { id: f.connection.id } })).credentialCiphertext).not.toContain("REFRESHED");
});
it("normalizes recurrence, DST exceptions and incremental deletions idempotently", async () => {
  const f = await fixture();
  const master = sampleGoogleEvent("series", { recurrence: ["RRULE:FREQ=WEEKLY;COUNT=3"], visibility: "private" });
  f.fake.source = [sampleGoogleEvent(), master];
  f.fake.series.series = [sampleGoogleEvent("instance", { recurringEventId: "series", originalStartTime: { dateTime: "2026-11-08T01:30:00-05:00" }, start: { dateTime: "2026-11-08T01:30:00-05:00" }, end: { dateTime: "2026-11-08T02:00:00-05:00" } }), { id: "cancelled-instance", status: "cancelled" }];
  await f.queue(); await f.work();
  const instance = await db.event.findUniqueOrThrow({ where: { calendarId_externalId: { calendarId: f.calendar.id, externalId: "instance" } } });
  expect(instance.privacy).toBe("PRIVATE"); expect(instance.start.toISOString()).toBe("2026-11-08T06:30:00.000Z");
  expect(f.fake.instanceCalls).toHaveLength(1);
  f.fake.delta = [sampleGoogleEvent("single", { summary: "Updated" }), { id: "series", status: "cancelled" }]; f.fake.revision++;
  await f.queue(); await f.work(); await f.queue(); await f.work();
  const events = await db.event.findMany({ where: { calendarId: f.calendar.id } });
  expect(events).toHaveLength(1); expect(events[0].title).toBe("Updated");
});
it("resets an expired cursor and removes stale records before a replacement full sync", async () => {
  const f = await fixture(); await f.queue(); await f.work();
  const original = f.fake.events.bind(f.fake);
  f.fake.events = async (token, calendar, cursor, page) => { if (cursor) throw new GoogleError("CURSOR_EXPIRED"); return original(token, calendar, cursor, page); };
  f.fake.source = [sampleGoogleEvent("replacement")]; f.fake.revision++;
  await f.queue(); await f.work();
  expect((await db.event.findMany({ where: { calendarId: f.calendar.id } })).map(e => e.externalId)).toEqual(["replacement"]);
  expect(await db.sourceEvent.count({ where: { calendarId: f.calendar.id } })).toBe(1);
});
it("persists quota backoff and hides revoked grants while purging their tokens", async () => {
  const f = await fixture(); f.fake.failures.events = new GoogleError("RATE_LIMIT", 60000);
  await f.queue(); await f.work();
  const connection = await db.providerConnection.findUniqueOrThrow({ where: { id: f.connection.id } });
  expect(connection.nextAllowedAt.getTime()).toBeGreaterThan(Date.now() + 50000);
  expect(await runOne(() => f.fake)).toBe(false);
  delete f.fake.failures.events; await f.retry(); await f.work();
  await db.providerConnection.update({ where: { id: f.connection.id }, data: { credentialCiphertext: seal({ ...f.fake.tokens(), expiresAt: 0 }, "connection:" + f.connection.id) } });
  f.fake.failures.refresh = new GoogleError("REAUTH_REQUIRED"); await f.queue(); await f.work();
  expect(await db.providerConnection.findUnique({ where: { id: f.connection.id } })).toMatchObject({ status: "REAUTH_REQUIRED", credentialCiphertext: null });
});
it("serializes each connection, recovers expired leases and fences stale workers", async () => {
  const f = await fixture(); await f.queue(); await f.queue("DISCOVER");
  const leases = await Promise.all([claimJob(), claimJob()]); const first = leases.find(l => !!l)!;
  expect(leases.filter(Boolean)).toHaveLength(1);
  await db.syncJob.update({ where: { id: first.id }, data: { leaseUntil: new Date(0) } });
  await db.providerConnection.update({ where: { id: f.connection.id }, data: { leaseUntil: new Date(0) } });
  const second = (await claimJob())!; expect(second.token).not.toBe(first.token);
  await expect(fenced(first, async () => true)).rejects.toBeInstanceOf(LostLease);
  await db.$transaction(tx => enqueue(tx, second.kind, second.connectionId, second.calendarId));
  await finishJob(second);
  expect(await db.syncJob.findUnique({ where: { id: second.id } })).toMatchObject({ status: "PENDING" });
});
it("rejects foreign selection and purges imports and grants on disconnect", async () => {
  const f = await fixture(); await f.queue(); await f.work();
  await expect(selectGoogleCalendar(randomUUID(), f.connection.id, f.calendar.id, false)).rejects.toMatchObject({ status: 404 });
  await selectGoogleCalendar(f.user.id, f.connection.id, f.calendar.id, false);
  expect(await db.event.count({ where: { calendarId: f.calendar.id } })).toBe(0);
  expect(await db.syncState.count({ where: { calendarId: f.calendar.id } })).toBe(0);
  expect((await db.calendar.findUniqueOrThrow({ where: { id: f.calendar.id } })).lastSyncedAt).toBeNull();
  await disconnectGoogle(f.user.id, f.connection.id);
  expect((await listConnections(f.user.id)).connections[0].status).toBe("DISCONNECTING");
  await f.work(); expect(f.fake.revoked).toBe(1);
  expect(await db.providerConnection.findUnique({ where: { id: f.connection.id } })).toMatchObject({ status: "DISCONNECTED", credentialCiphertext: null });
  expect(await db.calendar.count({ where: { connectionId: f.connection.id } })).toBe(0);
});
it("verifies early notifications, deduplicates replays and renews/stops channels", async () => {
  const f = await fixture(); let headers: Record<string, string> = {};
  f.fake.onWatch = async (channel, resource) => {
    headers = { "x-goog-channel-id": channel.id, "x-goog-channel-token": channel.token, "x-goog-resource-id": resource, "x-goog-resource-state": "sync", "x-goog-message-number": "1" };
    expect((await googleNotification(new Request("https://calendar.example.test", { method: "POST", headers }))).status).toBe(204);
  };
  await f.queue("WATCH"); await f.work();
  const subscription = await db.syncSubscription.findFirstOrThrow({ where: { connectionId: f.connection.id } });
  expect(subscription.status).toBe("ACTIVE"); expect(subscription.tokenHash).not.toBe(headers["x-goog-channel-token"]);
  const before = await db.syncJob.findFirstOrThrow({ where: { connectionId: f.connection.id, kind: "SYNC" } });
  expect((await googleNotification(new Request("https://calendar.example.test", { headers }))).status).toBe(204);
  expect((await db.syncJob.findUniqueOrThrow({ where: { id: before.id } })).requestVersion).toBe(before.requestVersion);
  for (const replacement of [{ "x-goog-channel-token": "wrong" }, { "x-goog-resource-id": "wrong" }, { "x-goog-message-number": "99999999999999999999" }] as Record<string, string>[])
    expect((await googleNotification(new Request("https://calendar.example.test", { headers: { ...headers, ...replacement } }))).status).toBe(403);
  await f.work();
  await db.syncSubscription.update({ where: { id: subscription.id }, data: { expiresAt: new Date(Date.now() + 1000) } });
  await f.queue("WATCH"); await f.work();
  expect(f.fake.watched).toBe(2); expect(f.fake.stopped).toContain(subscription.id);
  await selectGoogleCalendar(f.user.id, f.connection.id, f.calendar.id, false); while (await runOne(() => f.fake)) { /* Drain the notification and cleanup jobs. */ }
  expect(await db.syncSubscription.count({ where: { connectionId: f.connection.id } })).toBe(0);
  expect((await googleNotification(new Request("https://calendar.example.test", { headers }))).status).toBe(403);
});

it("prevents an in-flight provider response from restoring a deselected calendar", async () => {
  const f = await fixture();
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const original = f.fake.events.bind(f.fake);
  f.fake.events = async (...args) => { entered(); await gate; return original(...args); };
  await f.queue(); const running = runOne(() => f.fake); await started;
  await selectGoogleCalendar(f.user.id, f.connection.id, f.calendar.id, false);
  release(); await running;
  expect(await db.event.count({ where: { calendarId: f.calendar.id } })).toBe(0);
  expect(await db.sourceEvent.count({ where: { calendarId: f.calendar.id } })).toBe(0);
});
it("avoids duplicate channels after a watch transport timeout and keeps reconciliation available", async () => {
  const f = await fixture(); f.fake.failures.watch = new GoogleError("PROVIDER_UNAVAILABLE");
  await f.queue("WATCH"); await f.work();
  expect(await db.syncSubscription.count({ where: { connectionId: f.connection.id, status: "PENDING" } })).toBe(1);
  delete f.fake.failures.watch; await f.retry(); await f.work(); expect(f.fake.watched).toBe(1);
  await f.queue(); await f.work(); expect(await db.event.count({ where: { calendarId: f.calendar.id } })).toBe(1);
});

it("applies space privacy to imported events and hides grants revoked by Google", async () => {
  const f = await fixture();
  const peer = await db.user.create({ data: { name: "Google peer", email: randomUUID() + "@example.test" } }); users.push(peer.id);
  const space = await createSpace(f.user.id, "Google privacy");
  try {
    await acceptInvitation(peer.id, (await invite(f.user.id, space.id)).token);
    f.fake.source = [sampleGoogleEvent("private", { visibility: "private", summary: "PRIVATE_GOOGLE_TITLE" }), sampleGoogleEvent("public", { summary: "PUBLIC_GOOGLE_TITLE" })];
    await f.queue(); await f.work();
    const range = { start: "2026-11-01T00:00:00Z", end: "2026-12-01T00:00:00Z" };
    expect((await calendarData(peer.id, space.id, range)).events).toHaveLength(0);
    await setSharing(f.user.id, space.id, f.calendar.id, "BUSY_ONLY");
    expect(JSON.stringify((await calendarData(peer.id, space.id, range)).events)).not.toContain("GOOGLE_TITLE");
    await setSharing(f.user.id, space.id, f.calendar.id, "FULL_DETAILS");
    const output = JSON.stringify((await calendarData(peer.id, space.id, range)).events);
    expect(output).toContain("PUBLIC_GOOGLE_TITLE"); expect(output).not.toContain("PRIVATE_GOOGLE_TITLE");
    await db.calendar.update({ where: { id: f.calendar.id }, data: { lastErrorCode: "INVALID_DATA" } });
    await f.queue("DISCOVER"); await f.work();
    expect((await calendarData(peer.id, space.id, range)).events).toHaveLength(0);
    await db.providerConnection.update({ where: { id: f.connection.id }, data: { status: "REAUTH_REQUIRED", credentialCiphertext: null } });
    expect((await calendarData(f.user.id, space.id, range)).events).toHaveLength(0);
  } finally { await db.sharedSpace.deleteMany({ where: { id: space.id } }); }
});
it("replaces a one-off when Google converts it into a recurring series", async () => {
  const f = await fixture(); await f.queue(); await f.work();
  f.fake.delta = [sampleGoogleEvent("single", { recurrence: ["RRULE:FREQ=WEEKLY;COUNT=2"] })];
  f.fake.series.single = [sampleGoogleEvent("single-instance", { recurringEventId: "single" })];
  await f.queue(); await f.work();
  expect((await db.event.findMany({ where: { calendarId: f.calendar.id } })).map(e => e.externalId)).toEqual(["single-instance"]);
});
it("purges local credentials after bounded unsuccessful remote revocation", async () => {
  const f = await fixture(); f.fake.failures.revoke = new GoogleError("PROVIDER_UNAVAILABLE");
  await disconnectGoogle(f.user.id, f.connection.id);
  for (let i = 0; i < 5; i++) { await f.retry(); await f.work(); }
  expect(await db.providerConnection.findUnique({ where: { id: f.connection.id } })).toMatchObject({ status: "DISCONNECTED", credentialCiphertext: null, lastErrorCode: "REVOKE_UNCONFIRMED" });
  expect(await db.syncJob.count({ where: { connectionId: f.connection.id } })).toBe(0);
});
it("serializes sharing with import removal so no permission survives the race", async () => {
  const f = await fixture(); const space = await createSpace(f.user.id, "Selection race");
  try {
    const results = await Promise.allSettled([
      setSharing(f.user.id, space.id, f.calendar.id, "FULL_DETAILS", true),
      selectGoogleCalendar(f.user.id, f.connection.id, f.calendar.id, false),
    ]);
    expect(results[1].status).toBe("fulfilled");
    expect(await db.calendarShare.count({ where: { calendarId: f.calendar.id } })).toBe(0);
  } finally { await db.sharedSpace.deleteMany({ where: { id: space.id } }); }
});
