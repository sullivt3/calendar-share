import { randomBytes } from "node:crypto";
import { vi } from "vitest";
export function googleTestEnvironment() {
  vi.stubEnv("GOOGLE_CLIENT_ID", "calendar-test.apps.googleusercontent.com");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "TEST_ONLY_CLIENT_SECRET");
  vi.stubEnv("PROVIDER_ENCRYPTION_KEY_ID", "v1");
  vi.stubEnv("PROVIDER_ENCRYPTION_KEYS", JSON.stringify({ v1: randomBytes(32).toString("base64") }));
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
  vi.stubEnv("GOOGLE_WEBHOOK_URL", "https://calendar.example.test/api/providers/google/webhook");
}
