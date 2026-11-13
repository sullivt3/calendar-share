import Link from "next/link";
import { requireSession } from "@/server/session";
import { SignOut } from "@/components/sign-out";
import { Spaces } from "@/components/spaces";
import { listSpaces } from "@/server/spaces";
import { ShieldCheck } from "lucide-react";
export const metadata = { title: "Your account" };
export default async function Dashboard() {
  const { user } = await requireSession();
  return <section className="mx-auto mt-14 max-w-2xl rounded-3xl border border-slate-200 bg-white p-8 md:p-12">
    <ShieldCheck className="mb-6 text-blue-600" size={36} />
    <p className="text-sm font-semibold uppercase tracking-widest text-blue-600">Your account is ready</p>
    <h1 className="mt-4 text-3xl font-semibold tracking-tight">Welcome, {user.name}.</h1>
    <p className="mt-4 leading-relaxed text-slate-600">You’re securely signed in as {user.email}. Create a private space or open one below to manage members and sharing.</p>
    <Link href="/connections" className="mt-7 block rounded-xl bg-slate-50 p-5 text-sm font-semibold text-blue-700">Manage calendar accounts →</Link>
    <Spaces initial={await listSpaces(user.id)} />
    <div className="mt-8"><SignOut /></div>
  </section>;
}
