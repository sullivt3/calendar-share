import type { Metadata } from "next";
import Link from "next/link";
import Script from "next/script";
import { CalendarDays } from "lucide-react";
import "./globals.css";
export const metadata: Metadata = {
  title: { default: "Calendar Share", template: "%s · Calendar Share" },
  description: "One shared view of your schedules. Your calendars stay yours.",
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><body><Script id="theme-boot" strategy="beforeInteractive" dangerouslySetInnerHTML={{ __html: "(function(){try{var t=localStorage.getItem('calendar-theme');document.documentElement.dataset.theme=t==='DARK'||((!t||t==='SYSTEM')&&matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light'}catch(e){}})()" }} /><a className="skip-link" href="#main">Skip to content</a>
    <header className="mx-auto flex max-w-[1440px] items-center justify-between px-6 py-7">
      <Link href="/" className="flex items-center gap-3 text-lg font-bold tracking-tight"><span className="rounded-xl bg-blue-600 p-2 text-white"><CalendarDays size={22} aria-hidden /></span>Calendar Share</Link>
      <span className="text-xs font-medium uppercase tracking-widest text-slate-500">A little more in sync</span>
    </header>
    <main id="main" className="mx-auto max-w-[1440px] px-6 pb-16">{children}</main>
  </body></html>;
}
