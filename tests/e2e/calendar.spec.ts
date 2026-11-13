import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { db } from "../../src/server/db";
import { auth } from "../../src/server/auth";
import { createSpace, invite, acceptInvitation, setSharing } from "../../src/server/spaces";
import { resetAuthLimits } from "./database";
test.beforeEach(resetAuthLimits);
test("read-only views, privacy, filters, preferences and live updates", async ({ page }, testInfo) => {
  test.setTimeout(180000);
  const mobile = testInfo.project.name === "mobile";
  const emails = [`calendar-browser-a-${randomUUID()}@example.test`, `calendar-browser-b-${randomUUID()}@example.test`];
  const ids: string[] = [];
  let space = "";
  const day = new Date().toISOString().slice(0, 10);
  const start = new Date(day + "T12:00:00Z"), end = new Date(day + "T13:00:00Z");
  let event = "", ownCalendar = "", sharedCalendar = "";
  try {
    for (const [i, email] of emails.entries()) {
      await auth.api.signUpEmail({ body: { name: i ? "Calendar Partner" : "Calendar Demo", email, password: "calendar-browser-password" } });
      ids.push((await db.user.findUniqueOrThrow({ where: { email } })).id);
    }
    space = (await createSpace(ids[0], "Our calendar")).id;
    await acceptInvitation(ids[1], (await invite(ids[0], space)).token);
    const connection = await db.providerConnection.create({ data: { userId: ids[0], provider: "MOCK", externalId: randomUUID() } });
    ownCalendar = (await db.calendar.create({ data: { connectionId: connection.id, externalId: "personal", mockProvider: "GOOGLE", name: "Sample personal" } })).id;
    event = (await db.event.create({ data: { calendarId: ownCalendar, externalId: "coffee", title: "Sample coffee", description: "A friendly sample note", location: "Corner cafe", timeZone: "America/New_York", start, end, privacy: "PUBLIC" } })).id;
    const peerConnection = await db.providerConnection.create({ data: { userId: ids[1], provider: "MOCK", externalId: randomUUID() } });
    sharedCalendar = (await db.calendar.create({ data: { connectionId: peerConnection.id, externalId: "work", mockProvider: "MICROSOFT", name: "Sample work" } })).id;
    await setSharing(ids[1], space, sharedCalendar, "FULL_DETAILS");
    await db.event.createMany({ data: [
      { calendarId: sharedCalendar, externalId: "studio", title: "Team studio", description: "NEVER_SHARED_DESCRIPTION", location: "Studio", start, end, privacy: "PUBLIC" },
      { calendarId: sharedCalendar, externalId: "private", title: "SECRET_APPOINTMENT", description: "SECRET_DESCRIPTION", location: "SECRET_LOCATION", start, end, privacy: "PRIVATE" },
    ] });
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(emails[0]);
    await page.getByLabel("Password", { exact: true }).fill("calendar-browser-password");
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Welcome, Calendar Demo." })).toBeVisible();
    await page.getByRole("link", { name: "Our calendar →", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Our calendar", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "View Sample coffee", exact: true })).toBeVisible({ timeout: 30000 });
    await expect(page.getByText("Live view connected", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Calendar view", { exact: true })).toHaveValue(mobile ? "listWeek" : "dayGridMonth");
    await expect(page.getByRole("button", { name: /create event|edit event|delete event/i })).toHaveCount(0);
    const queryStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)).toISOString();
    const queryEnd = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)).toISOString();
    const response = await page.request.get(`/api/spaces/${space}/events?start=${queryStart}&end=${queryEnd}`);
    const payload = JSON.stringify(await response.json());
    expect(payload).not.toContain("SECRET_"); expect(payload).not.toContain("NEVER_SHARED_DESCRIPTION");
    const openCoffee = () => page.getByRole("button", { name: "View Sample coffee", exact: true });
    await openCoffee().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Sample coffee" })).toBeVisible();
    await expect(dialog.getByText("Corner cafe", { exact: true })).toBeVisible();
    await expect(dialog.getByText("A friendly sample note", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(openCoffee()).toBeFocused();
    await page.getByRole("button", { name: "View Busy", exact: true }).click();
    await expect(dialog.getByRole("heading", { name: "Busy", exact: true })).toBeVisible();
    await expect(dialog).not.toContainText("SECRET");
    await page.keyboard.press("Escape");
    for (const value of ["timeGridWeek", "timeGridDay", "listWeek", "dayGridMonth"]) {
      await page.getByLabel("Calendar view", { exact: true }).selectOption(value);
      await expect(page.locator(".fc-" + value + "-view")).toBeVisible();
    }
    await page.getByRole("button", { name: "Next dates" }).click();
    await page.getByRole("button", { name: "Previous dates" }).click();
    await page.getByRole("button", { name: "Today", exact: true }).click();
    if (mobile) await page.getByRole("button", { name: "Filters & calendars" }).click();
    await page.getByLabel("Filter by provider", { exact: true }).selectOption("GOOGLE");
    await expect(page.getByRole("button", { name: "View Team studio", exact: true })).toHaveCount(0);
    await expect(openCoffee()).toBeVisible();
    await page.getByLabel("Filter by provider", { exact: true }).selectOption("");
    await page.getByLabel("Filter by person", { exact: true }).selectOption(ids[1]);
    await expect(openCoffee()).toHaveCount(0);
    await expect(page.getByRole("button", { name: "View Team studio", exact: true })).toBeVisible();
    await page.getByLabel("Filter by person", { exact: true }).selectOption("");
    await page.getByRole("checkbox", { name: "Show Sample personal for Calendar Demo" }).uncheck();
    await expect(openCoffee()).toHaveCount(0);
    await page.getByRole("checkbox", { name: "Show Sample personal for Calendar Demo" }).check();
    await expect(openCoffee()).toBeVisible();
    await page.getByLabel("Your display color", { exact: true }).fill("#dd6633");
    await page.getByRole("button", { name: "Save color", exact: true }).click();
    await expect.poll(async () => (await db.userPreference.findUnique({ where: { userId: ids[0] } }))?.displayColor).toBe("#dd6633");
    await page.getByRole("button", { name: "Theme: system", exact: true }).click();
    await expect(page.getByRole("button", { name: "Theme: light", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Theme: light", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByLabel("Display timezone", { exact: true }).selectOption("UTC");
    await page.getByRole("button", { name: "Refresh calendar view" }).click();
    await expect(openCoffee()).toBeVisible();
    let navigations = 0;
    page.on("framenavigated", frame => { if (frame === page.mainFrame()) navigations++; });
    await db.event.update({ where: { id: event }, data: { title: "Updated coffee" } });
    await expect(page.getByRole("button", { name: "View Updated coffee", exact: true })).toBeVisible({ timeout: 15000 });
    expect(navigations).toBe(0);
    await db.event.delete({ where: { id: event } });
    await expect(page.getByRole("button", { name: "View Updated coffee", exact: true })).toHaveCount(0, { timeout: 15000 });
    await setSharing(ids[1], space, sharedCalendar, "NOT_SHARED");
    await expect(page.getByRole("button", { name: "View Team studio", exact: true })).toHaveCount(0, { timeout: 15000 });
    await page.getByRole("button", { name: "Load my sample calendars", exact: true }).click();
    await expect(page.getByRole("checkbox", { name: "Show Sample · Life for Calendar Demo", exact: true })).toBeVisible({ timeout: 20000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (mobile) {
      await page.getByRole("button", { name: "Filters & calendars" }).click();
      await page.getByLabel("Calendar view", { exact: true }).selectOption("listWeek");
      await expect(page.locator(".fc-list")).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "View Coffee & a catch-up", exact: true }).first()).toBeVisible();
    await expect(page.getByText("Updating your view…", { exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("calendar.png"), fullPage: true });
    await db.sharedSpaceMember.delete({ where: { spaceId_userId: { spaceId: space, userId: ids[0] } } });
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 15000 });
  } finally {
    if (space) await db.sharedSpace.deleteMany({ where: { id: space } });
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }
});
test.afterAll(async () => db.$disconnect());
