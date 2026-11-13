import { Temporal } from "@js-temporal/polyfill";
import { GoogleError } from "./errors";
import { googleEventSchema, type GoogleEvent } from "./contracts";
export function googleTime(value: { date?: string; dateTime?: string; timeZone?: string }, fallback: string) {
  try {
    if (value.date) {
      const date = Temporal.PlainDate.from(value.date).toString();
      return { date: new Date(date + "T00:00:00Z"), allDay: true, zone: value.timeZone ?? fallback };
    }
    if (!value.dateTime) throw new Error();
    const zone = value.timeZone ?? fallback;
    new Intl.DateTimeFormat("en", { timeZone: zone }).format();
    const instant = /(?:Z|[+-]\d{2}:\d{2})$/.test(value.dateTime)
      ? Temporal.Instant.from(value.dateTime)
      : Temporal.PlainDateTime.from(value.dateTime).toZonedDateTime(zone, { disambiguation: "compatible" }).toInstant();
    return { date: new Date(Number(instant.epochMilliseconds)), allDay: false, zone };
  } catch { throw new GoogleError("INVALID_DATA"); }
}
export function normalizeGoogleEvent(input: GoogleEvent, calendarZone: string, master?: GoogleEvent) {
  const event = googleEventSchema.parse(input);
  if (event.status === "cancelled") return null;
  if (!event.start || !event.end) throw new GoogleError("INVALID_DATA");
  const start = googleTime(event.start, calendarZone), end = googleTime(event.end, calendarZone);
  if (start.allDay !== end.allDay || end.date <= start.date) throw new GoogleError("INVALID_DATA");
  const visibility = event.visibility && event.visibility !== "default" ? event.visibility : master?.visibility ?? event.visibility;
  // Missing detail access is treated conservatively; never invent a private title.
  const privacy = visibility === "private" ? "PRIVATE" as const : visibility === "confidential" || !event.summary ? "CONFIDENTIAL" as const : "PUBLIC" as const;
  return {
    externalId: event.id, title: event.summary ?? "Busy",
    start: start.date, end: end.date, allDay: start.allDay, timeZone: start.zone,
    location: event.location ?? null, description: event.description ?? null,
    privacy, busy: event.transparency !== "transparent", cancelled: false,
    recurrenceRule: (master?.recurrence ?? event.recurrence)?.join("\n") ?? null,
    seriesId: event.recurringEventId ?? null,
    originalStart: event.originalStartTime ? googleTime(event.originalStartTime, calendarZone).date : null,
    providerVersion: event.etag ?? event.updated ?? null,
  };
}
export function rollingWindow(now = new Date()) {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return { start: new Date(day.getTime() - 183 * 86400000), end: new Date(day.getTime() + 548 * 86400000) };
}
