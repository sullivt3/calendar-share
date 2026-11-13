export const connectionMessages: Record<string, string> = {
  REAUTH_REQUIRED: "Google access expired or was revoked. Reconnect this account.",
  ACCESS_DENIED: "Google denied calendar access. Your organization may restrict this app.",
  RATE_LIMIT: "Google's request limit was reached. Automatic retries respect its waiting period.",
  PROVIDER_UNAVAILABLE: "Google is temporarily unavailable. Synchronization will retry automatically.",
  CONFIG_MISSING: "The site owner's Google or encryption configuration needs attention.",
  INVALID_DATA: "Google returned unsupported data. This calendar is hidden until synchronization succeeds.",
  DATA_LIMIT: "This calendar exceeds the safety limit. Contact the site owner; incomplete data is hidden.",
  REVOKE_UNCONFIRMED: "Local calendar access is removed. Remote revocation could not be confirmed; remove Calendar Share in your Google account permissions.",
};
export type ConnectionList = {
  googleConfigured: boolean; pushConfigured: boolean;
  connections: {
    id: string; accountLabel: string | null; status: string; lastErrorCode: string | null; nextAllowedAt: string;
    jobs: { kind: string; status: string; runAt: string; lastErrorCode: string | null }[];
    calendars: {
      id: string; name: string; timeZone: string; isEnabled: boolean; syncEnabled: boolean;
      lastSyncedAt: string | null; lastErrorCode: string | null;
      syncState: { phase: string; windowStart: string | null; windowEnd: string | null } | null;
      subscriptions: { expiresAt: string }[];
    }[];
  }[];
};
