"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { loginSchema, registrationSchema } from "@/shared/auth";
import { Button } from "./ui/button";
export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const register = mode === "register";
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const parsed = (register ? registrationSchema : loginSchema).safeParse(data);
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    setPending(true);
    try {
      const result = register
        ? await authClient.signUp.email({ ...parsed.data, name: String(data.name).trim() })
        : await authClient.signIn.email(parsed.data);
      if (result.error) {
        setError(result.error.status === 429 ? "Too many attempts. Please try again in a minute." : register ? "Unable to create your account. Check your details or try logging in." : "Unable to log in. Check your email and password.");
      } else { router.replace("/dashboard"); router.refresh(); }
    } catch { setError("Unable to connect. Please try again."); }
    finally { setPending(false); }
  }
  return <section className="mx-auto mt-12 max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
    <p className="mb-3 text-sm font-semibold text-blue-600">{register ? "A fresh start" : "Welcome back"}</p>
    <h1 className="text-3xl font-semibold tracking-tight">{register ? "Create your account" : "Log in to your space"}</h1>
    <p className="mt-3 text-sm leading-relaxed text-slate-600">Your own account. Your own calendars. A little more time together.</p>
    <form method="post" className="mt-7 space-y-5" onSubmit={submit}>
      {register && <label className="block text-sm font-medium">Name<input name="name" autoComplete="name" required maxLength={80} /></label>}
      <label className="block text-sm font-medium">Email<input name="email" type="email" autoComplete="email" required maxLength={254} /></label>
      <label className="block text-sm font-medium">Password<input name="password" type="password" autoComplete={register ? "new-password" : "current-password"} required minLength={12} maxLength={128} aria-describedby="password-help" /></label>
      <p id="password-help" className="text-xs text-slate-500">Use at least 12 characters.</p>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <Button className="w-full" disabled={pending} type="submit">{pending ? "Please wait…" : register ? "Create account" : "Log in"}</Button>
    </form>
    <p className="mt-6 text-center text-sm text-slate-600">{register ? "Already have an account?" : "New here?"} <Link className="font-semibold text-blue-600 underline-offset-4 hover:underline" href={register ? "/login" : "/register"}>{register ? "Log in" : "Create an account"}</Link></p>
  </section>;
}
