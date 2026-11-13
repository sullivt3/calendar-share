import { encryptionConfigured } from "../credentials";
import { GoogleError } from "./errors";
export function googleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID, clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const base = process.env.BETTER_AUTH_URL;
  if (!clientId || !clientSecret || !base || !encryptionConfigured()) throw new GoogleError("CONFIG_MISSING");
  let url: URL;
  try { url = new URL(base); } catch { throw new GoogleError("CONFIG_MISSING"); }
  if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new GoogleError("CONFIG_MISSING");
  return { clientId, clientSecret, redirectUri: new URL("/api/providers/google/callback", url).toString() };
}
export function googleConfigured() { try { googleConfig(); return true; } catch { return false; } }
export function webhookAddress(): string | null {
  const value = process.env.GOOGLE_WEBHOOK_URL;
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.pathname !== "/api/providers/google/webhook")
      return null;
    return url.toString();
  } catch { return null; }
}
