import { Temporal } from "@js-temporal/polyfill";
import zones from "cldr-core/supplemental/windowsZones.json";
import { microsoftEventSchema, type MicrosoftEvent } from "./contracts";
import { MicrosoftError } from "./errors";
export function microsoftZone(value: string) {
  let result = value;
  try { new Intl.DateTimeFormat("en", { timeZone: result }).format(); }
  catch {
    result = zones.supplemental.windowsZones.mapTimezones.find(z => z.mapZone._other === value && z.mapZone._territory === "001")?.mapZone._type.split(" ")[0] ?? "";
    try { new Intl.DateTimeFormat("en", { timeZone: result }).format(); } catch { throw new MicrosoftError("INVALID_DATA"); }
  }
  return result;
}
function instant(value: { dateTime: string; timeZone: string }) {
  try {
    return /(?:Z|[+-]\d{2}:\d{2})$/.test(value.dateTime) ? Temporal.Instant.from(value.dateTime) :
      Temporal.PlainDateTime.from(value.dateTime).toZonedDateTime(microsoftZone(value.timeZone)).toInstant();
  } catch { throw new MicrosoftError("INVALID_DATA"); }
}
export function normalizeMicrosoftEvent(input: MicrosoftEvent) {
  const event = microsoftEventSchema.parse(input);
  if (event["@removed"] || event.isCancelled) return null;
  if (!event.start || !event.end || event.type === "seriesMaster") throw new MicrosoftError("INVALID_DATA");
  const zone = microsoftZone(event.originalStartTimeZone ?? event.start.timeZone), begin = instant(event.start), finish = instant(event.end);
  let start = new Date(Number(begin.epochMilliseconds)), end = new Date(Number(finish.epochMilliseconds));
  if (event.isAllDay) {
    const a = begin.toZonedDateTimeISO(zone), b = finish.toZonedDateTimeISO(zone);
    if (a.hour || a.minute || a.second || a.millisecond || a.microsecond || a.nanosecond || b.hour || b.minute || b.second || b.millisecond || b.microsecond || b.nanosecond) throw new MicrosoftError("INVALID_DATA");
    start = new Date(a.toPlainDate().toString() + "T00:00:00Z"); end = new Date(b.toPlainDate().toString() + "T00:00:00Z");
  }
  if (end <= start) throw new MicrosoftError("INVALID_DATA");
  return { externalId: event.id, title: event.subject ?? "Busy", start, end, allDay: event.isAllDay ?? false, timeZone: zone,
    privacy: event.sensitivity === "normal" && event.subject ? "PUBLIC" as const : event.sensitivity === "private" || event.sensitivity === "personal" ? "PRIVATE" as const : "CONFIDENTIAL" as const,
    busy: event.showAs !== "free", cancelled: false, location: event.location?.displayName ?? null,
    description: event.body?.contentType === "text" ? event.body.content : null, recurrenceRule: null,
    seriesId: event.seriesMasterId ?? null,
    originalStart: event.originalStart ? new Date(Number(instant({ dateTime: event.originalStart, timeZone: "UTC" }).epochMilliseconds)) : null,
    providerVersion: event.changeKey ?? event.lastModifiedDateTime ?? null };
}
