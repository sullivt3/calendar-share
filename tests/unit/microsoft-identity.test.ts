import { randomUUID, randomBytes } from "node:crypto";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { beforeAll, afterEach, expect, it, vi } from "vitest";
import { verifyMicrosoftIdentity } from "../../src/server/microsoft/identity";
import { secretHash } from "../../src/server/credentials";
const tenant = randomUUID(), object = randomUUID(), nonce = "TEST_ONLY_NONCE", client = "TEST_ONLY_CLIENT";
const issuer = "https://login.microsoftonline.com/" + tenant + "/v2.0";
let pair: Awaited<ReturnType<typeof generateKeyPair>>, key: Awaited<ReturnType<typeof exportJWK>> & { issuer: string };
beforeAll(async () => { pair = await generateKeyPair("RS256"); key = { ...await exportJWK(pair.publicKey), kid: "test-key", use: "sig", alg: "RS256", issuer: "https://login.microsoftonline.com/{tenantid}/v2.0" }; });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function configure() {
  vi.stubEnv("MICROSOFT_CLIENT_ID", client); vi.stubEnv("MICROSOFT_CLIENT_SECRET", "TEST_ONLY_SECRET");
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000"); vi.stubEnv("PROVIDER_ENCRYPTION_KEY_ID", "v1");
  vi.stubEnv("PROVIDER_ENCRYPTION_KEYS", JSON.stringify({ v1: randomBytes(32).toString("base64") }));
}
async function signed(changes: Record<string, unknown> = {}, signingKey = pair.privateKey, headers: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ iss: issuer, aud: client, sub: "pairwise-subject", tid: tenant, oid: object, nonce, ver: "2.0", iat: now, nbf: now, exp: now + 3600, preferred_username: "DISPLAY_ONLY@example.test", ...changes })
    .setProtectedHeader({ alg: "RS256", kid: "test-key", ...headers }).sign(signingKey);
}
it("verifies a signed personal/work identity and uses tenant/object IDs instead of email", async () => {
  configure(); const token = await signed();
  const result = await verifyMicrosoftIdentity(token, secretHash(nonce), async () => ({ keys: [key] }));
  expect(result).toEqual({ subject: tenant + ":" + object, label: "DISPLAY_ONLY@example.test" });
  const consumers = "9188040d-6c67-4c5b-b112-36a304b66dad";
  const personal = await signed({ tid: consumers, iss: "https://login.microsoftonline.com/" + consumers + "/v2.0" });
  expect((await verifyMicrosoftIdentity(personal, secretHash(nonce), async () => ({ keys: [key] }))).subject).toBe(consumers + ":" + object);
});
it("rejects tampered signatures, audience/issuer/tenant, nonce, version and time failures", async () => {
  configure(); const other = await generateKeyPair("RS256");
  await expect(verifyMicrosoftIdentity(await signed({}, other.privateKey), secretHash(nonce), async () => ({ keys: [key] }))).rejects.toThrow(/^REAUTH_REQUIRED$/);
  for (const changes of [{ aud: "another-client" }, { iss: "https://evil.test/issuer" }, { tid: "../evil" }, { oid: "not-object-id" },
    { nonce: "wrong" }, { ver: "1.0" }, { exp: 1 }, { nbf: Math.floor(Date.now() / 1000) + 3600 }, { iat: Math.floor(Date.now() / 1000) + 3600 }, { sub: undefined }])
    await expect(verifyMicrosoftIdentity(await signed(changes), secretHash(nonce), async () => ({ keys: [key] }))).rejects.toThrow(/^REAUTH_REQUIRED$/);
  await expect(verifyMicrosoftIdentity(await signed(), secretHash("other-nonce"), async () => ({ keys: [key] }))).rejects.toThrow(/^REAUTH_REQUIRED$/);
});
it("checks signing-key issuer scope and never follows token-controlled key URLs", async () => {
  configure();
  await expect(verifyMicrosoftIdentity(await signed(), secretHash(nonce), async () => ({ keys: [{ ...key, issuer: "https://login.microsoftonline.com/" + randomUUID() + "/v2.0" }] }))).rejects.toThrow(/^REAUTH_REQUIRED$/);
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => { calls.push(url); return Response.json({ keys: [key] }); }));
  await verifyMicrosoftIdentity(await signed({}, pair.privateKey, { jku: "https://evil.test/keys", x5u: "https://evil.test/cert" }), secretHash(nonce));
  expect(calls).toEqual(["https://login.microsoftonline.com/common/discovery/v2.0/keys"]);
});
