"use client";
import * as Dialog from "@radix-ui/react-dialog";
import { CalendarDays, Clock3, MapPin, LockKeyhole, X, Repeat2 } from "lucide-react";
import type { CalendarEvent } from "@/shared/calendar";
import { providerNames } from "@/shared/calendar";
export function EventDialog({ event, close, restoreFocus, timeZone }: {
  event: CalendarEvent | undefined; close: () => void; restoreFocus: () => void; timeZone: "local" | "UTC";
}) {
  const time = (value: string) => {
    if (event?.allDay) return new Date(value + "T12:00:00Z").toLocaleDateString(undefined, { dateStyle: "medium", timeZone: "UTC" });
    return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short", ...(timeZone === "UTC" ? { timeZone: "UTC" } : {}) });
  };
  return <Dialog.Root open={!!event} onOpenChange={open => { if (!open) close(); }}>
    <Dialog.Portal><Dialog.Overlay className="event-overlay" /><Dialog.Content className="event-dialog" onCloseAutoFocus={e => { e.preventDefault(); restoreFocus(); }}>
      {event && <>
        <div className="event-accent" style={{ background: event.color }} />
        <div className="dialog-eyebrow">{event.isMock ? "Sample event · " : ""}Read-only</div>
        <Dialog.Title className="dialog-title">{event.title}</Dialog.Title>
        <Dialog.Description className="dialog-description">{event.details === "busy" ? "Only availability is shared for this event." : "Event changes happen in the original calendar app."}</Dialog.Description>
        <div className="event-facts">
          <p><Clock3 size={17} /><span>{time(event.start)}{event.allDay ? (Date.parse(event.end) - Date.parse(event.start) > 86400000 ? " – " + time(new Date(Date.parse(event.end) - 86400000).toISOString().slice(0, 10)) : "") + " · All day" : " – " + time(event.end)}<small>{event.allDay ? "All-day event" : "Display: " + (timeZone === "UTC" ? "UTC" : "your local time")}{!event.allDay && " · Original timezone: " + event.timeZone}</small></span></p>
          <p><CalendarDays size={17} /><span>{event.ownerName}<small>{event.calendarName} · {providerNames[event.provider] ?? event.provider}{event.isMock ? " (sample)" : ""}</small></span></p>
          <p><LockKeyhole size={17} /><span>{event.busy ? "Busy" : "Free"}<small>{event.details === "busy" ? "Event details are private." : "Details visible to you."}</small></span></p>
          {event.details === "full" && event.location && <p><MapPin size={17} /><span>{event.location}</span></p>}
          {event.details === "full" && event.recurring && <p><Repeat2 size={17} /><span>Part of a recurring series</span></p>}
        </div>
        {event.details === "full" && event.description && <div className="event-description">{event.description}</div>}
      </>}
      <Dialog.Close asChild><button className="icon-control dialog-close" aria-label="Close event details"><X size={19} /></button></Dialog.Close>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
