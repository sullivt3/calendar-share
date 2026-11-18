export const connectionMessages: Record<string, string> = {
  MICROSOFT_CONSENT_REMOVAL: "Local tokens and imported calendars are removed. You can also remove Calendar Share consent in your Microsoft account permissions.",
  POLICY_BLOCKED: "Your organization requires additional sign-in or has restricted calendar access. Reconnect or contact your administrator.",
  REAUTH_REQUIRED: "Provider access expired or was revoked. Reconnect this account.",
  ACCESS_DENIED: "The provider denied calendar access. Your organization may restrict this app.",
  RATE_LIMIT: "The provider's request limit was reached. Automatic retries respect its waiting period.",
  PROVIDER_UNAVAILABLE: "The provider is temporarily unavailable. Synchronization will retry automatically.",
  CONFIG_MISSING: "The site owner's provider or encryption configuration needs attention.",
  INVALID_DATA: "The provider returned unsupported data. This calendar is hidden until synchronization succeeds.",
  DATA_LIMIT: "This calendar exceeds the safety limit. Contact the site owner; incomplete data is hidden.",
  REVOKE_UNCONFIRMED: "Local calendar access is removed. Remote revocation could not be confirmed; remove Calendar Share in the provider account permissions.",
};
export type ConnectionList = {
  googleConfigured: boolean; pushConfigured: boolean; microsoftConfigured: boolean; microsoftPushConfigured: boolean;
  connections: {
    id: string; provider: "GOOGLE" | "MICROSOFT"; accountLabel: string | null; status: string; lastErrorCode: string | null; nextAllowedAt: string;
    jobs: { kind: string; status: string; runAt: string; lastErrorCode: string | null }[];
    calendars: {
      id: string; name: string; timeZone: string; isPrimary: boolean; isEnabled: boolean; syncEnabled: boolean;
      lastSyncedAt: string | null; lastErrorCode: string | null;
      syncState: { phase: string; windowStart: string | null; windowEnd: string | null } | null;
      subscriptions: { expiresAt: string }[];
    }[];
  }[];
};
