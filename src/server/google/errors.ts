export type GoogleErrorCode = "CONFIG_MISSING" | "INVALID_DATA" | "REAUTH_REQUIRED" | "ACCESS_EXPIRED" | "ACCESS_DENIED" | "NOT_FOUND" | "CURSOR_EXPIRED" | "RATE_LIMIT" | "PROVIDER_UNAVAILABLE" | "DATA_LIMIT";
export class GoogleError extends Error {
  constructor(public code: GoogleErrorCode, public retryAfterMs = 0) { super(code); }
}
export class LostLease extends Error {}
export class CancelledJob extends Error {}
