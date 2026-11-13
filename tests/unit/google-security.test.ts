import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { seal, unseal, encryptionConfigured, secretHash, secretMatches } from "../../src/server/credentials";
import { googleGateway, classifyGoogleError, retryDelay } from "../../src/server/google/gateway";
import { GOOGLE_SCOPES } from "../../src/server/google/contracts";
import { backoff } from "../../src/server/sync/runner";
import { googleTestEnvironment } from "../fixtures/google-env";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("Google credential and protocol security", () => {
  it("encrypts with random IVs, rejects tampering/cross-account substitution, and rotates keys", () => {
    googleTestEnvironment();
    const original = process.env.PROVIDER_ENCRYPTION_KEYS!;
    const encrypted = seal({ refreshToken: "SECRET_REFRESH" }, "connection:a");
    expect(encrypted).not.toContain("SECRET_REFRESH");
    expect(seal({ refreshToken: "SECRET_REFRESH" }, "connection:a")).not.toBe(encrypted);
    expect(unseal(encrypted, "connection:a")).toEqual({ refreshToken: "SECRET_REFRESH" });
    expect(() => unseal(encrypted, "connection:b")).toThrow("CONFIG_MISSING");
    const parts = encrypted.split("."); parts[3] = "a" + parts[3].slice(1);
    if (parts.join(".") === encrypted) parts[3] = "b" + parts[3].slice(1);
    expect(() => unseal(parts.join("."), "connection:a")).toThrow();
    vi.stubEnv("PROVIDER_ENCRYPTION_KEYS", JSON.stringify({ ...JSON.parse(original), v2: randomBytes(32).toString("base64") }));
    vi.stubEnv("PROVIDER_ENCRYPTION_KEY_ID", "v2");
    expect(unseal(encrypted, "connection:a")).toHaveProperty("refreshToken", "SECRET_REFRESH");
    expect(seal("new", "context")).toMatch(/^v2\./);
    vi.stubEnv("PROVIDER_ENCRYPTION_KEY_ID", "missing");
    expect(encryptionConfigured()).toBe(false);
    expect(secretMatches("abc", secretHash("abc"))).toBe(true);
    expect(secretMatches("wrong", secretHash("abc"))).toBe(false);
  });
  it("requests only read-only Calendar scopes, offline consent and S256 PKCE", () => {
    googleTestEnvironment();
    const url = new URL(googleGateway().authorization("state", "challenge"));
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("scope")?.split(" ").sort()).toEqual([...GOOGLE_SCOPES].sort());
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe("challenge");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("include_granted_scopes")).toBe("false");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/providers/google/callback");
  });
  it("classifies provider limits, expired cursors and credential revocation without raw messages", () => {
    expect(classifyGoogleError(403, { error: { errors: [{ reason: "userRateLimitExceeded" }], message: "SECRET" } }).code).toBe("RATE_LIMIT");
    expect(classifyGoogleError(429, {}, "90").retryAfterMs).toBe(90000);
    expect(classifyGoogleError(410, {}).code).toBe("CURSOR_EXPIRED");
    expect(classifyGoogleError(400, { error: "invalid_grant" }).message).toBe("REAUTH_REQUIRED");
    expect(classifyGoogleError(403, {}).code).toBe("ACCESS_DENIED");
    expect(retryDelay(new Date(100000).toUTCString(), 0)).toBe(100000);
    expect(backoff(2, 50000, 0)).toBeGreaterThanOrEqual(50000);
    expect(backoff(4, 0, 0)).toBeGreaterThan(backoff(1, 0, 0));
  });
  it("keeps tokens out of URLs and exposes no event-write operations", async () => {
    googleTestEnvironment();
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ items: [], nextSyncToken: "cursor" }), { status: 200 });
    }));
    const api = googleGateway();
    await api.events("SECRET_ACCESS", "../private@example.test", "SYNC_CURSOR");
    const url = new URL(calls[0].url);
    expect(url.origin).toBe("https://www.googleapis.com");
    expect(url.searchParams.get("timeMin")).toBeNull(); expect(url.searchParams.get("timeMax")).toBeNull();
    expect(url.searchParams.get("singleEvents")).toBe("false");
    expect(calls[0].url).not.toContain("SECRET_ACCESS");
    expect(calls[0].init?.method).toBe("GET");
    expect(api).not.toHaveProperty("insert"); expect(api).not.toHaveProperty("update"); expect(api).not.toHaveProperty("delete");
  });
});
