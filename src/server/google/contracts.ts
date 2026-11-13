import { z } from "zod";
export const GOOGLE_SCOPES = [
  "openid", "email",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
] as const;
export function hasReadOnlyScopes(scope: string) {
  const granted = new Set(scope.split(" "));
  return GOOGLE_SCOPES.slice(2).every(value => granted.has(value)) &&
    ![...granted].some(value => value.startsWith("https://www.googleapis.com/auth/calendar") &&
      !GOOGLE_SCOPES.includes(value as typeof GOOGLE_SCOPES[number]));
}
export const credentialsSchema = z.object({
  accessToken: z.string().min(1), refreshToken: z.string().min(1), expiresAt: z.number(), scope: z.string(),
});
export type GoogleCredentials = z.infer<typeof credentialsSchema>;
export type OAuthTokens = { accessToken: string; refreshToken?: string; expiresAt: number; scope: string; idToken?: string };
const eventTime = z.object({ date: z.string().optional(), dateTime: z.string().optional(), timeZone: z.string().optional() });
export const googleEventSchema = z.object({
  id: z.string().min(1).max(2048), status: z.string().optional(), summary: z.string().max(10000).optional(),
  description: z.string().max(1000000).optional(), location: z.string().max(100000).optional(),
  start: eventTime.optional(), end: eventTime.optional(), visibility: z.string().optional(),
  transparency: z.string().optional(), recurrence: z.array(z.string()).optional(),
  recurringEventId: z.string().optional(), originalStartTime: eventTime.optional(),
  etag: z.string().optional(), updated: z.string().optional(),
});
export type GoogleEvent = z.infer<typeof googleEventSchema>;
export const googleCalendarSchema = z.object({
  id: z.string().min(1).max(2048), summary: z.string().max(10000).optional(),
  timeZone: z.string().optional(), accessRole: z.string().optional(), deleted: z.boolean().optional(),
});
export type GoogleCalendar = z.infer<typeof googleCalendarSchema>;
export type GoogleEventPage = { items: GoogleEvent[]; nextPageToken?: string; nextSyncToken?: string };
export type GoogleCalendarPage = { items: GoogleCalendar[]; nextPageToken?: string };
export interface GoogleGateway {
  authorization(state: string, challenge: string): string;
  exchange(code: string, verifier: string): Promise<OAuthTokens>;
  identity(idToken: string): Promise<{ subject: string; email?: string }>;
  refresh(refreshToken: string): Promise<OAuthTokens>;
  calendars(token: string, page?: string): Promise<GoogleCalendarPage>;
  events(token: string, calendar: string, cursor?: string, page?: string): Promise<GoogleEventPage>;
  instances(token: string, calendar: string, master: string, start: string, end: string, page?: string): Promise<GoogleEventPage>;
  event(token: string, calendar: string, id: string): Promise<GoogleEvent>;
  watch(token: string, calendar: string, channel: { id: string; token: string; address: string }): Promise<{ id: string; resourceId: string; expiration: string }>;
  stop(token: string, channel: { id: string; resourceId: string }): Promise<void>;
  revoke(refreshToken: string): Promise<void>;
}
