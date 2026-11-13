"use client";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "./ui/button";
export function SignOut({ onSignedOut }: { onSignedOut?: () => void } = {}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  return <div><Button variant="outline" disabled={pending} onClick={async () => {
    setPending(true); setError("");
    try {
      const result = await authClient.signOut();
      if (result.error) { setError("Unable to log out. Please try again."); return; }
      onSignedOut?.(); window.location.replace("/login");
    } catch { setError("Unable to connect. Please try again."); }
    finally { setPending(false); }
  }}>{pending ? "Logging out…" : "Log out"}</Button>{error && <p role="alert">{error}</p>}</div>;
}
