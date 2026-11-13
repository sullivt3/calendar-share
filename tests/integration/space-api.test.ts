import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { auth } from "../../src/server/auth";
import { db } from "../../src/server/db";
import { GET, POST } from "../../src/app/api/spaces/route";
import { GET as detail, PATCH } from "../../src/app/api/spaces/[spaceId]/route";
import { PUT } from "../../src/app/api/spaces/[spaceId]/calendars/[calendarId]/route";
const email = `space-api-${randomUUID()}@example.test`;
const origin = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
let cookie = "", spaceId = "";
const request = (method: string, body?: unknown, withCookie = true, requestOrigin = origin) => new Request(origin + "/api/spaces", { method, headers: { "Content-Type": "application/json", origin: requestOrigin, ...(withCookie ? { cookie } : {}) }, ...(method !== "GET" ? { body: JSON.stringify(body ?? {}) } : {}) });
beforeAll(async () => {
  const response = await auth.api.signUpEmail({ body: { name: "API Test", email, password: "api-test-only-password" }, asResponse: true });
  cookie = response.headers.getSetCookie().map(v => v.split(";")[0]).join("; ");
});
afterAll(async () => {
  if (spaceId) await db.sharedSpace.deleteMany({ where: { id: spaceId } });
  await db.user.deleteMany({ where: { email } }); await db.$disconnect();
});
it("protects REST endpoints with sessions, origins, input validation and no-store", async () => {
  expect((await GET(request("GET", undefined, false))).status).toBe(401);
  expect((await POST(request("POST", { name: "Together" }, true, "https://attacker.invalid"))).status).toBe(403);
  expect((await POST(request("POST", { name: " " }))).status).toBe(400);
  const created = await POST(request("POST", { name: "Together" }));
  expect(created.status).toBe(200); spaceId = (await created.json()).id;
  const response = await detail(request("GET"), { params: Promise.resolve({ spaceId }) });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect((await response.json()).name).toBe("Together");
  expect((await PATCH(request("PATCH", { name: "Changed" }), { params: Promise.resolve({ spaceId }) })).status).toBe(200);
  expect((await detail(request("GET"), { params: Promise.resolve({ spaceId: randomUUID() }) })).status).toBe(404);
  expect((await detail(request("GET"), { params: Promise.resolve({ spaceId: "invalid" }) })).status).toBe(400);
  expect((await PUT(request("PUT", { mode: "PUBLIC" }), { params: Promise.resolve({ spaceId, calendarId: randomUUID() }) })).status).toBe(400);
});
