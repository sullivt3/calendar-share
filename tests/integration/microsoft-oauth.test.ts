import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, afterEach, expect, it, vi } from "vitest";
import { db } from "../../src/server/db";
import { googleTestEnvironment } from "../fixtures/google-env";
import { microsoftGateway } from "../../src/server/microsoft/gateway";
import { beginMicrosoftOAuth, completeMicrosoftOAuth } from "../../src/server/microsoft/oauth";
import { completeGoogleOAuth, beginGoogleOAuth } from "../../src/server/google/oauth";
import { unseal, secretHash, secretMatches } from "../../src/server/credentials";
const users: string[] = [];
beforeAll(() => { googleTestEnvironment(); vi.stubEnv("MICROSOFT_CLIENT_ID", "TEST_ONLY_CLIENT"); vi.stubEnv("MICROSOFT_CLIENT_SECRET", "TEST_ONLY_SECRET"); });
afterEach(async () => { await db.user.deleteMany({ where: { id: { in: users.splice(0) } } }); });
afterAll(async () => { await db.$disconnect(); vi.unstubAllEnvs(); });
async function fixture() {
  const user = await db.user.create({ data: { name: "Microsoft OAuth test", email: randomUUID() + "@example.test" } }); users.push(user.id);
  const session = await db.session.create({ data: { userId: user.id, token: randomUUID(), expiresAt: new Date(Date.now() + 3600000) } });
  let exchanged = 0, refresh: string | undefined = "TEST_ONLY_REFRESH", scope = "Calendars.Read openid profile email";
  const gateway = { ...microsoftGateway(), async exchange() { exchanged++; return { accessToken: "TEST_ONLY_ACCESS", refreshToken: refresh, expiresAt: Date.now() + 3600000, scope, idToken: "TEST_ONLY_ID_TOKEN" }; } };
  const begin = async () => {
    const attempt = await beginMicrosoftOAuth(user.id, session.id, gateway), url = new URL(attempt.url);
    const input = { state: url.searchParams.get("state")!, browser: attempt.browser, code: "TEST_ONLY_CODE" };
    const identity = async (_token: string, hash: string) => { expect(secretMatches(url.searchParams.get("nonce")!, hash)).toBe(true); return { subject: "test-tenant:test-object", label: "DISPLAY_ONLY@example.test" }; };
    return { ...attempt, input, dependencies: { gateway, identity } };
  };
  return { user, session, gateway, begin, exchanged: () => exchanged, setRefresh: (v?: string) => { refresh = v; }, setScope: (v: string) => { scope = v; } };
}
it("binds attempts to provider, user, session, browser and encrypted PKCE/nonce", async () => {
  const f = await fixture(), a = await f.begin();
  const record = await db.oAuthAttempt.findUniqueOrThrow({ where: { stateHash: secretHash(a.input.state) } });
  expect(record.provider).toBe("MICROSOFT"); expect(record.nonceHash).not.toContain(new URL(a.url).searchParams.get("nonce")!);
  expect(typeof unseal(record.verifierCiphertext, "microsoft:oauth:" + record.id)).toBe("string");
  expect(() => unseal(record.verifierCiphertext, "oauth:" + record.id)).toThrow();
  await expect(completeMicrosoftOAuth(randomUUID(), f.session.id, a.input, a.dependencies)).rejects.toMatchObject({ status: 400 });
  await expect(completeMicrosoftOAuth(f.user.id, randomUUID(), a.input, a.dependencies)).rejects.toMatchObject({ status: 400 });
  await expect(completeMicrosoftOAuth(f.user.id, f.session.id, { ...a.input, browser: "wrong" }, a.dependencies)).rejects.toMatchObject({ status: 400 });
  await expect(completeGoogleOAuth(f.user.id, f.session.id, a.input)).rejects.toMatchObject({ status: 400 }); expect(f.exchanged()).toBe(0);
  await completeMicrosoftOAuth(f.user.id, f.session.id, a.input, a.dependencies);
  const connection = await db.providerConnection.findFirstOrThrow({ where: { userId: f.user.id, provider: "MICROSOFT" } });
  expect(connection.credentialCiphertext).not.toContain("TEST_ONLY_REFRESH");
  expect(unseal(connection.credentialCiphertext!, "connection:" + connection.id)).toHaveProperty("refreshToken", "TEST_ONLY_REFRESH");
  expect(unseal(connection.credentialCiphertext!, "connection:" + connection.id)).not.toHaveProperty("idToken");
  expect(await db.syncJob.count({ where: { connectionId: connection.id, kind: "DISCOVER" } })).toBe(1);
  await expect(completeMicrosoftOAuth(f.user.id, f.session.id, a.input, a.dependencies)).rejects.toMatchObject({ status: 400 }); expect(f.exchanged()).toBe(1);
});
it("rejects a Google attempt without consuming it and rejects expired/denied attempts", async () => {
  const f = await fixture(), google = await beginGoogleOAuth(f.user.id, f.session.id);
  const input = { state: new URL(google.url).searchParams.get("state")!, browser: google.browser, code: "TEST_ONLY_CODE" };
  await expect(completeMicrosoftOAuth(f.user.id, f.session.id, input)).rejects.toMatchObject({ status: 400 });
  expect(await db.oAuthAttempt.count({ where: { stateHash: secretHash(input.state) } })).toBe(1);
  const expired = await f.begin(); await db.oAuthAttempt.update({ where: { stateHash: secretHash(expired.input.state) }, data: { expiresAt: new Date(0) } });
  await expect(completeMicrosoftOAuth(f.user.id, f.session.id, expired.input, expired.dependencies)).rejects.toMatchObject({ status: 400 });
  const denied = await f.begin(); expect(await completeMicrosoftOAuth(f.user.id, f.session.id, { ...denied.input, denied: true }, denied.dependencies)).toEqual({ denied: true }); expect(f.exchanged()).toBe(0);
});
it("consumes concurrent callbacks once and isolates identical Microsoft identities between users", async () => {
  const a = await fixture(), b = await fixture(), start = await a.begin();
  const results = await Promise.allSettled([completeMicrosoftOAuth(a.user.id, a.session.id, start.input, start.dependencies), completeMicrosoftOAuth(a.user.id, a.session.id, start.input, start.dependencies)]);
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1); expect(a.exchanged()).toBe(1);
  const other = await b.begin(); await completeMicrosoftOAuth(b.user.id, b.session.id, other.input, other.dependencies);
  const connections = await db.providerConnection.findMany({ where: { userId: { in: [a.user.id, b.user.id] } } }); expect(connections).toHaveLength(2);
  expect(() => unseal(connections[0].credentialCiphertext!, "connection:" + connections[1].id)).toThrow();
});
it("requires read-only/offline grants, preserves omitted refresh tokens and fences reconnecting workers", async () => {
  const f = await fixture(); f.setScope("Calendars.ReadWrite"); const denied = await f.begin();
  await expect(completeMicrosoftOAuth(f.user.id, f.session.id, denied.input, denied.dependencies)).rejects.toMatchObject({ status: 400 });
  f.setScope("Calendars.Read"); f.setRefresh(); const offline = await f.begin();
  await expect(completeMicrosoftOAuth(f.user.id, f.session.id, offline.input, offline.dependencies)).rejects.toMatchObject({ status: 400 });
  f.setRefresh("TEST_ONLY_REFRESH"); const first = await f.begin(); await completeMicrosoftOAuth(f.user.id, f.session.id, first.input, first.dependencies);
  const conn = await db.providerConnection.findFirstOrThrow({ where: { userId: f.user.id } });
  await db.providerConnection.update({ where: { id: conn.id }, data: { leaseToken: randomUUID(), leaseUntil: new Date(Date.now() + 120000) } });
  f.setRefresh(); const reconnect = await f.begin(); await completeMicrosoftOAuth(f.user.id, f.session.id, reconnect.input, reconnect.dependencies);
  const updated = await db.providerConnection.findUniqueOrThrow({ where: { id: conn.id } }); expect(updated.leaseToken).toBeNull();
  expect(unseal(updated.credentialCiphertext!, "connection:" + updated.id)).toHaveProperty("refreshToken", "TEST_ONLY_REFRESH");
});
it("does not install credentials if the app session is revoked during code exchange", async () => {
  const f = await fixture(), a = await f.begin(), exchange = a.dependencies.gateway.exchange;
  a.dependencies.gateway.exchange = async () => { const tokens = await exchange(); await db.session.delete({ where: { id: f.session.id } }); return tokens; };
  await expect(completeMicrosoftOAuth(f.user.id, f.session.id, a.input, a.dependencies)).rejects.toMatchObject({ status: 400 });
  expect(await db.providerConnection.count({ where: { userId: f.user.id } })).toBe(0);
});
it("protects the HTTP start/callback with auth, origin and safe redirect checks", async () => {
  const { POST } = await import("../../src/app/api/providers/microsoft/start/route");
  const { GET } = await import("../../src/app/api/providers/microsoft/callback/route");
  const request = (origin: string) => new Request("http://localhost:3000/api/providers/microsoft/start", { method: "POST", headers: { origin, "content-type": "application/json" }, body: "{}" });
  expect((await POST(request("http://localhost:3000"))).status).toBe(401);
  expect((await POST(request("https://evil.test"))).status).toBe(403);
  const callback = await GET(new Request("http://localhost:3000/api/providers/microsoft/callback?state=SECRET_TEST&code=SECRET_TEST"));
  expect(callback.status).toBe(303); expect(callback.headers.get("location")).toBe("http://localhost:3000/connections?microsoft=login-required");
  expect(callback.headers.get("referrer-policy")).toBe("no-referrer"); expect(callback.headers.get("cache-control")).toContain("no-store");
});
