import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { authHandler } from "../../src/server/auth-handler";
import { db } from "../../src/server/db";

const testId = randomUUID();
const emails = [`alex-${testId}@example.test`, `sam-${testId}@example.test`];
const password = "integration-only-passphrase";
const origin = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
const request = (path: string, body: unknown, cookie?: string, requestOrigin = origin) =>
  authHandler(new Request(`${origin}/api/auth/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: requestOrigin, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  }));
const session = (cookie: string) => authHandler(new Request(`${origin}/api/auth/get-session`, { headers: { cookie } }));
function cookieOf(response: Response) {
  return response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
}
afterAll(async () => {
  await db.user.deleteMany({ where: { email: { in: emails } } });
  await db.$disconnect();
});
describe("real PostgreSQL authentication", () => {
  it("registers two isolated users, hashes passwords, logs in and revokes sessions", async () => {
    for (const [i, email] of emails.entries()) {
      const response = await request("sign-up/email", { name: i === 0 ? "Alex" : "Sam", email, password });
      expect(response.status).toBe(200);
      const cookie = cookieOf(response);
      expect(cookie).toContain("session_token=");
      expect(response.headers.get("set-cookie")).toMatch(/httponly/i);
      expect(response.headers.get("set-cookie")).toMatch(/samesite=lax/i);
      const account = await db.account.findFirstOrThrow({ where: { user: { email } } });
      expect(account.password).toBeTruthy();
      expect(account.password).not.toBe(password);
      const data = await (await session(cookie)).json();
      expect(data.user.email).toBe(email);
      expect(data.user.id).toMatch(/^[0-9a-f-]{36}$/);
    }
    const duplicate = await request("sign-up/email", { name: "Duplicate", email: emails[0], password });
    // Better Auth can intentionally return a synthetic response to avoid account enumeration.
    expect([200, 400, 422]).toContain(duplicate.status);
    expect(await db.user.count({ where: { email: emails[0] } })).toBe(1);
    const failed = await request("sign-in/email", { email: emails[0], password: "wrong-password" });
    expect(failed.status).toBe(401);
    const login = await request("sign-in/email", { email: emails[0], password });
    expect(login.status).toBe(200);
    const cookie = cookieOf(login);
    expect((await (await session(cookie)).json()).user.email).toBe(emails[0]);
    expect((await (await session("better-auth.session_token=forged")).json())).toBeNull();
    const logout = await request("sign-out", {}, cookie);
    expect(logout.status).toBe(200);
    expect(await (await session(cookie)).json()).toBeNull();
  });
  it("rejects untrusted origins and short passwords at the server boundary", async () => {
    expect((await request("sign-up/email", { name: "Alex", email: emails[0], password }, undefined, "https://attacker.invalid")).status).toBe(403);
    expect([400, 422]).toContain((await request("sign-up/email", { name: "Alex", email: emails[0], password: "short" })).status);
  });
  it("enforces authentication endpoint rate limits", async () => {
    let limited = false;
    for (let i = 0; i < 7; i++) {
      const response = await request("sign-in/email", { email: "missing@example.test", password });
      if (response.status === 429) { limited = true; break; }
    }
    expect(limited).toBe(true);
  });
});
