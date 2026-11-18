import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { MICROSOFT_SCOPES, hasReadOnlyScopes } from "../../src/server/microsoft/contracts";
import { microsoftGateway, microsoftPkce, continuation } from "../../src/server/microsoft/gateway";
import { classifyMicrosoftError } from "../../src/server/microsoft/errors";
const range = { start: "2026-11-01T00:00:00Z", end: "2026-12-01T00:00:00Z" };
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function environment() {
  vi.stubEnv("MICROSOFT_CLIENT_ID", "TEST_ONLY_CLIENT"); vi.stubEnv("MICROSOFT_CLIENT_SECRET", "TEST_ONLY_SECRET");
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000"); vi.stubEnv("PROVIDER_ENCRYPTION_KEY_ID", "v1");
  vi.stubEnv("PROVIDER_ENCRYPTION_KEYS", JSON.stringify({ v1: randomBytes(32).toString("base64") }));
}
it("requests delegated read-only scopes with S256 PKCE, state and nonce for common accounts", () => {
  environment(); const proof = microsoftPkce();
  expect(proof.verifier.length).toBeGreaterThanOrEqual(43);
  expect(createHash("sha256").update(proof.verifier).digest("base64url")).toBe(proof.challenge);
  const url = new URL(microsoftGateway().authorization("state", proof.challenge, "nonce"));
  expect(url.origin).toBe("https://login.microsoftonline.com"); expect(url.pathname).toBe("/common/oauth2/v2.0/authorize");
  expect(url.searchParams.get("scope")?.split(" ")).toEqual([...MICROSOFT_SCOPES]);
  expect(url.searchParams.get("code_challenge_method")).toBe("S256"); expect(url.searchParams.get("nonce")).toBe("nonce");
  expect(url.searchParams.get("state")).toBe("state"); expect(url.searchParams.get("response_mode")).toBe("query");
  expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/providers/microsoft/callback");
  expect(url.search).not.toContain("TEST_ONLY_SECRET");
  expect(hasReadOnlyScopes("Calendars.Read openid profile email")).toBe(true);
  expect(hasReadOnlyScopes("https://graph.microsoft.com/Calendars.Read offline_access")).toBe(true);
  for (const scopes of ["Calendars.ReadWrite", "Calendars.Read Calendars.ReadWrite", "Calendars.Read Mail.Read", "Calendars.Read.Shared", "Calendars.ReadBasic"])
    expect(hasReadOnlyScopes(scopes)).toBe(false);
});
it("validates configuration and keeps OAuth secrets in the POST body", async () => {
  environment(); const calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url, init) => { calls.push({ url: String(url), init }); return Response.json({ access_token: "TEST_ONLY_ACCESS", refresh_token: "TEST_ONLY_REFRESH", token_type: "Bearer", expires_in: 3600, scope: "Calendars.Read" }); }));
  const api = microsoftGateway(), tokens = await api.exchange("TEST_ONLY_CODE", "TEST_ONLY_VERIFIER");
  expect(tokens.refreshToken).toBe("TEST_ONLY_REFRESH"); expect(tokens.expiresAt).toBeGreaterThan(Date.now());
  expect(calls[0].url).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/token");
  expect(calls[0].init?.redirect).toBe("error");
  const body = calls[0].init?.body as URLSearchParams;
  expect(body.get("code_verifier")).toBe("TEST_ONLY_VERIFIER"); expect(body.get("client_secret")).toBe("TEST_ONLY_SECRET");
  await api.refresh("TEST_ONLY_REFRESH"); expect((calls[1].init?.body as URLSearchParams).get("grant_type")).toBe("refresh_token");
  vi.stubEnv("BETTER_AUTH_URL", "https://user:secret@example.test"); expect(() => api.authorization("state", "challenge", "nonce")).toThrow("CONFIG_MISSING");
});
it("rejects unrequested grants and sanitizes failed token responses", async () => {
  environment(); vi.stubGlobal("fetch", vi.fn(async () => Response.json({ access_token: "ACCESS", token_type: "Bearer", expires_in: 3600, scope: "Calendars.ReadWrite" })));
  await expect(microsoftGateway().refresh("REFRESH")).rejects.toThrow("REAUTH_REQUIRED");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "invalid_grant", error_description: "SECRET_PROVIDER_DETAILS" }, { status: 400 })));
  await expect(microsoftGateway().refresh("REFRESH")).rejects.toThrow(/^REAUTH_REQUIRED$/);
});
it("binds continuation links to the exact Graph resource before sending tokens", async () => {
  const path = "/v1.0/me/calendarView/delta", valid = "https://graph.microsoft.com" + path + "?$deltatoken=OPAQUE";
  expect(continuation(valid, path)).toBe(valid);
  for (const invalid of ["https://evil.test" + path, "https://graph.microsoft.com.evil.test" + path, "https://user:pass@graph.microsoft.com" + path,
    "http://graph.microsoft.com" + path, "https://graph.microsoft.com" + path + "#fragment", "https://graph.microsoft.com/v1.0/users/other/calendarView/delta",
    "https://graph.microsoft.com" + path + "?access_token=SECRET", "https://graph.microsoft.com/beta/me/calendarView/delta", "/relative"])
    expect(() => continuation(invalid, path)).toThrow("INVALID_DATA");
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await expect(microsoftGateway().primaryDelta("ACCESS", range, "https://evil.test" + path)).rejects.toThrow("INVALID_DATA");
  expect(fetcher).not.toHaveBeenCalled();
});
it("uses stable primary-calendar delta, preserves opaque links and strips unneeded data", async () => {
  const calls: { url: string; init?: RequestInit }[] = [], cursor = "https://graph.microsoft.com/v1.0/me/calendarView/delta?$deltatoken=opaque%2Ftoken";
  vi.stubGlobal("fetch", vi.fn(async (url, init) => { calls.push({ url: String(url), init }); return Response.json({ value: [{ id: "removed", "@removed": { reason: "deleted" }, attendees: ["PRIVATE_UNUSED"] }], "@odata.deltaLink": cursor }); }));
  const api = microsoftGateway(), page = await api.primaryDelta("TEST_ONLY_ACCESS", range);
  const url = new URL(calls[0].url); expect(url.searchParams.get("startDateTime")).toBe(range.start); expect(url.searchParams.has("$select")).toBe(false);
  expect(calls[0].url).not.toContain("TEST_ONLY_ACCESS"); expect(calls[0].init?.method).toBe("GET"); expect(calls[0].init?.redirect).toBe("error");
  expect(new Headers(calls[0].init?.headers).get("Prefer")).toContain('IdType="ImmutableId"');
  expect(new Headers(calls[0].init?.headers).get("Prefer")).toContain('outlook.body-content-type="text"');
  expect(page.value[0]).toEqual({ id: "removed", "@removed": { reason: "deleted" } });
  await api.primaryDelta("ACCESS", range, cursor); expect(calls[1].url).toBe(cursor);
  expect(api).not.toHaveProperty("createEvent"); expect(api).not.toHaveProperty("updateEvent"); expect(api).not.toHaveProperty("deleteEvent");
});
it("keeps secondary calendars on calendarView and rejects malformed cursor protocols", async () => {
  const calls: string[] = [];
  const fetcher = vi.fn(async (url: string) => { calls.push(url); return Response.json({ value: [] }); }); vi.stubGlobal("fetch", fetcher);
  const api = microsoftGateway(); await api.calendarView("ACCESS", "calendar/id", range);
  expect(calls[0]).toContain("/me/calendars/calendar%2Fid/calendarView?");
  await expect(api.primaryDelta("ACCESS", range)).rejects.toThrow("INVALID_DATA"); // Missing next or delta link.
  await expect(api.calendarView("ACCESS", "..", range)).rejects.toThrow("INVALID_DATA");
  await expect(api.primaryDelta("ACCESS", { start: "invalid", end: range.end })).rejects.toThrow("INVALID_DATA");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ value: [], "@odata.nextLink": "https://evil.test/" })));
  await expect(api.calendars("ACCESS")).rejects.toThrow("INVALID_DATA");
});
it("limits mutations to subscriptions and keeps resource data out of notifications", async () => {
  const id = randomUUID(), calls: { url: string; init?: RequestInit }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url, init) => { calls.push({ url: String(url), init }); return init?.method === "DELETE" ? new Response(null, { status: 204 }) : Response.json({ id, expirationDateTime: new Date(Date.now() + 86400000).toISOString() }); }));
  const api = microsoftGateway(); await api.subscribe("ACCESS", "https://calendar.example.test/api/providers/microsoft/webhook", "a".repeat(43));
  const body = JSON.parse(calls[0].init?.body as string);
  expect(body.resource).toBe("me/events"); expect(body.includeResourceData).toBe(false);
  expect(new Date(body.expirationDateTime).getTime() - Date.now()).toBeLessThanOrEqual(86400000);
  await api.renew("ACCESS", id); await api.stop("ACCESS", id);
  expect(calls.map(c => c.init?.method)).toEqual(["POST", "PATCH", "DELETE"]);
  expect(calls.every(c => new URL(c.url).pathname.startsWith("/v1.0/subscriptions"))).toBe(true);
  await expect(api.stop("ACCESS", "../me/events")).rejects.toThrow("INVALID_DATA");
  await expect(api.subscribe("ACCESS", "http://localhost:3000/webhook", "secret")).rejects.toThrow("INVALID_DATA");
});
it("respects quota delays, expired deltas, consent revocation and organization policy errors", async () => {
  expect(classifyMicrosoftError(429, {}, "120").retryAfterMs).toBe(120000);
  expect(classifyMicrosoftError(410, {}).code).toBe("CURSOR_EXPIRED");
  expect(classifyMicrosoftError(400, { error: { code: "syncStateNotFound" } }).code).toBe("CURSOR_EXPIRED");
  expect(classifyMicrosoftError(403, { error: "insufficient_claims" }).code).toBe("POLICY_BLOCKED");
  expect(classifyMicrosoftError(401, {}).code).toBe("ACCESS_EXPIRED");
  expect(classifyMicrosoftError(400, { error: "invalid_client" }).code).toBe("CONFIG_MISSING");
  vi.stubGlobal("fetch", vi.fn(async () => new Response("proxy quota response", { status: 429, headers: { "Retry-After": "90" } })));
  await expect(microsoftGateway().calendars("ACCESS")).rejects.toMatchObject({ code: "RATE_LIMIT", retryAfterMs: 90000 });
});
