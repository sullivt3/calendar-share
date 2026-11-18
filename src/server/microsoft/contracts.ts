import { z } from "zod";
// Delegated access only. ReadBasic omits descriptions needed by full-detail sharing.
export const MICROSOFT_SCOPES = ["openid", "profile", "email", "offline_access", "https://graph.microsoft.com/Calendars.Read"] as const;
export function hasReadOnlyScopes(value: string) {
  const scopes = value.split(/\s+/).filter(Boolean).map(s => s.replace(/^https:\/\/graph\.microsoft\.com\//i, "").toLowerCase());
  const allowed = new Set(["openid", "profile", "email", "offline_access", "calendars.read"]);
  return scopes.includes("calendars.read") && scopes.every(s => allowed.has(s));
}
export const microsoftCalendarSchema = z.object({
  id: z.string().min(1).max(2048), name: z.string().max(10000).optional(),
  isDefaultCalendar: z.boolean().optional(), canViewPrivateItems: z.boolean().optional(),
  owner: z.object({ name: z.string().optional(), address: z.string().optional() }).optional(),
});
const dateTime = z.object({ dateTime: z.string(), timeZone: z.string() });
export const microsoftEventSchema = z.object({
  id: z.string().min(1).max(2048), subject: z.string().max(10000).optional(),
  start: dateTime.optional(), end: dateTime.optional(), isAllDay: z.boolean().optional(),
  isCancelled: z.boolean().optional(), sensitivity: z.enum(["normal", "personal", "private", "confidential"]).optional(),
  showAs: z.string().optional(), type: z.enum(["singleInstance", "occurrence", "exception", "seriesMaster"]).optional(),
  seriesMasterId: z.string().optional(), originalStart: z.string().optional(),
  originalStartTimeZone: z.string().optional(), originalEndTimeZone: z.string().optional(),
  location: z.object({ displayName: z.string().max(100000).optional() }).optional(),
  body: z.object({ contentType: z.enum(["text", "html"]), content: z.string().max(1000000) }).optional(),
  changeKey: z.string().optional(), lastModifiedDateTime: z.string().optional(),
  "@removed": z.object({ reason: z.string().optional() }).optional(),
});
export const tokenResponseSchema = z.object({ access_token: z.string().min(1), refresh_token: z.string().min(1).optional(),
  token_type: z.string().refine(s => s.toLowerCase() === "bearer"), expires_in: z.number().int().positive(),
  scope: z.string().min(1), id_token: z.string().optional() });
export type MicrosoftEvent = z.infer<typeof microsoftEventSchema>;
export type MicrosoftCalendar = z.infer<typeof microsoftCalendarSchema>;
export type MicrosoftRange = { start: string; end: string };
export type MicrosoftEventPage = { value: MicrosoftEvent[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string };
export type MicrosoftCalendarPage = { value: MicrosoftCalendar[]; "@odata.nextLink"?: string };
export type MicrosoftTokens = { accessToken: string; refreshToken?: string; expiresAt: number; scope: string; idToken?: string };

export const microsoftCredentialsSchema = z.object({ accessToken: z.string().min(1), refreshToken: z.string().min(1), expiresAt: z.number().finite().positive(), scope: z.string().min(1) });
