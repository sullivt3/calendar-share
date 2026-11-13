import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { db } from "../../src/server/db";
test("registration, protected account and logout", async ({ page, request }) => {
  const email = `browser-${randomUUID()}@example.test`;
  try {
    expect((await request.get("/api/me")).status()).toBe(401);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
    await page.getByRole("link", { name: "Create an account", exact: true }).click();
    await expect(page.locator("form")).toHaveAttribute("method", "post");
    await page.getByLabel("Name", { exact: true }).fill("Browser Demo");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill("browser-only-passphrase");
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Welcome, Browser Demo." })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: "Log out", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill("browser-only-passphrase");
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Welcome, Browser Demo." })).toBeVisible();
    await page.getByRole("button", { name: "Log out", exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
  } finally {
    await db.user.deleteMany({ where: { email } });
  }
});
test.afterAll(async () => db.$disconnect());
