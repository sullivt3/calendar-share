"use client";
import { useState, type RefObject } from "react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import type { DatesSetArg } from "@fullcalendar/core";
import { providerNames, type CalendarEvent } from "@/shared/calendar";
export default function CalendarCanvas({ calendarRef, events, datesSet, openEvent, timeZone }: {
  calendarRef: RefObject<FullCalendar | null>; events: CalendarEvent[];
  datesSet: (arg: DatesSetArg) => void; openEvent: (id: string) => void; timeZone: "local" | "UTC";
}) {
  const [initialView] = useState(() => window.matchMedia("(max-width: 767px)").matches ? "listWeek" : "dayGridMonth");
  return <FullCalendar ref={calendarRef} plugins={[dayGridPlugin, timeGridPlugin, listPlugin]}
    initialView={initialView} headerToolbar={false} firstDay={1} height="auto"
    editable={false} eventStartEditable={false} eventDurationEditable={false} selectable={false}
    nowIndicator dayMaxEvents={3} allDaySlot timeZone={timeZone} datesSet={datesSet}
    noEventsContent="Nothing scheduled in this view." eventTimeFormat={{ hour: "numeric", minute: "2-digit", meridiem: "short" }}
    events={events.map(e => ({ id: e.id, title: e.title, start: e.start, end: e.end, allDay: e.allDay,
      color: e.color, backgroundColor: e.color + "16", borderColor: e.color + "30", extendedProps: { data: e } }))}
    eventContent={info => {
      const event = info.event.extendedProps.data as CalendarEvent;
      return <button className="calendar-event" type="button" style={{ borderLeftColor: event.color }}
        aria-label={`View ${event.title}`} onClick={e => { e.stopPropagation(); openEvent(event.id); }}>
        {info.timeText && <span className="event-time">{info.timeText}</span>}
        <span className="event-title">{event.title}</span>
        <span className="event-source" title={(event.isMock ? "Sample · " : "") + providerNames[event.provider]}>{event.provider === "MICROSOFT" ? "O" : event.provider === "APPLE" ? "A" : event.provider === "GOOGLE" ? "G" : "S"}</span>
        {event.isMock && <span className="event-sample" aria-label="Sample event">S</span>}
      </button>;
    }} />;
}
