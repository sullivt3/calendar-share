"use client";
import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "./ui/button";
import { api } from "@/lib/api";
export function Spaces({ initial }: { initial: { id: string; name: string }[] }) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError("");
    try {
      const space = await api<{ id: string }>("/api/spaces", "POST", { name: new FormData(event.currentTarget).get("name") });
      form.current?.reset(); router.push(`/spaces/${space.id}`);
    } catch (e) { setError((e as Error).message); } finally { setPending(false); }
  }
  return <section className="mt-8 border-t border-slate-200 pt-8"><h2 className="text-xl font-semibold">Your shared spaces</h2>
    <ul className="my-5 space-y-3">{initial.map(s => <li key={s.id}><Link className="block rounded-xl border border-slate-200 p-4 font-semibold text-blue-700 hover:bg-blue-50" href={`/spaces/${s.id}/calendar`}>{s.name} →</Link></li>)}</ul>
    {!initial.length && <p className="my-5 text-sm text-slate-600">Create a private space, then invite one person to join you.</p>}
    <form ref={form} method="post" onSubmit={create} className="space-y-4"><label className="block text-sm font-medium">Space name<input name="name" required maxLength={80} placeholder="Our schedules" /></label><Button type="submit" disabled={pending}>{pending ? "Creating…" : "Create shared space"}</Button></form>
    {error && <p role="alert" className="mt-4 text-red-700">{error}</p>}
  </section>;
}
