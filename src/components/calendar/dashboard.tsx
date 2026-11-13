"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import type FullCalendar from "@fullcalendar/react";
import type { DatesSetArg } from "@fullcalendar/core";
import { ArrowLeft, ChevronLeft, ChevronRight, SlidersHorizontal, RefreshCw, Settings2, Moon, Sun, Monitor, FlaskConical, CalendarDays, LockKeyhole } from "lucide-react";
import type { CalendarData, CalendarRange, Preference } from "@/shared/calendar";
import { connectionMessages } from "@/shared/connections";
import { providerNames } from "@/shared/calendar";
import { api } from "@/lib/api";
import { SignOut } from "@/components/sign-out";
import { EventDialog } from "./event-dialog";

const Canvas = dynamic(() => import("./canvas"), { ssr: false, loading: () => <div className="calendar-loading">Preparing your calendar…</div> });
type Props = { userId: string; userName: string; spaceId: string; spaceName: string; demoEnabled: boolean };
export function CalendarDashboard(props: Props) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0 } } }));
  useEffect(() => () => client.clear(), [client]);
  return <QueryClientProvider client={client}><CalendarView {...props} /></QueryClientProvider>;
}
class CalendarRequestError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
function CalendarView({ userId, userName, spaceId, spaceName, demoEnabled }: Props) {
  const client = useQueryClient();
  const calendarRef = useRef<FullCalendar | null>(null);
  const focusRef = useRef<HTMLElement | null>(null);
  const [range, setRange] = useState<Pick<CalendarRange, "start" | "end"> | null>(null);
  const [title, setTitle] = useState("");
  const [view, setView] = useState("dayGridMonth");
  const [person, setPerson] = useState("");
  const [provider, setProvider] = useState("");
  const [hidden, setHidden] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sidebar, setSidebar] = useState(false);
  const [connected, setConnected] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [zone, setZone] = useState<"local" | "UTC">("local");
  const base = `/api/spaces/${spaceId}`;
  const key = ["calendar", userId, spaceId];
  const params = new URLSearchParams({ ...(range ?? {}), ...(person ? { person } : {}), ...(provider ? { provider } : {}) });
  const query = useQuery<CalendarData>({
    queryKey: [...key, params.toString()],
    enabled: !!range,
    queryFn: async ({ signal }) => {
      const response = await fetch(base + "/events?" + params, { cache: "no-store", signal });
      const result = await response.json();
      if (!response.ok) throw new CalendarRequestError(response.status, result.error ?? "Unable to load your calendar.");
      return result;
    },
    refetchInterval: 60000,
  });
  // Never render old events or a detail dialog after an authorization/query error.
  const data = query.isError ? undefined : query.data;
  const events = data?.events.filter(e => !hidden.includes(e.calendarId)) ?? [];
  const selected = events.find(e => e.id === selectedId);
  const outsideCoverage = !!range && data?.calendars.some(c => !c.isMock && c.coverageStart && c.coverageEnd && (Date.parse(range.start) < Date.parse(c.coverageStart) || Date.parse(range.end) > Date.parse(c.coverageEnd)));
  const preference = data?.preference;
  useEffect(() => {
    if (!range) return;
    const stream = new EventSource(base + "/stream?" + new URLSearchParams(range));
    const clearAndRefresh = () => { void client.resetQueries({ queryKey: ["calendar", userId, spaceId] }); };
    stream.onopen = () => setConnected(true);
    stream.onerror = () => { setConnected(false); clearAndRefresh(); };
    stream.addEventListener("invalidate", clearAndRefresh);
    stream.addEventListener("unavailable", () => { setConnected(false); clearAndRefresh(); });
    stream.addEventListener("revoked", () => { client.clear(); window.location.replace("/dashboard"); });
    return () => { stream.close(); };
  }, [range, base, userId, spaceId, client]);
  useEffect(() => {
    if (!preference) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme = preference.theme === "DARK" || (preference.theme === "SYSTEM" && media.matches) ? "dark" : "light";
      try { localStorage.setItem("calendar-theme", preference.theme); } catch { /* Server preferences still work when browser storage is disabled. */ }
    };
    apply(); media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [preference]);
  const datesSet = useCallback((arg: DatesSetArg) => {
    setTitle(arg.view.title); setView(arg.view.type);
    setRange(previous => previous?.start === arg.startStr && previous?.end === arg.endStr ? previous : { start: arg.startStr, end: arg.endStr });
  }, []);
  async function savePreference(input: Partial<Preference>) {
    setPending(true); setError("");
    try { await api("/api/preferences", "PATCH", input); await client.resetQueries({ queryKey: key }); }
    catch (e) { setError((e as Error).message); } finally { setPending(false); }
  }
  return <div className="calendar-shell">
    <div className="calendar-heading"><div><Link className="back-link" href="/dashboard"><ArrowLeft size={14} /> Your spaces</Link><p className="eyebrow">A little more in sync</p><h1>{data?.space.name ?? spaceName}</h1><p className="calendar-subtitle">Your schedules, side by side. More room for time together.</p></div>
      <div className="heading-actions"><Link className="soft-control" href="/connections">Accounts</Link><div className="member-avatars" aria-label="Space members">{data?.members.map(m => <span key={m.id} title={m.name} style={{ background: m.color }}>{m.name.charAt(0)}</span>)}</div><Link className="soft-control" href={`/spaces/${spaceId}`}><Settings2 size={17} /> Space settings</Link></div>
    </div>
    <div className="calendar-workspace">
      <button className="soft-control mobile-filter" aria-expanded={sidebar} aria-controls="calendar-filters" onClick={() => setSidebar(!sidebar)}><SlidersHorizontal size={16} /> Filters & calendars</button>
      <aside id="calendar-filters" className="calendar-sidebar" data-open={sidebar}>
        <div className="sidebar-intro"><CalendarDays size={22} /><div><strong>Our calendars</strong><small>One place. A shared rhythm.</small></div></div>
        <section><h2>People</h2><label className="sr-only" htmlFor="person-filter">Filter by person</label><select id="person-filter" value={person} onChange={e => setPerson(e.target.value)}><option value="">Everyone</option>{data?.members.map(m => <option key={m.id} value={m.id}>{m.name}{m.id === userId ? " (you)" : ""}</option>)}</select>
          <div className="person-legend">{data?.members.map(m => <span key={m.id}><i style={{ background: m.color }} />{m.name}</span>)}</div>
        </section>
        <section><h2>Sources</h2><label className="sr-only" htmlFor="provider-filter">Filter by provider</label><select id="provider-filter" value={provider} onChange={e => setProvider(e.target.value)}><option value="">All providers</option>{["GOOGLE", "MICROSOFT", "APPLE", "MOCK"].map(p => <option key={p} value={p}>{providerNames[p]}</option>)}</select></section>
        <section><h2>Calendars <span>{data?.calendars.length ?? 0}</span></h2>
          {!data?.calendars.length && <p className="muted-copy">Choose calendars to share in space settings, or load your own samples below.</p>}
          {data?.calendars.map(c => <label key={c.id} className="calendar-source"><input type="checkbox" aria-label={`Show ${c.name} for ${c.ownerName}`} checked={!hidden.includes(c.id)} onChange={() => setHidden(previous => previous.includes(c.id) ? previous.filter(id => id !== c.id) : [...previous, c.id])} style={{ accentColor: c.color }} /><span><strong>{c.name}</strong><small>{c.ownerName} · {providerNames[c.provider]}{c.isMock ? " · Sample" : ""}</small><small>{c.lastSyncedAt ? (c.isMock ? "Sample loaded " : "Last synced ") + new Date(c.lastSyncedAt).toLocaleString() : c.isMock ? "Sample data" : "Not synchronized"}</small>{c.errorCode && <small>{connectionMessages[c.errorCode] ?? "Synchronization delayed"}</small>}{c.coverageStart && c.coverageEnd && <small>Recurring coverage: {new Date(c.coverageStart).toLocaleDateString()} – {new Date(c.coverageEnd).toLocaleDateString()}</small>}</span></label>)}
        </section>
        {demoEnabled && <section className="sample-loader"><FlaskConical size={20} /><strong>Try a shared rhythm</strong><p>Load three sample calendars for your account. They start private, and never connect to a provider.</p><button className="soft-control" disabled={pending} onClick={async () => {
          setPending(true); setError("");
          try { await api(base + "/samples", "POST"); await client.resetQueries({ queryKey: key }); }
          catch (e) { setError((e as Error).message); } finally { setPending(false); }
        }}>{pending ? "Please wait…" : "Load my sample calendars"}</button></section>}
        <section className="sidebar-profile"><strong>{userName}</strong><form onSubmit={e => { e.preventDefault(); const color = String(new FormData(e.currentTarget).get("color")); void savePreference({ displayColor: color }); }}>
          <label>Your display color<input aria-label="Your display color" type="color" name="color" key={preference?.displayColor ?? "default"} defaultValue={data?.members.find(m => m.id === userId)?.color ?? "#2563eb"} /></label><button className="text-control" disabled={pending}>Save color</button>
        </form><button className="soft-control" disabled={pending} onClick={() => void savePreference({ theme: preference?.theme === "LIGHT" ? "DARK" : preference?.theme === "DARK" ? "SYSTEM" : "LIGHT" })}>
          {preference?.theme === "DARK" ? <Moon size={16} /> : preference?.theme === "LIGHT" ? <Sun size={16} /> : <Monitor size={16} />}Theme: {preference?.theme?.toLowerCase() ?? "system"}
        </button><SignOut onSignedOut={() => client.clear()} /></section>
      </aside>
      <section className="calendar-main" aria-label="Shared calendar">
        <div className="calendar-toolbar"><div className="date-navigation"><button className="icon-control" aria-label="Previous dates" onClick={() => calendarRef.current?.getApi().prev()}><ChevronLeft size={19} /></button><button className="icon-control" aria-label="Next dates" onClick={() => calendarRef.current?.getApi().next()}><ChevronRight size={19} /></button><h2 aria-live="polite">{title || "Your calendar"}</h2><button className="soft-control today-control" onClick={() => calendarRef.current?.getApi().today()}>Today</button></div>
          <div className="view-controls"><label className="sr-only" htmlFor="view-select">Calendar view</label><select id="view-select" value={view} onChange={e => calendarRef.current?.getApi().changeView(e.target.value)}><option value="dayGridMonth">Month</option><option value="timeGridWeek">Week</option><option value="timeGridDay">Day</option><option value="listWeek">Agenda</option></select>
            <label className="sr-only" htmlFor="timezone-select">Display timezone</label><select id="timezone-select" value={zone} onChange={e => setZone(e.target.value as "local" | "UTC")}><option value="local">Local time</option><option value="UTC">UTC</option></select>
            <button className="icon-control" aria-label="Refresh calendar view" disabled={query.isFetching} onClick={() => void client.resetQueries({ queryKey: key })}><RefreshCw size={16} className={query.isFetching ? "is-spinning" : ""} /></button>
          </div>
        </div>
        <div className="calendar-status"><span><i className={connected ? "status-dot online" : "status-dot"} />{connected ? "Live view connected" : "Reconnecting live view"}</span><span><LockKeyhole size={13} /> Read-only</span><span>{data?.calendars.some(c => c.isMock) ? "Sample calendars · No live accounts connected" : "Only calendars shared with you appear here"}</span></div>
        {data?.calendars.some(c => c.isMock) && <div className="sample-banner"><FlaskConical size={15} /> Sample data is clearly labeled. Google accounts can be connected from Accounts; Outlook and Apple are planned.</div>}
        {outsideCoverage && <div className="sample-banner">This view extends beyond downloaded Google recurring-event coverage. Check the coverage dates in the sidebar.</div>}
        {error && <p className="calendar-error" role="alert">{error}</p>}
        {query.isError && <p className="calendar-error" role="alert">{query.error.message}<button className="text-control" onClick={() => void query.refetch()}>Try again</button></p>}
        {query.isFetching && <div className="loading-line" role="status">Updating your view…</div>}
        <div className="calendar-canvas"><Canvas calendarRef={calendarRef} events={events} datesSet={datesSet} timeZone={zone} openEvent={id => { focusRef.current = document.activeElement as HTMLElement; setSelectedId(id); }} /></div>
        <div className="calendar-footnote"><span>{events.length} events in this view</span><span>Times shown in {zone === "UTC" ? "UTC" : "your local timezone"}</span></div>
      </section>
    </div>
    <EventDialog event={selected} close={() => setSelectedId(null)} restoreFocus={() => { if (focusRef.current?.isConnected) focusRef.current.focus(); }} timeZone={zone} />
  </div>;
}
