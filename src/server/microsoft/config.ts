import { encryptionConfigured } from "../credentials";
import { MicrosoftError } from "./errors";
export function microsoftConfig() {
  const clientId = process.env.MICROSOFT_CLIENT_ID, clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  try {
    const url = new URL(process.env.BETTER_AUTH_URL ?? "");
    if (!clientId || !clientSecret || !encryptionConfigured() || url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
      (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) throw new Error();
    return { clientId, clientSecret, redirectUri: new URL("/api/providers/microsoft/callback", url).toString() };
  } catch { throw new MicrosoftError("CONFIG_MISSING"); }
}
export function microsoftConfigured() { try { microsoftConfig(); return true; } catch { return false; } }
export function microsoftWebhookAddress() {
  try {
    const url = new URL(process.env.MICROSOFT_WEBHOOK_URL ?? "");
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/api/providers/microsoft/webhook" || ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return null;
    return url.toString();
  } catch { return null; }
}
