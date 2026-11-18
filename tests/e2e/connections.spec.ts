import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { auth } from "../../src/server/auth";
import { db } from "../../src/server/db";
import { resetAuthLimits } from "./database";
test.beforeEach(resetAuthLimits);
for (const provider of ["GOOGLE", "MICROSOFT"] as const) {
test(`manages own mocked ${provider} metadata without implying live provider authorization`, async ({ page }, testInfo) => {
  const email = "google-browser-" + randomUUID() + "@example.test", password = "google-browser-test-password";
  let userId = "";
  try {
    const result = await auth.api.signUpEmail({ body: { name: "Provider tester", email, password } }); userId = result.user.id;
    const connection = await db.providerConnection.create({ data: { userId, provider, externalId: randomUUID(), accountLabel: `Mocked ${provider} account (test)`, calendars: { create: { externalId: "test-calendar", name: "Mocked personal calendar", syncEnabled: false } } } });
    await page.goto("/login"); await page.getByLabel("Email", { exact: true }).fill(email); await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Log in", exact: true }).click(); await expect(page).toHaveURL(/\/dashboard$/);
    await page.getByRole("link", { name: /calendar accounts/i }).click();
    await expect(page.getByRole("heading", { name: "Keep your calendars. Share your rhythm." })).toBeVisible();
    await expect(page.getByText("Google is not configured on this installation.", { exact: false })).toBeVisible();
    const checkbox = page.getByRole("checkbox", { name: "Import Mocked personal calendar" });
    await checkbox.click(); await expect(checkbox).toBeChecked();
    await expect(page.getByText("Waiting for the initial synchronization to finish.")).toBeVisible();
    await page.getByRole("button", { name: "Sync now", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Synchronization requested");
    expect(await db.syncJob.count({ where: { connectionId: connection.id } })).toBe(3);
    await checkbox.click(); await expect(page.getByText("Stop importing this calendar?", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Stop importing calendar", exact: true }).click(); await expect(checkbox).not.toBeChecked();
    await page.screenshot({ path: testInfo.outputPath("connections.png"), fullPage: true });
    await page.getByRole("button", { name: `Disconnect ${provider === "MICROSOFT" ? "Microsoft" : "Google"} account`, exact: true }).click();
    await page.getByRole("button", { name: "Confirm disconnect", exact: true }).click();
    await expect(page.getByText("Local calendar access has been removed.", { exact: false })).toBeVisible();
    expect((await db.providerConnection.findUniqueOrThrow({ where: { id: connection.id } })).status).toBe("DISCONNECTING");
  } finally { if (userId) await db.user.deleteMany({ where: { id: userId } }); }
});
}
test.afterAll(async () => db.$disconnect());
for (const provider of ["google", "microsoft"]) {
test(`${provider} OAuth callback uses privacy headers and a fixed safe redirect`, async ({ request }) => {
  const response = await request.get("/api/providers/" + provider + "/callback?state=TEST_ONLY_STATE&code=TEST_ONLY_CODE", { maxRedirects: 0 });
  expect(response.status()).toBe(303);
  expect(response.headers()["referrer-policy"]).toBe("no-referrer");
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(response.headers().location).toMatch(new RegExp("/connections\\?" + provider + "=login-required$"));
  expect(response.headers().location).not.toContain("TEST_ONLY");
});

}
