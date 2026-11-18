"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Link2, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "./ui/button";
import { api } from "@/lib/api";
import { connectionMessages, type ConnectionList } from "@/shared/connections";
const results: Record<string, string> = {
  connected: "Account connected. Calendars are being discovered; choose which ones to import below.",
  denied: "Provider access was declined. No new account was connected.",
  failed: "The provider connection could not be completed. Try again, and check that read-only calendar access was granted.",
  "login-required": "Please log in again before connecting an account.",
};
export function Connections({ initial, result }: { initial: ConnectionList; result?: string }) {
  const [data, setData] = useState(initial);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState(results[result ?? ""] ?? "");
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [selection, setSelection] = useState<{ connectionId: string; calendarId: string } | null>(null);
  async function refresh() { setData(await api<ConnectionList>("/api/connections")); }
  useEffect(() => {
    const abort = new AbortController();
    const timer = setInterval(async () => {
      if (document.visibilityState === "hidden") return;
      try {
        const response = await fetch("/api/connections", { cache: "no-store", signal: abort.signal });
        if (response.status === 401) { window.location.replace("/login"); return; }
        if (response.ok) setData(await response.json());
      } catch { /* Keep the last status; the next poll retries without exposing details. */ }
    }, 5000);
    return () => { clearInterval(timer); abort.abort(); };
  }, []);
  async function run(work: () => Promise<void>) {
    setPending(true); setError("");
    try { await work(); await refresh(); }
    catch (e) { setError((e as Error).message); }
    finally { setPending(false); }
  }
  return <div className="mx-auto mt-8 max-w-4xl space-y-7">
    <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-blue-700"><ArrowLeft size={15} />Your spaces</Link>
    <section className="rounded-3xl border border-slate-200 bg-white p-7 md:p-10">
      <p className="text-sm font-semibold text-blue-600">Your calendar accounts</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">Keep your calendars. Share your rhythm.</h1>
      <p className="mt-4 text-sm leading-relaxed text-slate-600">Connect Google or Outlook, then choose calendars to import. They stay private until you share them in a space. Calendar Share only reads events; all changes happen in the original provider.</p>
      {data.googleConfigured ? <Button className="mt-6" disabled={pending || data.connections.some(c => c.status === "DISCONNECTING")} onClick={() => void run(async () => {
        const response = await api<{ url: string }>("/api/providers/google/start", "POST");
        window.location.assign(response.url);
      })}><Link2 size={17} />Connect Google Calendar</Button>
      : <div className="mt-6 rounded-xl bg-slate-50 p-5 text-sm text-slate-600">Google is not configured on this installation. The site owner needs to enable its Google connection before accounts can be added. No live account is connected by the sample-data feature.</div>}
      {data.microsoftConfigured ? <Button className="mt-4" disabled={pending || data.connections.some(c => c.status === "DISCONNECTING")} onClick={() => void run(async () => {
        const response = await api<{ url: string }>("/api/providers/microsoft/start", "POST"); window.location.assign(response.url);
      })}><Link2 size={17} />Connect Microsoft Outlook</Button>
      : <p className="mt-4 rounded-xl bg-slate-50 p-5 text-sm text-slate-600">Microsoft Outlook is not configured on this installation. The site owner needs to enable Microsoft connections.</p>}
      <p className="mt-4 text-xs text-slate-500">Apple connections are coming later.</p>
    </section>
    {notice && <p role="status" className="rounded-xl border border-slate-200 bg-white p-4 text-sm">{notice}</p>}
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
    {data.connections.map(connection => { const microsoft = connection.provider === "MICROSOFT", provider = microsoft ? "Microsoft" : "Google", pushConfigured = microsoft ? data.microsoftPushConfigured : data.pushConfigured; return <section key={connection.id} className="rounded-3xl border border-slate-200 bg-white p-7">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="break-words text-xl font-semibold">{connection.accountLabel ?? provider + " account"}</h2><p className="mt-2 text-xs text-slate-500">{provider} · {connection.status.toLowerCase().replaceAll("_", " ")}</p></div>
        {["CONNECTED", "ERROR"].includes(connection.status) && <Button variant="outline" disabled={pending} onClick={() => void run(async () => {
          await api("/api/connections/" + connection.id + "/sync", "POST");
          setNotice("Synchronization requested. Events update automatically when processing finishes.");
        })}><RefreshCw size={15} />Sync now</Button>}
      </div>
      {connection.lastErrorCode && <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">{connectionMessages[connection.lastErrorCode] ?? "This connection needs attention. Try synchronizing or reconnecting."}</p>}
      {connection.status === "REAUTH_REQUIRED" && <p className="mt-4 text-sm">Use the matching provider’s Connect button above to grant read-only access again. Previously imported events are hidden until access is restored and calendars are selected again.</p>}
      {connection.status === "DISCONNECTING" && <p className="mt-4 text-sm text-slate-600">Local calendar access has been removed. Provider cleanup is being processed.</p>}
      {!pushConfigured && ["CONNECTED", "ERROR"].includes(connection.status) && <p className="mt-4 text-xs text-slate-500">Change notifications are not configured on this installation. Selected calendars reconcile automatically every 15 minutes.</p>}
      {connection.jobs.some(j => j.status === "PENDING" || j.status === "RUNNING") && <p className="mt-4 text-xs text-slate-500">Background synchronization queued or running. This page updates automatically.</p>}
      {connection.calendars.length === 0 && connection.status === "CONNECTED" && <p className="mt-5 text-sm text-slate-600">Calendar discovery is pending, or the provider has no eligible calendars with readable event access. Microsoft imports calendars owned by your own mailbox; shared/delegated calendars are excluded.</p>}
      <div className="mt-5 space-y-3">{connection.calendars.map(calendar => <div key={calendar.id} className="rounded-xl border border-slate-200 p-4">
        <label className="flex items-start gap-3 text-sm"><input className="!mt-1 !w-auto shrink-0" type="checkbox" aria-label={"Import " + calendar.name}
          checked={calendar.syncEnabled} disabled={pending || !calendar.isEnabled || !["CONNECTED", "ERROR"].includes(connection.status)}
          onChange={e => {
            if (!e.target.checked) { setSelection({ connectionId: connection.id, calendarId: calendar.id }); return; }
            void run(async () => { await api("/api/connections/" + connection.id + "/calendars/" + calendar.id, "PUT", { enabled: true }); });
          }} /><span><strong className="block break-words">{calendar.name}</strong><small className="mt-1 block text-slate-500">{calendar.timeZone} · {calendar.isEnabled ? calendar.syncEnabled ? "Import enabled" : "Not imported" : "Unavailable from provider"}</small></span>
        </label>
        {microsoft && <p className="mt-2 text-xs text-slate-500">{calendar.isPrimary ? "Primary calendar: automatic updates." : "Additional calendar: refreshed periodically."}</p>}
        {calendar.lastSyncedAt && <p className="mt-3 text-xs text-slate-500">Last synchronized {new Date(calendar.lastSyncedAt).toLocaleString()}</p>}
        {calendar.syncState?.windowStart && calendar.syncState.windowEnd && <p className="mt-2 text-xs text-slate-500">{microsoft ? "Downloaded event coverage:" : "Recurring event coverage:"} {new Date(calendar.syncState.windowStart).toLocaleDateString()} – {new Date(calendar.syncState.windowEnd).toLocaleDateString()}</p>}
        {calendar.syncEnabled && !calendar.lastSyncedAt && <p className="mt-3 text-xs text-slate-500">Waiting for the initial synchronization to finish.</p>}
        {calendar.syncEnabled && pushConfigured && <p className="mt-2 text-xs text-slate-500">{calendar.subscriptions.length ? "Change notifications active; periodic reconciliation also runs." : "Change notifications pending; periodic reconciliation remains active."}</p>}
        {calendar.lastErrorCode && <p className="mt-3 text-sm text-red-700">{connectionMessages[calendar.lastErrorCode] ?? "Calendar synchronization needs attention."}</p>}
      </div>)}</div>
      {selection?.connectionId === connection.id && <div className="mt-5 rounded-xl bg-slate-50 p-4 text-sm"><p>Stop importing this calendar? Its imported events and all space-sharing permissions will be removed.</p><div className="mt-3 flex flex-wrap gap-3">
        <Button disabled={pending} onClick={() => void run(async () => { await api("/api/connections/" + connection.id + "/calendars/" + selection.calendarId, "PUT", { enabled: false }); setSelection(null); })}>Stop importing calendar</Button>
        <Button variant="outline" disabled={pending} onClick={() => setSelection(null)}>Cancel</Button></div></div>}
      {connection.status !== "DISCONNECTED" && connection.status !== "DISCONNECTING" && <div className="mt-6 border-t border-slate-200 pt-5">
        {confirmation !== connection.id ? <Button variant="outline" disabled={pending} onClick={() => setConfirmation(connection.id)}>Disconnect {provider} account</Button>
          : <div className="space-y-3 text-sm"><p>Disconnect this account? Imported calendars and sharing permissions are removed immediately.</p><div className="flex flex-wrap gap-3"><Button disabled={pending} onClick={() => void run(async () => {
            await api("/api/connections/" + connection.id, "DELETE"); setConfirmation(null);
          })}>Confirm disconnect</Button><Button variant="outline" disabled={pending} onClick={() => setConfirmation(null)}>Cancel</Button></div></div>}
      </div>}
    </section>; })}
    <section className="rounded-3xl border border-slate-200 bg-white p-7 text-sm leading-relaxed text-slate-600"><h2 className="flex items-center gap-2 text-lg font-semibold"><ShieldCheck size={20} />Connection help</h2><ul className="mt-4 list-disc space-y-3 pl-5">
      <li>Importing is separate from sharing. Open a shared space’s settings to choose busy-only or full details for each imported calendar.</li>
      <li>If provider access expires, reconnect the account. Google testing-mode grants can expire; Microsoft organization policies may require administrator approval.</li>
      <li>Calendar Share never copies events into another provider or changes your source calendar.</li>
      <li>You can also remove this app in <a className="text-blue-700 underline" href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer">Google account permissions</a> or <a className="text-blue-700 underline" href="https://account.live.com/consent/Manage" target="_blank" rel="noopener noreferrer">Microsoft account permissions</a>. Work accounts may require your organization’s My Apps portal or administrator.</li>
    </ul></section>
  </div>;
}
