import { z } from "zod";
export const rangeSchema = z.object({
  start: z.iso.datetime({ offset: true }),
  end: z.iso.datetime({ offset: true }),
  person: z.uuid().optional(),
  calendar: z.uuid().optional(),
  provider: z.enum(["GOOGLE", "MICROSOFT", "APPLE", "MOCK"]).optional(),
}).refine(q => {
  const length = Date.parse(q.end) - Date.parse(q.start);
  return length > 0 && length <= 93 * 86400000;
}, "Choose a range of at most 93 days.");
export type CalendarRange = z.infer<typeof rangeSchema>;
export const preferenceSchema = z.object({
  displayColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  theme: z.enum(["LIGHT", "DARK", "SYSTEM"]).optional(),
});
export type Preference = { displayColor: string | null; theme: string };
export type CalendarInfo = {
  id: string; name: string; ownerId: string; ownerName: string;
  provider: string; isMock: boolean; color: string; mode: string;
  includeDescription: boolean; lastSyncedAt: string | null;
  coverageStart?: string | null; coverageEnd?: string | null; errorCode?: string | null;
};
export type EventBase = {
  id: string; calendarId: string; ownerId: string; ownerName: string;
  provider: string; isMock: boolean; color: string; calendarName: string;
  title: string; start: string; end: string; allDay: boolean; timeZone: string; busy: boolean;
};
export type CalendarEvent = EventBase & (
  { details: "busy" } |
  { details: "full"; location: string | null; description?: string | null; recurring: boolean }
);
export type CalendarData = {
  space: { id: string; name: string };
  members: { id: string; name: string; color: string }[];
  calendars: CalendarInfo[]; events: CalendarEvent[]; preference: Preference;
};
export const providerNames: Record<string, string> = { GOOGLE: "Google", MICROSOFT: "Outlook", APPLE: "Apple", MOCK: "Sample" };
