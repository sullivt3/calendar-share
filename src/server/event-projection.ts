import type { Event } from "../generated/prisma/client";
import type { CalendarEvent, CalendarInfo } from "../shared/calendar";

// This is the only event serialization boundary. Never spread a database event.
export function projectEvent(event: Event, calendar: CalendarInfo, viewerId: string): CalendarEvent {
  const own = calendar.ownerId === viewerId;
  const full = own || (calendar.mode === "FULL_DETAILS" && event.privacy === "PUBLIC");
  const base = {
    id: event.id, calendarId: calendar.id, calendarName: calendar.name,
    ownerId: calendar.ownerId, ownerName: calendar.ownerName,
    provider: calendar.provider, isMock: calendar.isMock, color: calendar.color,
    title: full ? event.title : "Busy",
    start: event.allDay ? event.start.toISOString().slice(0, 10) : event.start.toISOString(),
    end: event.allDay ? event.end.toISOString().slice(0, 10) : event.end.toISOString(),
    allDay: event.allDay, timeZone: event.timeZone, busy: event.busy,
  };
  if (!full) return { ...base, details: "busy" };
  return {
    ...base, details: "full", location: event.location,
    ...(own || calendar.includeDescription ? { description: event.description } : {}),
    recurring: !!(event.seriesId || event.recurrenceRule),
  };
}
