"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Button } from "./ui/button";
export function Invite({ signedIn }: { signedIn: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const token = window.location.hash.slice(1);
    if (/^[a-f0-9]{64}$/.test(token)) {
      sessionStorage.setItem("pending-invitation", token);
      history.replaceState(null, "", "/invite");
    }
    if (input.current) input.current.value = sessionStorage.getItem("pending-invitation") ?? "";
  }, []);
  return <section className="mx-auto mt-12 max-w-lg rounded-3xl border border-slate-200 bg-white p-8">
    <p className="text-sm font-semibold text-blue-600">A shared rhythm starts here</p><h1 className="my-4 text-3xl font-semibold">Join a shared space</h1>
    <p className="text-sm leading-relaxed text-slate-600">Accepting adds your account to the space. Your calendars remain private until you explicitly share them.</p>
    {!signedIn && <p className="mt-5 text-sm"><Link className="text-blue-700 underline" href="/login?next=/invite">Log in</Link> or <Link className="text-blue-700 underline" href="/register?next=/invite">create an account</Link> to accept. Your invitation stays in this tab while you sign in.</p>}
    <form method="post" className="mt-6 space-y-4" onSubmit={async e => {
      e.preventDefault(); setPending(true); setError("");
      try {
        const result = await api<{ spaceId: string }>("/api/invitations/accept", "POST", { token: input.current?.value });
        sessionStorage.removeItem("pending-invitation"); window.location.replace(`/spaces/${result.spaceId}`);
      } catch (e) { setError((e as Error).message); } finally { setPending(false); }
    }}>
      <label className="block text-sm font-medium">Invitation code<input ref={input} type="password" name="token" required pattern="[a-f0-9]{64}" autoComplete="off" maxLength={64} disabled={!signedIn} /></label>
      <Button type="submit" disabled={!signedIn || pending}>{pending ? "Joining…" : "Join shared space"}</Button>
    </form>{error && <p role="alert" className="mt-4 text-red-700">{error}</p>}
  </section>;
}
