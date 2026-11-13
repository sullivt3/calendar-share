import { describe, expect, it } from "vitest";
import { projectEvent } from "../../src/server/event-projection";
import { rangeSchema, preferenceSchema, type CalendarInfo } from "../../src/shared/calendar";
import type { Event } from "../../src/generated/prisma/client";
const calendar: CalendarInfo = { id: "calendar", ownerId: "owner", ownerName: "Alex", name: "Personal", provider: "GOOGLE", isMock: true, color: "#2563eb", mode: "FULL_DETAILS", includeDescription: false, lastSyncedAt: null };
const event: Event = {
  id: "id", calendarId: "calendar", externalId: "PROVIDER_SECRET_ID", title: "SECRET_TITLE",
  start: new Date("2026-11-01T05:30:00Z"), end: new Date("2026-11-01T06:30:00Z"),
  allDay: false, timeZone: "America/New_York", location: "SECRET_LOCATION", description: "SECRET_DESCRIPTION",
  privacy: "PUBLIC", busy: true, cancelled: false, recurrenceRule: "SECRET_RULE", seriesId: "SECRET_SERIES",
  originalStart: null, exceptions: null, providerVersion: "SECRET_VERSION", updatedAt: new Date(),
};
describe("event privacy projection", () => {
  it("gives owners details even for private, unshared events", () => {
    expect(projectEvent({ ...event, privacy: "PRIVATE" }, { ...calendar, mode: "NOT_SHARED" }, "owner")).toMatchObject({ title: "SECRET_TITLE", description: "SECRET_DESCRIPTION", details: "full" });
  });
  it.each(["PRIVATE", "CONFIDENTIAL"] as const)("redacts provider %s restrictions despite full sharing", privacy => {
    const dto = projectEvent({ ...event, privacy }, { ...calendar, includeDescription: true }, "peer");
    expect(dto).toMatchObject({ title: "Busy", details: "busy" });
    expect(JSON.stringify(dto)).not.toContain("SECRET");
    expect(dto).not.toHaveProperty("location"); expect(dto).not.toHaveProperty("recurring");
  });
  it("never sends details in busy-only mode", () => {
    const dto = projectEvent(event, { ...calendar, mode: "BUSY_ONLY", includeDescription: true }, "peer");
    expect(JSON.stringify(dto)).not.toContain("SECRET");
    expect(dto).not.toHaveProperty("description");
  });
  it("requires explicit description sharing and never exposes provider identifiers", () => {
    const dto = projectEvent(event, calendar, "peer");
    expect(dto).toMatchObject({ title: "SECRET_TITLE", details: "full", recurring: true });
    expect(dto).not.toHaveProperty("description");
    expect(dto).not.toHaveProperty("externalId"); expect(dto).not.toHaveProperty("providerVersion"); expect(dto).not.toHaveProperty("recurrenceRule");
    expect(projectEvent(event, { ...calendar, includeDescription: true }, "peer")).toHaveProperty("description", "SECRET_DESCRIPTION");
  });
  it("preserves distinct instants through a daylight-saving fallback", () => {
    const dto = projectEvent(event, calendar, "owner");
    expect(Date.parse(dto.end) - Date.parse(dto.start)).toBe(3600000);
    expect(dto.timeZone).toBe("America/New_York");
  });
  it("keeps all-day dates and exclusive ends independent of browser timezone", () => {
    const dto = projectEvent({ ...event, allDay: true, start: new Date("2026-11-01T00:00:00Z"), end: new Date("2026-11-03T00:00:00Z") }, calendar, "owner");
    expect(dto.start).toBe("2026-11-01"); expect(dto.end).toBe("2026-11-03");
  });
  it("bounds query ranges and validates preference colors", () => {
    expect(rangeSchema.safeParse({ start: "2026-01-01T00:00:00Z", end: "2027-01-01T00:00:00Z" }).success).toBe(false);
    expect(rangeSchema.safeParse({ start: "2026-03-08T00:00:00-05:00", end: "2026-03-09T00:00:00-04:00" }).success).toBe(true);
    expect(preferenceSchema.safeParse({ displayColor: "red;background:url(secret)" }).success).toBe(false);
  });
});
