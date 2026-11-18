import { randomUUID } from "node:crypto";
import { beforeAll, afterEach, afterAll, expect, it, vi } from "vitest";
import { db } from "../../src/server/db";
import { seal, unseal } from "../../src/server/credentials";
import { enqueue, ensureJob } from "../../src/server/sync/queue";
import { runOne } from "../../src/server/sync/runner";
import { scheduleDue } from "../../src/server/sync/scheduler";
import { selectProviderCalendar, disconnectProvider, listConnections, requestDiscovery } from "../../src/server/connections";
import { createSpace, invite, acceptInvitation, setSharing } from "../../src/server/spaces";
import { calendarData } from "../../src/server/calendar";
import { MicrosoftError } from "../../src/server/microsoft/errors";
import { microsoftNotification } from "../../src/server/microsoft/webhook";
import { FakeMicrosoft, sampleMicrosoftEvent } from "../fixtures/microsoft";
import { googleTestEnvironment } from "../fixtures/google-env";
const users: string[] = [];
beforeAll(() => { googleTestEnvironment(); vi.stubEnv("GOOGLE_CLIENT_ID", ""); vi.stubEnv("MICROSOFT_CLIENT_ID", "TEST_ONLY_CLIENT"); vi.stubEnv("MICROSOFT_CLIENT_SECRET", "TEST_ONLY_SECRET"); vi.stubEnv("MICROSOFT_WEBHOOK_URL", "https://calendar.example.test/api/providers/microsoft/webhook"); });
afterEach(async () => { await db.user.deleteMany({ where: { id: { in: users.splice(0) } } }); });
afterAll(async () => { await db.$disconnect(); vi.unstubAllEnvs(); });
async function fixture(primary = true, expired = false) {
  const fake = new FakeMicrosoft(), tenant = randomUUID(), object = randomUUID();
  const user = await db.user.create({ data: { name: "Microsoft sync test", email: randomUUID() + "@example.test" } }); users.push(user.id);
  const id = randomUUID(), tokens = await fake.exchange();
  const connection = await db.providerConnection.create({ data: { id, userId: user.id, provider: "MICROSOFT", externalId: tenant + ":" + object,
    nextDiscoveryAt: new Date(Date.now() + 3600000), credentialCiphertext: seal({ ...tokens, expiresAt: expired ? Date.now() - 3600000 : tokens.expiresAt }, "connection:" + id) } });
  const calendar = await db.calendar.create({ data: { connectionId: id, externalId: primary ? "primary" : "secondary", name: "Outlook test", isPrimary: primary, syncEnabled: true, nextSyncAt: new Date(Date.now() + 3600000), nextWatchAt: new Date(Date.now() + 3600000) } });
  const queue = (kind: "SYNC" | "DISCOVER" | "WATCH" = "SYNC") => db.$transaction(tx => enqueue(tx, kind, id, kind === "DISCOVER" ? null : calendar.id));
  const work = async () => { expect(await runOne(undefined, () => fake)).toBe(true); };
  const retry = async () => { await db.syncJob.updateMany({ where: { connectionId: id }, data: { runAt: new Date(0) } }); await db.providerConnection.update({ where: { id }, data: { nextAllowedAt: new Date(0) } }); };
  return { fake, tenant, object, user, connection, calendar, queue, work, retry };
}
it("discovers only owned calendars, preserves existing selection and schedules Microsoft work", async () => {
  const f = await fixture(); await f.queue("DISCOVER"); await f.work();
  const calendars = await db.calendar.findMany({ where: { connectionId: f.connection.id } }); expect(calendars).toHaveLength(2);
  expect(calendars.find(c => c.externalId === "secondary")?.syncEnabled).toBe(false);
  expect(calendars.find(c => c.externalId === "primary")?.isPrimary).toBe(true);
  await db.calendar.update({ where: { id: f.calendar.id }, data: { nextSyncAt: new Date(0) } }); await scheduleDue();
  expect(await db.syncJob.count({ where: { connectionId: f.connection.id, kind: "SYNC" } })).toBe(1);
  const dto = await listConnections(f.user.id); expect(dto.connections[0].provider).toBe("MICROSOFT"); expect(JSON.stringify(dto)).not.toContain("TEST_ONLY_ACCESS");
});
it("refreshes encrypted tokens and resumes checkpointed delta pagination", async () => {
  const f = await fixture(true, true); f.fake.source.push(sampleMicrosoftEvent("second")); f.fake.failPage = true;
  await f.queue(); await f.work(); expect(f.fake.refreshed).toBe(1);
  const state = await db.syncState.findUniqueOrThrow({ where: { calendarId: f.calendar.id } }); expect(state.syncTokenCiphertext).toBeNull(); expect(state.pageTokenCiphertext).not.toContain("skiptoken");
  expect(await db.event.count({ where: { calendarId: f.calendar.id } })).toBe(0);
  await f.retry(); await f.work(); expect(await db.event.count({ where: { calendarId: f.calendar.id } })).toBe(2);
  expect(f.fake.calls[2].link).toContain("skiptoken");
  const done = await db.syncState.findUniqueOrThrow({ where: { calendarId: f.calendar.id } }); expect(unseal(done.syncTokenCiphertext!, "microsoft:sync:" + f.calendar.id + ":cursor")).toContain("deltatoken=1");
});
it("applies updates, expanded recurrence exceptions and deletion tombstones idempotently", async () => {
  const f = await fixture(); f.fake.source.push(sampleMicrosoftEvent("occurrence", { type: "exception", seriesMasterId: "master", sensitivity: "private" }));
  await f.queue(); await f.work();
  expect(await db.event.findFirst({ where: { calendarId: f.calendar.id, externalId: "occurrence" } })).toMatchObject({ privacy: "PRIVATE", seriesId: "master" });
  f.fake.delta = [sampleMicrosoftEvent("single", { subject: "Updated" }), { id: "occurrence", "@removed": { reason: "deleted" } }]; f.fake.revision++;
  await f.queue(); await f.work(); await f.queue(); await f.work();
  const events = await db.event.findMany({ where: { calendarId: f.calendar.id } }); expect(events).toHaveLength(1); expect(events[0].title).toBe("Updated");
});
it("reconciles secondary snapshots and rebuilds expired primary delta state", async () => {
  const secondary = await fixture(false); await secondary.queue(); await secondary.work(); secondary.fake.source = []; await secondary.queue(); await secondary.work();
  expect(await db.event.count({ where: { calendarId: secondary.calendar.id } })).toBe(0); expect(secondary.fake.calls.every(c => c.kind === "snapshot")).toBe(true);
  const f = await fixture(); await f.queue(); await f.work(); const original = f.fake.primaryDelta.bind(f.fake);
  f.fake.primaryDelta = async (access, range, link) => { if (link?.includes("deltatoken")) throw new MicrosoftError("CURSOR_EXPIRED"); return original(access, range, link); };
  f.fake.source = [sampleMicrosoftEvent("replacement")]; await f.queue(); await f.work();
  expect((await db.event.findMany({ where: { calendarId: f.calendar.id } })).map(e => e.externalId)).toEqual(["replacement"]);
});
it("persists quota backoff, rejects revoked access and prevents foreign account mutations", async () => {
  const f = await fixture(); f.fake.failures.events = new MicrosoftError("RATE_LIMIT", 60000); await f.queue(); await f.work();
  expect(await runOne(undefined, () => f.fake)).toBe(false);
  expect((await db.providerConnection.findUniqueOrThrow({ where: { id: f.connection.id } })).nextAllowedAt.getTime()).toBeGreaterThan(Date.now() + 50000);
  await expect(selectProviderCalendar(randomUUID(), f.connection.id, f.calendar.id, false)).rejects.toMatchObject({ status: 404 });
  delete f.fake.failures.events; await f.retry(); await f.work();
  await db.providerConnection.update({ where: { id: f.connection.id }, data: { credentialCiphertext: seal({ ...await f.fake.exchange(), expiresAt: Date.now() - 1000 }, "connection:" + f.connection.id) } });
  f.fake.failures.refresh = new MicrosoftError("REAUTH_REQUIRED"); await f.queue(); await f.work();
  expect(await db.providerConnection.findUnique({ where: { id: f.connection.id } })).toMatchObject({ status: "REAUTH_REQUIRED", credentialCiphertext: null });
});
it("fences in-flight imports after deselection and immediately purges local sharing on disconnect", async () => {
  const f = await fixture(); let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(r => { release = r; }), started = new Promise<void>(r => { entered = r; });
  const original = f.fake.primaryDelta.bind(f.fake);
  f.fake.primaryDelta = async (...args) => { entered(); await gate; return original(...args); };
  await f.queue(); const work = runOne(undefined, () => f.fake); await started;
  await selectProviderCalendar(f.user.id, f.connection.id, f.calendar.id, false); release(); await work;
  expect(await db.sourceEvent.count({ where: { calendarId: f.calendar.id } })).toBe(0);
  await disconnectProvider(f.user.id, f.connection.id); await f.work();
  expect(await db.providerConnection.findUnique({ where: { id: f.connection.id } })).toMatchObject({ status: "DISCONNECTED", credentialCiphertext: null, lastErrorCode: "MICROSOFT_CONSENT_REMOVAL" });
});
it("verifies early notification secrets/tenants/resources, coalesces duplicates and renews channels", async () => {
  const f = await fixture(); let notice: Record<string, unknown> = {};
  const send = (value = notice) => microsoftNotification(new Request("https://calendar.example.test/api/providers/microsoft/webhook", { method: "POST", body: JSON.stringify({ value: [value] }) }));
  f.fake.onSubscribe = async (id, secret) => { notice = { subscriptionId: id, clientState: secret, tenantId: f.tenant, resource: "Users/" + f.object + "/Events/event", changeType: "updated" }; expect((await send()).status).toBe(202); };
  await f.queue("WATCH"); await f.work();
  const sub = await db.syncSubscription.findFirstOrThrow({ where: { connectionId: f.connection.id } }); expect(sub.status).toBe("ACTIVE"); expect(sub.tokenHash).not.toBe(notice.clientState);
  await send(); expect(await db.syncJob.count({ where: { connectionId: f.connection.id, kind: "SYNC" } })).toBe(1); await f.work();
  for (const changes of [{ clientState: "x".repeat(43) }, { tenantId: randomUUID() }, { resource: "Users/" + randomUUID() + "/Events/event" }, { subscriptionId: randomUUID() }]) await send({ ...notice, ...changes });
  expect(await db.syncJob.count({ where: { connectionId: f.connection.id } })).toBe(0);
  await db.syncSubscription.update({ where: { id: sub.id }, data: { expiresAt: new Date(Date.now() + 60000) } }); await f.queue("WATCH"); await f.work(); expect(f.fake.renewed).toBe(1);
  await send({ ...notice, lifecycleEvent: "subscriptionRemoved" }); expect(await db.syncSubscription.count({ where: { id: sub.id } })).toBe(0);
  while (await runOne(undefined, () => f.fake)) { /* Drain coalesced recovery jobs. */ }
  expect(f.fake.subscribed).toBe(2);
  await disconnectProvider(f.user.id, f.connection.id); await f.work(); expect(f.fake.stopped.length).toBeGreaterThan(0);
});
it("handles validation challenges without parsing notifications and rejects oversized payloads", async () => {
  const response = await microsoftNotification(new Request("https://calendar.example.test/api/providers/microsoft/webhook?validationToken=hello%20world", { method: "POST" }));
  expect(response.status).toBe(200); expect(response.headers.get("content-type")).toContain("text/plain"); expect(await response.text()).toBe("hello world");
  expect((await microsoftNotification(new Request("https://calendar.example.test", { method: "POST", body: "x".repeat(65537) }))).status).toBe(413);
});
it("applies busy-only/private-event projection to Outlook imports and revokes sharing on removal", async () => {
  const f = await fixture(), peer = await db.user.create({ data: { name: "Peer", email: randomUUID() + "@example.test" } }); users.push(peer.id);
  const space = await createSpace(f.user.id, "Outlook privacy");
  try {
    await acceptInvitation(peer.id, (await invite(f.user.id, space.id)).token);
    f.fake.source = [sampleMicrosoftEvent("private", { subject: "PRIVATE_OUTLOOK", sensitivity: "private" }), sampleMicrosoftEvent("normal", { subject: "PUBLIC_OUTLOOK" })];
    await f.queue(); await f.work(); await setSharing(f.user.id, space.id, f.calendar.id, "BUSY_ONLY");
    const range = { start: "2026-11-01T00:00:00Z", end: "2026-12-01T00:00:00Z" };
    expect(JSON.stringify((await calendarData(peer.id, space.id, range)).events)).not.toContain("OUTLOOK");
    await setSharing(f.user.id, space.id, f.calendar.id, "FULL_DETAILS"); const output = JSON.stringify((await calendarData(peer.id, space.id, range)).events);
    expect(output).toContain("PUBLIC_OUTLOOK"); expect(output).not.toContain("PRIVATE_OUTLOOK");
    await selectProviderCalendar(f.user.id, f.connection.id, f.calendar.id, false);
    expect(await db.calendarShare.count({ where: { calendarId: f.calendar.id } })).toBe(0); expect((await calendarData(peer.id, space.id, range)).events).toHaveLength(0);
  } finally { await db.sharedSpace.deleteMany({ where: { id: space.id } }); }
});
it("retains uncertain pending subscriptions without duplicates while polling continues", async () => {
  const f = await fixture(); f.fake.failures.subscribe = new MicrosoftError("PROVIDER_UNAVAILABLE");
  await f.queue("WATCH"); await f.work();
  expect(await db.syncSubscription.count({ where: { connectionId: f.connection.id, status: "PENDING" } })).toBe(1);
  delete f.fake.failures.subscribe; await f.retry(); await f.work(); expect(f.fake.subscribed).toBe(1);
  await f.queue(); await f.work(); expect(await db.event.count({ where: { calendarId: f.calendar.id } })).toBe(1);
});
it("bounds failed remote disconnect cleanup and purges local tokens", async () => {
  const f = await fixture(); await f.queue("WATCH"); await f.work();
  f.fake.failures.stop = new MicrosoftError("PROVIDER_UNAVAILABLE"); await disconnectProvider(f.user.id, f.connection.id);
  for (let i = 0; i < 5; i++) { await f.retry(); await f.work(); }
  expect(await db.providerConnection.findUnique({ where: { id: f.connection.id } })).toMatchObject({ status: "DISCONNECTED", credentialCiphertext: null, lastErrorCode: "REVOKE_UNCONFIRMED" });
  expect(await db.syncJob.count({ where: { connectionId: f.connection.id } })).toBe(0);
});

it("resets resource-bound sync state when the primary-calendar designation changes", async () => {
  const f = await fixture(); await f.queue(); await f.work();
  f.fake.primary = { ...f.fake.primary, id: "secondary" };
  await f.queue("DISCOVER"); await f.work();
  expect(await db.syncState.count({ where: { calendarId: f.calendar.id } })).toBe(0);
  expect(await db.calendar.findUnique({ where: { id: f.calendar.id } })).toMatchObject({ isPrimary: false, lastSyncedAt: null });
  await f.work(); expect(f.fake.calls.at(-1)?.kind).toBe("snapshot");
});
it("re-fetches corrected data after a normalization failure and a manual retry", async () => {
  const f = await fixture(); f.fake.source = [sampleMicrosoftEvent("bad", { start: { dateTime: "invalid", timeZone: "UTC" } })];
  await f.queue(); await f.work();
  expect(await db.calendar.findUnique({ where: { id: f.calendar.id } })).toMatchObject({ lastErrorCode: "INVALID_DATA", lastSyncedAt: null });
  expect(await db.syncState.findUnique({ where: { calendarId: f.calendar.id } })).toMatchObject({ phase: "IDLE" });
  f.fake.source = [sampleMicrosoftEvent("corrected")]; await requestDiscovery(f.user.id, f.connection.id);
  while (await runOne(undefined, () => f.fake)) { /* Drain the owner's retry. */ }
  expect((await db.event.findMany({ where: { calendarId: f.calendar.id } })).map(e => e.externalId)).toEqual(["corrected"]);
});

it("coalesces scheduler and notification inserts without reversing connection/job lock order", async () => {
  const f = await fixture(); let scheduled!: Promise<unknown>;
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM provider_connections WHERE id = ${f.connection.id}::uuid FOR UPDATE`;
    const [{ pid }] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
    scheduled = ensureJob("SYNC", f.connection.id, f.calendar.id).then(() => true, error => error);
    let waiting = false;
    for (let i = 0; i < 40; i++) {
      const [{ blocked }] = await db.$queryRaw<{ blocked: boolean }[]>`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))) AS blocked`;
      if (blocked) { waiting = true; break; }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    expect(waiting).toBe(true);
    await enqueue(tx, "SYNC", f.connection.id, f.calendar.id);
  });
  expect(await scheduled).toBe(true);
  expect(await db.syncJob.count({ where: { connectionId: f.connection.id, kind: "SYNC" } })).toBe(1);
});
