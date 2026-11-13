"use client";
import { Button } from "@/components/ui/button";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <section className="mx-auto mt-16 max-w-md space-y-5"><h1 className="text-2xl font-semibold">Something went wrong</h1><p>Please try again in a moment.</p><Button onClick={reset}>Try again</Button></section>;
}
