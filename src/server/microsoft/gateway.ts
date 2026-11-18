import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { microsoftConfig } from "./config";
import { MicrosoftError, classifyMicrosoftError } from "./errors";
import { MICROSOFT_SCOPES, hasReadOnlyScopes, tokenResponseSchema, microsoftCalendarSchema, microsoftEventSchema, type MicrosoftRange, type MicrosoftTokens } from "./contracts";
const origin = "https://graph.microsoft.com";
const login = "https://login.microsoftonline.com/common/oauth2/v2.0/";
const calendarPage = z.object({ value: z.array(microsoftCalendarSchema), "@odata.nextLink": z.string().optional() });
const eventPage = z.object({ value: z.array(microsoftEventSchema), "@odata.nextLink": z.string().optional(), "@odata.deltaLink": z.string().optional() });
const subscriptionSchema = z.object({ id: z.uuid(), expirationDateTime: z.string().datetime({ offset: true }) });
// Continuation URLs carry opaque credentials. Validate both before use and before
// persistence; never let a returned link redirect bearer tokens to another resource.
export function continuation(value: string, path: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new MicrosoftError("INVALID_DATA"); }
  if (url.origin !== origin || url.username || url.password || url.hash || url.pathname !== path || url.searchParams.has("access_token"))
    throw new MicrosoftError("INVALID_DATA");
  return url.toString();
}
export function microsoftPkce() {
  const verifier = randomBytes(64).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}
function rangeQuery(range: MicrosoftRange) {
  if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(range.start) || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(range.end) ||
    !Number.isFinite(Date.parse(range.start)) || !Number.isFinite(Date.parse(range.end)) || Date.parse(range.end) <= Date.parse(range.start) ||
    Date.parse(range.end) - Date.parse(range.start) > 732 * 86400000) throw new MicrosoftError("INVALID_DATA");
  return new URLSearchParams({ startDateTime: range.start, endDateTime: range.end });
}
export function microsoftGateway() {
  async function responseData(response: Response) {
    let body: unknown;
    try { body = response.status === 204 ? {} : await response.json(); } catch { if (response.ok) throw new MicrosoftError("INVALID_DATA"); body = {}; }
    if (!response.ok) throw classifyMicrosoftError(response.status, body, response.headers.get("retry-after"));
    return body;
  }
  async function request(url: string, token: string, method: "GET" | "POST" | "PATCH" | "DELETE" = "GET", body?: unknown) {
    let response: Response;
    try { response = await fetch(url, { method, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15000),
      headers: { Authorization: "Bearer " + token, Prefer: 'IdType="ImmutableId", outlook.timezone="UTC", outlook.body-content-type="text", odata.maxpagesize=250',
        ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); }
    catch { throw new MicrosoftError("PROVIDER_UNAVAILABLE"); }
    return responseData(response);
  }
  async function token(parameters: Record<string, string>): Promise<MicrosoftTokens> {
    const config = microsoftConfig();
    let response: Response;
    try { response = await fetch(login + "token", { method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...parameters, client_id: config.clientId, client_secret: config.clientSecret, scope: MICROSOFT_SCOPES.join(" ") }) }); }
    catch { throw new MicrosoftError("PROVIDER_UNAVAILABLE"); }
    const parsed = tokenResponseSchema.safeParse(await responseData(response));
    if (!parsed.success) throw new MicrosoftError("INVALID_DATA");
    const data = parsed.data;
    if (!hasReadOnlyScopes(data.scope)) throw new MicrosoftError("REAUTH_REQUIRED");
    return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: Date.now() + data.expires_in * 1000, scope: data.scope, idToken: data.id_token };
  }
  return {
    authorization(state: string, challenge: string, nonce: string) {
      const config = microsoftConfig();
      const query = new URLSearchParams({ client_id: config.clientId, response_type: "code", redirect_uri: config.redirectUri, response_mode: "query", scope: MICROSOFT_SCOPES.join(" "), state, nonce, code_challenge: challenge, code_challenge_method: "S256", prompt: "select_account" });
      return login + "authorize?" + query;
    },
    exchange(code: string, verifier: string) { return token({ grant_type: "authorization_code", code, code_verifier: verifier, redirect_uri: microsoftConfig().redirectUri }); },
    refresh(refreshToken: string) { return token({ grant_type: "refresh_token", refresh_token: refreshToken }); },
    async defaultCalendar(access: string) {
      return microsoftCalendarSchema.parse(await request(origin + "/v1.0/me/calendar?$select=id,name,isDefaultCalendar,canViewPrivateItems,owner", access));
    },
    async calendars(access: string, link?: string) {
      const path = "/v1.0/me/calendars";
      const data = calendarPage.parse(await request(link ? continuation(link, path) : origin + path + "?$select=id,name,isDefaultCalendar,canViewPrivateItems,owner", access));
      if (data["@odata.nextLink"]) continuation(data["@odata.nextLink"], path);
      return data;
    },
    async primaryDelta(access: string, range: MicrosoftRange, link?: string) {
      const path = "/v1.0/me/calendarView/delta";
      const data = eventPage.parse(await request(link ? continuation(link, path) : origin + path + "?" + rangeQuery(range), access));
      if (!!data["@odata.nextLink"] === !!data["@odata.deltaLink"]) throw new MicrosoftError("INVALID_DATA");
      for (const value of [data["@odata.nextLink"], data["@odata.deltaLink"]]) if (value) continuation(value, path);
      return data;
    },
    async calendarView(access: string, calendarId: string, range: MicrosoftRange, link?: string) {
      if (!calendarId || [".", ".."].includes(calendarId) || calendarId.length > 2048) throw new MicrosoftError("INVALID_DATA");
      const path = "/v1.0/me/calendars/" + encodeURIComponent(calendarId) + "/calendarView";
      const data = eventPage.parse(await request(link ? continuation(link, path) : origin + path + "?" + rangeQuery(range), access));
      if (data["@odata.deltaLink"]) throw new MicrosoftError("INVALID_DATA");
      if (data["@odata.nextLink"]) continuation(data["@odata.nextLink"], path);
      return data;
    },
    async subscribe(access: string, notificationUrl: string, clientState: string) {
      const url = new URL(notificationUrl);
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/api/providers/microsoft/webhook" ||
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || clientState.length < 32 || clientState.length > 128) throw new MicrosoftError("INVALID_DATA");
      // Mailbox-wide invalidation; never request event bodies in notifications.
      return subscriptionSchema.parse(await request(origin + "/v1.0/subscriptions", access, "POST", {
        changeType: "created,updated,deleted", notificationUrl, lifecycleNotificationUrl: notificationUrl, resource: "me/events", clientState,
        expirationDateTime: new Date(Date.now() + 24 * 3600000).toISOString(), includeResourceData: false,
      }));
    },
    async renew(access: string, id: string) {
      if (!z.uuid().safeParse(id).success) throw new MicrosoftError("INVALID_DATA");
      return subscriptionSchema.parse(await request(origin + "/v1.0/subscriptions/" + id, access, "PATCH", { expirationDateTime: new Date(Date.now() + 24 * 3600000).toISOString() }));
    },
    async stop(access: string, id: string) {
      if (!z.uuid().safeParse(id).success) throw new MicrosoftError("INVALID_DATA");
      try { await request(origin + "/v1.0/subscriptions/" + id, access, "DELETE"); }
      catch (error) { if (!(error instanceof MicrosoftError) || error.code !== "NOT_FOUND") throw error; }
    },
  };
}
export type MicrosoftGateway = ReturnType<typeof microsoftGateway>;
