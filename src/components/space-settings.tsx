"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "./ui/button";
import { api } from "@/lib/api";
type Calendar = { id: string; name: string; ownerId: string; ownerName: string; provider: string; mode: string; includeDescription: boolean };
type Space = { id: string; name: string; members: { user: { id: string; name: string } }[]; invitations: { id: string; expiresAt: string }[] };
export function SpaceSettings({ space, userId, calendars }: { space: Space; userId: string; calendars: Calendar[] }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [link, setLink] = useState("");
  const [expires, setExpires] = useState("");
  const [confirmLeave, setConfirmLeave] = useState(false);
  async function run(work: () => Promise<void>, refresh = true) {
    setPending(true); setError("");
    try { await work(); if (refresh) router.refresh(); } catch (e) { setError((e as Error).message); } finally { setPending(false); }
  }
  const base = `/api/spaces/${space.id}`;
  return <div className="mx-auto mt-8 max-w-3xl space-y-8">
    <div className="flex flex-wrap justify-between gap-4"><Link className="text-sm text-blue-700 underline" href="/dashboard">← Your spaces</Link>
      <Link className="text-sm font-semibold text-blue-700 underline" href={`/spaces/${space.id}/calendar`}>Open shared calendar →</Link></div>
    <section className="rounded-3xl border border-slate-200 bg-white p-7">
      <p className="text-sm font-semibold text-blue-600">Private shared space</p><h1 className="mt-3 text-3xl font-semibold">{space.name}</h1>
      <form method="post" className="mt-6 space-y-3" onSubmit={e => { e.preventDefault(); const name = new FormData(e.currentTarget).get("name"); void run(async () => { await api(base, "PATCH", { name }); }); }}>
        <label className="block text-sm font-medium">Space name<input name="name" defaultValue={space.name} required maxLength={80} /></label><Button disabled={pending}>Save name</Button>
      </form>
      <h2 className="mt-8 text-lg font-semibold">Members · {space.members.length}/2</h2>
      <ul className="mt-3 space-y-2">{space.members.map(m => <li key={m.user.id} className="rounded-xl bg-slate-50 p-3">{m.user.name}{m.user.id === userId ? " (you)" : ""}</li>)}</ul>
      <p className="mt-3 text-sm text-slate-600">Both members can rename the space, manage their own sharing, and leave.</p>
    </section>
    <section className="rounded-3xl border border-slate-200 bg-white p-7"><h2 className="text-xl font-semibold">Invite your person</h2>
      <p className="my-4 text-sm leading-relaxed text-slate-600">Links expire after 24 hours and work once. Creating a new link invalidates the previous one. Share it privately.</p>
      {space.members.length < 2 && <Button disabled={pending} onClick={() => void run(async () => {
        const result = await api<{ token: string; expiresAt: string }>(base + "/invitations", "POST");
        setLink(`${window.location.origin}/invite#${result.token}`); setExpires(result.expiresAt);
      })}>{space.invitations.length ? "Replace invitation link" : "Create invitation link"}</Button>}
      {space.members.length >= 2 && <p className="text-sm text-slate-600">This space has two members.</p>}
      {link && <div className="mt-5 space-y-3"><label className="block text-sm font-medium">Invitation link<input readOnly value={link} onFocus={e => e.target.select()} /></label>
        <p className="text-xs text-slate-500">Expires {new Date(expires).toLocaleString()}. This link is only shown in this browser session.</p>
      </div>}
      {(space.invitations.length > 0 || link) && <Button className="mt-4" variant="outline" disabled={pending} onClick={() => void run(async () => { await api(base + "/invitations", "DELETE"); setLink(""); })}>Revoke invitation</Button>}
    </section>
    <section className="rounded-3xl border border-slate-200 bg-white p-7"><h2 className="text-xl font-semibold">Calendar sharing</h2>
      <p className="my-4 text-sm text-slate-600">Calendars start private. Only the owner can change sharing. Private events always appear as busy to other members.</p>
      {!calendars.length && <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">No connected calendars yet. Provider connections arrive in Phases 4–6.</p>}
      {calendars.map(c => <div key={c.id} className="my-4 rounded-xl border border-slate-200 p-4"><p className="font-semibold">{c.name}</p><p className="my-2 text-sm text-slate-500">{c.ownerName} · {c.provider}</p>
        {c.ownerId === userId ? <label className="text-sm">Sharing for {c.name}<select className="mt-2 block w-full rounded-lg border border-slate-300 p-3" value={c.mode} disabled={pending} onChange={e => { const mode = e.target.value; void run(async () => { await api(base + `/calendars/${c.id}`, "PUT", { mode }); }); }}>
          <option value="NOT_SHARED">Not shared</option><option value="BUSY_ONLY">Busy only</option><option value="FULL_DETAILS">Full details</option>
        </select></label> : <p className="text-sm">{c.mode === "BUSY_ONLY" ? "Busy only" : "Full details"}</p>}
        {c.ownerId === userId && c.mode === "FULL_DETAILS" && <label className="mt-3 flex items-center gap-3 text-sm"><input className="!m-0 !w-auto" type="checkbox" checked={c.includeDescription} disabled={pending} onChange={e => {
          const includeDescription = e.target.checked;
          void run(async () => { await api(base + `/calendars/${c.id}`, "PUT", { mode: c.mode, includeDescription }); });
        }} />Share descriptions for {c.name}</label>}
      </div>)}
    </section>
    <section className="rounded-3xl border border-slate-200 bg-white p-7"><h2 className="text-xl font-semibold">Leave this space</h2><p className="my-4 text-sm text-slate-600">Your calendar sharing is removed immediately. All invitation links are invalidated. If you are the last member, the space is deleted.</p>
      {!confirmLeave ? <Button variant="outline" onClick={() => setConfirmLeave(true)}>Leave shared space</Button> : <div className="flex flex-wrap gap-3"><Button disabled={pending} onClick={() => void run(async () => { await api(base, "DELETE"); window.location.replace("/dashboard"); }, false)}>Confirm leave</Button><Button variant="outline" disabled={pending} onClick={() => setConfirmLeave(false)}>Cancel</Button></div>}
    </section>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-700">{error}</p>}
  </div>;
}
