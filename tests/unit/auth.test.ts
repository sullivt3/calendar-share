import { describe, expect, it } from "vitest";
import { loginSchema, registrationSchema } from "../../src/shared/auth";
describe("authentication input", () => {
  it("normalizes an email and trims a display name", () => {
    expect(registrationSchema.parse({ name: " Alex ", email: "ALEX@example.test", password: "long-passphrase-123" })).toEqual({ name: "Alex", email: "alex@example.test", password: "long-passphrase-123" });
  });
  it.each([
    { name: " ", email: "a@example.test", password: "long-passphrase-123" },
    { name: "Alex", email: "not-an-email", password: "long-passphrase-123" },
    { name: "Alex", email: "a@example.test", password: "short" },
    { name: "Alex", email: "a@example.test", password: "a".repeat(129) },
  ])("rejects invalid registration %#", (input) => {
    expect(registrationSchema.safeParse(input).success).toBe(false);
  });
  it("does not trim or alter a password", () => {
    expect(loginSchema.parse({ email: "alex@example.test", password: "  long passphrase  " }).password).toBe("  long passphrase  ");
  });
});
