import { requireSession } from "@/server/session";
import { SignOut } from "@/components/sign-out";
import { ShieldCheck } from "lucide-react";
export const metadata = { title: "Your account" };
export default async function Dashboard() {
  const { user } = await requireSession();
  return <section className="mx-auto mt-14 max-w-2xl rounded-3xl border border-slate-200 bg-white p-8 md:p-12">
    <ShieldCheck className="mb-6 text-blue-600" size={36} />
    <p className="text-sm font-semibold uppercase tracking-widest text-blue-600">Your account is ready</p>
    <h1 className="mt-4 text-3xl font-semibold tracking-tight">Welcome, {user.name}.</h1>
    <p className="mt-4 leading-relaxed text-slate-600">You’re securely signed in as {user.email}. This foundation release includes your personal account. Shared spaces and invitations are planned for Phase 2.</p>
    <div className="mt-7 rounded-xl bg-slate-50 p-5 text-sm text-slate-600">Calendar connections, events, and synchronization are not available yet.</div>
    <div className="mt-8"><SignOut /></div>
  </section>;
}
