import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { auth } from "../../src/server/auth";
import { db } from "../../src/server/db";
import { resetAuthLimits } from "./database";
test.beforeEach(resetAuthLimits);
test("two people create, join, rename and leave a private space", async ({ browser, baseURL }, testInfo) => {
  const key = randomUUID();
  const emails = [`space-browser-a-${key}@example.test`, `space-browser-b-${key}@example.test`];
  const password = "shared-space-browser-test";
  let spaceId = "";
  const { viewport, isMobile, hasTouch, userAgent } = testInfo.project.use;
  const device = { viewport, isMobile, hasTouch, userAgent };
  const a = await browser.newContext(device), b = await browser.newContext(device);
  const owner = await a.newPage(), partner = await b.newPage();
  try {
    for (const [i, email] of emails.entries()) await auth.api.signUpEmail({ body: { name: i ? "Partner" : "Owner", email, password } });
    const ownerUser = await db.user.findUniqueOrThrow({ where: { email: emails[0] } });
    await db.providerConnection.create({ data: {
      userId: ownerUser.id, provider: "MOCK", externalId: key,
      calendars: { create: { externalId: key, name: "Mock personal calendar" } },
    } });
    await owner.goto(baseURL + "/login");
    await owner.getByLabel("Email", { exact: true }).fill(emails[0]);
    await owner.getByLabel("Password", { exact: true }).fill(password);
    await owner.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(owner.getByRole("heading", { name: "Welcome, Owner." })).toBeVisible();
    await owner.getByLabel("Space name").fill("Our time");
    await owner.getByRole("button", { name: "Create shared space" }).click();
    await expect(owner.getByRole("heading", { name: "Our time", exact: true })).toBeVisible();
    spaceId = new URL(owner.url()).pathname.split("/").pop()!;
    await owner.getByLabel("Sharing for Mock personal calendar").selectOption("BUSY_ONLY");
    await expect(owner.getByLabel("Sharing for Mock personal calendar")).toHaveValue("BUSY_ONLY");
    await owner.getByRole("button", { name: "Create invitation link" }).click();
    const linkInput = owner.getByLabel("Invitation link", { exact: true });
    await expect(linkInput).toBeVisible();
    const link = await linkInput.inputValue();
    await partner.goto(link);
    await expect(partner.getByRole("button", { name: "Join shared space" })).toBeDisabled();
    await partner.getByRole("link", { name: "Log in", exact: true }).click();
    await partner.getByLabel("Email", { exact: true }).fill(emails[1]);
    await partner.getByLabel("Password", { exact: true }).fill(password);
    await partner.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(partner).toHaveURL(/\/invite$/);
    await partner.getByRole("button", { name: "Join shared space" }).click();
    await expect(partner.getByRole("heading", { name: "Members · 2/2" })).toBeVisible();
    await expect(partner.getByText("Busy only", { exact: true })).toBeVisible();
    await owner.getByLabel("Sharing for Mock personal calendar").selectOption("NOT_SHARED");
    await expect(owner.getByLabel("Sharing for Mock personal calendar")).toHaveValue("NOT_SHARED");
    await partner.reload();
    await expect(partner.getByText("Mock personal calendar", { exact: true })).toHaveCount(0);
    await partner.getByLabel("Space name").fill("Together");
    await partner.getByRole("button", { name: "Save name" }).click();
    await expect(partner.getByRole("heading", { name: "Together", exact: true })).toBeVisible();
    await partner.getByRole("button", { name: "Leave shared space", exact: true }).click();
    await partner.getByRole("button", { name: "Confirm leave", exact: true }).click();
    await expect(partner).toHaveURL(/\/dashboard$/);
    await partner.goto(baseURL + "/spaces/" + spaceId);
    await expect(partner.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await owner.reload();
    await expect(owner.getByRole("heading", { name: "Members · 1/2" })).toBeVisible();
    await expect(owner.getByRole("heading", { name: "Together", exact: true })).toBeVisible();
  } finally {
    await a.close(); await b.close();
    if (spaceId) await db.sharedSpace.deleteMany({ where: { id: spaceId } });
    await db.user.deleteMany({ where: { email: { in: emails } } });
  }
});
test.afterAll(async () => db.$disconnect());
