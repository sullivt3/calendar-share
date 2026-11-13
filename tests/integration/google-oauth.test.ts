import { createHash, randomUUID } from "node:crypto";
import { beforeAll, afterAll, expect, it, vi } from "vitest";
import { db } from "../../src/server/db";
import { auth } from "../../src/server/auth";
import { beginGoogleOAuth, completeGoogleOAuth, OAUTH_COOKIE } from "../../src/server/google/oauth";
import * as gatewayModule from "../../src/server/google/gateway";
import { unseal, secretHash } from "../../src/server/credentials";
import { POST as start } from "../../src/app/api/providers/google/start/route";
import { GET as callback } from "../../src/app/api/providers/google/callback/route";
import { listConnections } from "../../src/server/connections";
import { FakeGoogle } from "../fixtures/google";
import { googleTestEnvironment } from "../fixtures/google-env";
const fake = new FakeGoogle(), ids: string[] = [], sessions: string[] = [], cookies: string[] = [];
const origin = "http://localhost:3000";
beforeAll(async () => {
  googleTestEnvironment();
  const sdk = gatewayModule.googleGateway();
  fake.authorization = (state, challenge) => sdk.authorization(state, challenge);
  vi.spyOn(gatewayModule, "googleGateway").mockReturnValue(fake);
  for (let i = 0; i < 2; i++) {
    const response = await auth.api.signUpEmail({ body: { name: "OAuth test", email: "oauth-" + randomUUID() + "@example.test", password: "oauth-test-only-password" }, asResponse: true });
    const cookie = response.headers.getSetCookie().map(v => v.split(";")[0]).join("; ");
    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
    ids.push(session!.user.id); sessions.push(session!.session.id); cookies.push(cookie);
  }
});
afterAll(async () => { await db.user.deleteMany({ where: { id: { in: ids } } }); await db.$disconnect(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
const request = (cookie = cookies[0], requestOrigin = origin) => new Request(origin + "/api/providers/google/start", {
  method: "POST", headers: { cookie, origin: requestOrigin, "Content-Type": "application/json" }, body: "{}",
});
it("protects start with session/origin checks and reports unavailable configuration", async () => {
  expect((await start(request(""))).status).toBe(401);
  expect((await start(request(cookies[0], "https://attacker.invalid"))).status).toBe(403);
  const previous = process.env.GOOGLE_CLIENT_ID;
  process.env.GOOGLE_CLIENT_ID = "";
  try { expect((await start(request())).status).toBe(503); } finally { process.env.GOOGLE_CLIENT_ID = previous; }
});
it("binds state/PKCE to the session and HTTP-only browser cookie, then encrypts credentials", async () => {
  const response = await start(request());
  expect(response.status).toBe(200);
  const setCookie = response.headers.get("set-cookie")!;
  expect(setCookie).toMatch(/HttpOnly/); expect(setCookie).toMatch(/SameSite=Lax/); expect(setCookie).toContain("Max-Age=600");
  const browser = setCookie.split(";")[0].slice(OAUTH_COOKIE.length + 1);
  const url = new URL((await response.json()).url), state = url.searchParams.get("state")!;
  const attempt = await db.oAuthAttempt.findUniqueOrThrow({ where: { stateHash: secretHash(state) } });
  expect(attempt.stateHash).not.toBe(state); expect(attempt.browserHash).not.toBe(browser);
  const verifier = unseal(attempt.verifierCiphertext, "oauth:" + attempt.id) as string;
  expect(createHash("sha256").update(verifier).digest("base64url")).toBe(url.searchParams.get("code_challenge"));
  const before = fake.exchanged;
  await expect(completeGoogleOAuth(ids[1], sessions[1], { state, browser, code: "code" }, fake)).rejects.toMatchObject({ status: 400 });
  await expect(completeGoogleOAuth(ids[0], randomUUID(), { state, browser, code: "code" }, fake)).rejects.toMatchObject({ status: 400 });
  await expect(completeGoogleOAuth(ids[0], sessions[0], { state, browser: "wrong", code: "code" }, fake)).rejects.toMatchObject({ status: 400 });
  expect(fake.exchanged).toBe(before);
  const callbackRequest = new Request(origin + "/api/providers/google/callback?state=" + state + "&code=SECRET_CODE", { headers: { cookie: cookies[0] + "; " + OAUTH_COOKIE + "=" + browser } });
  const result = await callback(callbackRequest);
  expect(result.status).toBe(303); expect(result.headers.get("location")).toBe(origin + "/connections?google=connected");
  expect(result.headers.get("cache-control")).toContain("no-store");
  expect(result.headers.get("referrer-policy")).toBe("no-referrer");
  expect(fake.codeVerifier).toBe(verifier);
  const replay = await callback(callbackRequest);
  expect(replay.headers.get("location")).toBe(origin + "/connections?google=failed");
  expect(fake.exchanged).toBe(before + 1);
  const connection = await db.providerConnection.findFirstOrThrow({ where: { userId: ids[0], provider: "GOOGLE" } });
  expect(connection.credentialCiphertext).not.toContain(fake.refreshValue);
  expect(unseal(connection.credentialCiphertext!, "connection:" + connection.id)).toMatchObject({ refreshToken: fake.refreshValue });
  expect(JSON.stringify(await listConnections(ids[0]))).not.toContain(fake.refreshValue);
  expect(JSON.stringify(await listConnections(ids[0]))).not.toContain("credentialCiphertext");
});
it("rejects expired/replayed attempts and consumes a denied consent without exchanging a code", async () => {
  const expired = await beginGoogleOAuth(ids[0], sessions[0], fake);
  const state = new URL(expired.url).searchParams.get("state")!;
  await db.oAuthAttempt.update({ where: { stateHash: secretHash(state) }, data: { expiresAt: new Date(0) } });
  const before = fake.exchanged;
  await expect(completeGoogleOAuth(ids[0], sessions[0], { state, browser: expired.browser, code: "code" }, fake)).rejects.toMatchObject({ status: 400 });
  const denied = await beginGoogleOAuth(ids[0], sessions[0], fake);
  const deniedState = new URL(denied.url).searchParams.get("state")!;
  expect(await completeGoogleOAuth(ids[0], sessions[0], { state: deniedState, browser: denied.browser, denied: true }, fake)).toEqual({ denied: true });
  await expect(completeGoogleOAuth(ids[0], sessions[0], { state: deniedState, browser: denied.browser, code: "code" }, fake)).rejects.toMatchObject({ status: 400 });
  expect(fake.exchanged).toBe(before);
});
it("requires the granted read-only scopes and offline refresh access", async () => {
  const original = fake.tokens.bind(fake);
  fake.tokens = () => ({ ...original(), scope: "https://www.googleapis.com/auth/calendar" });
  try {
    const attempt = await beginGoogleOAuth(ids[1], sessions[1], fake);
    await expect(completeGoogleOAuth(ids[1], sessions[1], { state: new URL(attempt.url).searchParams.get("state")!, browser: attempt.browser, code: "code" }, fake)).rejects.toMatchObject({ status: 400 });
  } finally { fake.tokens = original; }
  fake.subject = "no-offline-account";
  fake.tokens = () => ({ ...original(), refreshToken: undefined });
  try {
    const attempt = await beginGoogleOAuth(ids[1], sessions[1], fake);
    await expect(completeGoogleOAuth(ids[1], sessions[1], { state: new URL(attempt.url).searchParams.get("state")!, browser: attempt.browser, code: "code" }, fake)).rejects.toMatchObject({ status: 400 });
  } finally { fake.tokens = original; fake.subject = "test-google-subject"; }
});
it("keeps the same Google identity isolated between application users", async () => {
  const attempt = await beginGoogleOAuth(ids[1], sessions[1], fake);
  await completeGoogleOAuth(ids[1], sessions[1], { state: new URL(attempt.url).searchParams.get("state")!, browser: attempt.browser, code: "code" }, fake);
  const connections = await db.providerConnection.findMany({ where: { userId: { in: ids }, provider: "GOOGLE" } });
  expect(connections).toHaveLength(2); expect(connections[0].id).not.toBe(connections[1].id);
  expect(() => unseal(connections[0].credentialCiphertext!, "connection:" + connections[1].id)).toThrow();
  expect((await listConnections(ids[0])).connections).toHaveLength(1);
  expect((await listConnections(ids[1])).connections).toHaveLength(1);
});
