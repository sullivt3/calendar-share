import { OAuth2Client, CodeChallengeMethod, type Credentials } from "google-auth-library";
import { z } from "zod";
import { googleConfig } from "./config";
import { GoogleError } from "./errors";
import { GOOGLE_SCOPES, googleCalendarSchema, googleEventSchema, type GoogleGateway, type OAuthTokens } from "./contracts";

export function retryDelay(value: string | null, now = Date.now()) {
  if (!value) return 60000;
  const milliseconds = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isFinite(milliseconds) ? Math.max(1000, Math.min(milliseconds, 86400000)) : 60000;
}
export function classifyGoogleError(status: number, body: unknown, retryAfter: string | null = null) {
  const parsed = z.object({ error: z.union([z.string(), z.object({ errors: z.array(z.object({ reason: z.string().optional() })).optional() })]).optional() }).safeParse(body);
  const error = parsed.success ? parsed.data.error : undefined;
  const reasons = typeof error === "object" ? error?.errors?.map(e => e.reason) ?? [] : [];
  if (error === "invalid_grant") return new GoogleError("REAUTH_REQUIRED");
  if (status === 429 || reasons.some(r => ["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded", "dailyLimitExceeded"].includes(r ?? "")))
    return new GoogleError("RATE_LIMIT", retryDelay(retryAfter));
  if (status === 401) return new GoogleError("ACCESS_EXPIRED");
  if (status === 403) return new GoogleError("ACCESS_DENIED");
  if (status === 404) return new GoogleError("NOT_FOUND");
  if (status === 410) return new GoogleError("CURSOR_EXPIRED");
  if (status >= 500 || status === 408) return new GoogleError("PROVIDER_UNAVAILABLE");
  return new GoogleError("INVALID_DATA");
}
function authError(error: unknown) {
  const response = z.object({ response: z.object({ status: z.number(), data: z.unknown(), headers: z.unknown().optional() }) }).safeParse(error);
  if (response.success) {
    const headers = response.data.response.headers;
    return classifyGoogleError(response.data.response.status, response.data.response.data, headers instanceof Headers ? headers.get("Retry-After") : null);
  }
  return new GoogleError("PROVIDER_UNAVAILABLE");
}
function tokens(value: Credentials): OAuthTokens {
  if (!value.access_token || !value.expiry_date) throw new GoogleError("INVALID_DATA");
  return { accessToken: value.access_token, refreshToken: value.refresh_token ?? undefined,
    expiresAt: value.expiry_date, scope: value.scope ?? "", idToken: value.id_token ?? undefined };
}
export function googleGateway(): GoogleGateway {
  const config = googleConfig();
  const client = new OAuth2Client({ clientId: config.clientId, clientSecret: config.clientSecret,
    redirectUri: config.redirectUri, transporterOptions: { timeout: 15000, retry: false } });
  let lastRequest = 0;
  async function request(path: string, token: string, method: "GET" | "POST" = "GET", body?: unknown): Promise<unknown> {
    // Only fixed Calendar API paths are reachable. No arbitrary provider URLs.
    if (!path.startsWith("/") || path.startsWith("//")) throw new GoogleError("INVALID_DATA");
    const delay = Math.max(0, lastRequest + 250 - Date.now());
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    lastRequest = Date.now();
    let response: Response;
    try {
      response = await fetch("https://www.googleapis.com/calendar/v3" + path, {
        method, cache: "no-store", signal: AbortSignal.timeout(15000),
        headers: { Authorization: "Bearer " + token, ...(body ? { "Content-Type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch { throw new GoogleError("PROVIDER_UNAVAILABLE"); }
    const text = await response.text();
    let data: unknown;
    try { data = text ? JSON.parse(text) : {}; } catch { throw new GoogleError("INVALID_DATA"); }
    if (!response.ok) throw classifyGoogleError(response.status, data, response.headers.get("Retry-After"));
    return data;
  }
  const list = z.object({ items: z.array(googleEventSchema).default([]), nextPageToken: z.string().optional(), nextSyncToken: z.string().optional() });
  const eventFields = "id,status,summary,description,location,start,end,visibility,transparency,recurrence,recurringEventId,originalStartTime,etag,updated";
  const fields = "items(" + eventFields + "),nextPageToken,nextSyncToken";
  const calendarPath = (id: string) => "/calendars/" + encodeURIComponent(id) + "/events";
  return {
    authorization(state, challenge) {
      return client.generateAuthUrl({ access_type: "offline", prompt: "consent select_account",
        scope: [...GOOGLE_SCOPES], state, include_granted_scopes: false,
        code_challenge: challenge, code_challenge_method: CodeChallengeMethod.S256 });
    },
    async exchange(code, verifier) {
      try { return tokens((await client.getToken({ code, codeVerifier: verifier, redirect_uri: config.redirectUri })).tokens); }
      catch (e) { if (e instanceof GoogleError) throw e; throw authError(e); }
    },
    async identity(idToken) {
      try {
        const payload = (await client.verifyIdToken({ idToken, audience: config.clientId })).getPayload();
        if (!payload?.sub) throw new Error();
        return { subject: payload.sub, ...(payload.email_verified && payload.email ? { email: payload.email } : {}) };
      } catch { throw new GoogleError("REAUTH_REQUIRED"); }
    },
    async refresh(refreshToken) {
      client.setCredentials({ refresh_token: refreshToken });
      try { return tokens((await client.refreshAccessToken()).credentials); }
      catch (e) { if (e instanceof GoogleError) throw e; throw authError(e); }
    },
    async calendars(token, page) {
      const query = new URLSearchParams({ maxResults: "250", showDeleted: "true", showHidden: "true", fields: "items(id,summary,timeZone,accessRole,deleted),nextPageToken" });
      if (page) query.set("pageToken", page);
      return z.object({ items: z.array(googleCalendarSchema).default([]), nextPageToken: z.string().optional() }).parse(await request("/users/me/calendarList?" + query, token));
    },
    async events(token, calendar, cursor, page) {
      const query = new URLSearchParams({ maxResults: "250", singleEvents: "false", showDeleted: "true", fields });
      if (cursor) query.set("syncToken", cursor);
      if (page) query.set("pageToken", page);
      return list.parse(await request(calendarPath(calendar) + "?" + query, token));
    },
    async instances(token, calendar, master, start, end, page) {
      const query = new URLSearchParams({ maxResults: "250", showDeleted: "true", timeMin: start, timeMax: end, fields });
      if (page) query.set("pageToken", page);
      return list.parse(await request(calendarPath(calendar) + "/" + encodeURIComponent(master) + "/instances?" + query, token));
    },
    async event(token, calendar, id) {
      return googleEventSchema.parse(await request(calendarPath(calendar) + "/" + encodeURIComponent(id) + "?fields=" + encodeURIComponent(eventFields), token));
    },
    async watch(token, calendar, channel) {
      return z.object({ id: z.string(), resourceId: z.string(), expiration: z.coerce.string() }).parse(
        await request(calendarPath(calendar) + "/watch", token, "POST", { ...channel, type: "web_hook", params: { ttl: "86400" } }));
    },
    async stop(token, channel) {
      try { await request("/channels/stop", token, "POST", channel); }
      catch (e) { if (!(e instanceof GoogleError) || !["NOT_FOUND", "CURSOR_EXPIRED"].includes(e.code)) throw e; }
    },
    async revoke(refreshToken) {
      let response: Response;
      try {
        response = await fetch("https://oauth2.googleapis.com/revoke", { method: "POST", cache: "no-store", signal: AbortSignal.timeout(15000),
          headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: refreshToken }) });
      } catch { throw new GoogleError("PROVIDER_UNAVAILABLE"); }
      if (response.ok) return;
      const body: unknown = await response.json().catch(() => ({}));
      if (response.status === 400 && z.object({ error: z.literal("invalid_token") }).safeParse(body).success) return;
      throw classifyGoogleError(response.status, body, response.headers.get("Retry-After"));
    },
  };
}
