export type MicrosoftErrorCode = "DATA_LIMIT" | "CONFIG_MISSING" | "INVALID_DATA" | "REAUTH_REQUIRED" | "ACCESS_EXPIRED" | "ACCESS_DENIED" | "NOT_FOUND" | "CURSOR_EXPIRED" | "RATE_LIMIT" | "PROVIDER_UNAVAILABLE" | "POLICY_BLOCKED";
export class MicrosoftError extends Error {
  constructor(public code: MicrosoftErrorCode, public retryAfterMs = 0) { super(code); }
}
export function classifyMicrosoftError(status: number, body: unknown, retryAfter: string | null = null) {
  const error = typeof body === "object" && body !== null && "error" in body ? body.error : undefined;
  const code = typeof error === "string" ? error : typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  if (["invalid_grant", "interaction_required", "login_required", "consent_required"].includes(code)) return new MicrosoftError("REAUTH_REQUIRED");
  if (["invalid_client", "unauthorized_client"].includes(code)) return new MicrosoftError("CONFIG_MISSING");
  if (code === "insufficient_claims") return new MicrosoftError("POLICY_BLOCKED");
  if (status === 429) {
    const delay = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter ?? "") - Date.now();
    return new MicrosoftError("RATE_LIMIT", Number.isFinite(delay) ? Math.max(1000, Math.min(86400000, delay)) : 60000);
  }
  if (status === 401) return new MicrosoftError("ACCESS_EXPIRED");
  if (status === 403) return new MicrosoftError("ACCESS_DENIED");
  if (status === 404) return new MicrosoftError("NOT_FOUND");
  if (status === 410 || ["syncStateNotFound", "SyncStateNotFound", "InvalidDeltaToken", "ErrorInvalidSyncStateData"].includes(code)) return new MicrosoftError("CURSOR_EXPIRED");
  if (status >= 500 || status === 408) return new MicrosoftError("PROVIDER_UNAVAILABLE");
  return new MicrosoftError("INVALID_DATA");
}
