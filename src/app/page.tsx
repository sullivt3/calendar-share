import Link from "next/link";
import { ArrowRight, LockKeyhole, Eye, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
export default function Home() {
  return <div className="grid items-center gap-14 py-16 md:grid-cols-2 md:py-28">
    <section><p className="mb-5 text-sm font-semibold uppercase tracking-widest text-blue-600">Your time, together</p>
      <h1 className="text-5xl font-semibold leading-tight tracking-tight md:text-6xl">Two schedules.<br /><span className="text-blue-600">One shared view.</span></h1>
      <p className="mt-6 max-w-md text-lg leading-relaxed text-slate-600">A calmer way to see when life lines up. A shared calendar for the schedules you already keep in Google, Outlook, and Apple.</p>
      <div className="mt-9 flex flex-wrap gap-3"><Button asChild><Link href="/register">Create an account <ArrowRight size={17} /></Link></Button><Button asChild variant="outline"><Link href="/login">Log in</Link></Button></div>
      <p className="mt-5 text-sm text-slate-500">Shared spaces and read-only Google and Outlook connections · Apple is coming next.</p>
    </section>
    <section aria-label="Our principles" className="rounded-3xl border border-slate-200 bg-white p-8 shadow-xl shadow-slate-200/40">
      <div className="mb-8 flex items-center gap-3"><CalendarDays className="text-blue-600" /><h2 className="text-xl font-semibold">Made for a shared rhythm</h2></div>
      {[{ Icon: Eye, title: "A window into your day", body: "The planned calendar experience is read-only. Event changes always happen in the original app." }, { Icon: LockKeyhole, title: "Private from the start", body: "Separate accounts, private shared spaces, and calendars you explicitly choose to share." }].map(({ Icon, title, body }) => <div key={title} className="mt-7 flex gap-4"><Icon className="mt-1 shrink-0 text-blue-600" size={21} /><div><h3 className="font-semibold">{title}</h3><p className="mt-2 text-sm leading-relaxed text-slate-600">{body}</p></div></div>)}
    </section>
  </div>;
}
