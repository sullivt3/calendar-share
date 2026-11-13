import { describe, expect, it } from "vitest";
import { normalizeGoogleEvent, googleTime } from "../../src/server/google/normalize";
import { sampleGoogleEvent } from "../fixtures/google";
describe("Google authoritative event normalization", () => {
  it("preserves all-day exclusive ends and original timezone", () => {
    const event = normalizeGoogleEvent(sampleGoogleEvent("all-day", { start: { date: "2026-11-01" }, end: { date: "2026-11-03" } }), "Pacific/Auckland")!;
    expect(event.start.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(event.end.toISOString()).toBe("2026-11-03T00:00:00.000Z");
    expect(event.allDay).toBe(true); expect(event.timeZone).toBe("Pacific/Auckland");
  });
  it("normalizes floating local time across daylight-saving transitions", () => {
    expect(googleTime({ dateTime: "2026-03-01T09:00:00", timeZone: "America/New_York" }, "UTC").date.toISOString()).toBe("2026-03-01T14:00:00.000Z");
    expect(googleTime({ dateTime: "2026-03-08T09:00:00", timeZone: "America/New_York" }, "UTC").date.toISOString()).toBe("2026-03-08T13:00:00.000Z");
    expect(googleTime({ dateTime: "2026-11-01T01:30:00-05:00", timeZone: "America/New_York" }, "UTC").date.toISOString()).toBe("2026-11-01T06:30:00.000Z");
  });
  it("keeps recurrence exceptions and conservatively inherits series privacy", () => {
    const master = sampleGoogleEvent("master", { visibility: "private", recurrence: ["RRULE:FREQ=WEEKLY;COUNT=10"] });
    const event = normalizeGoogleEvent(sampleGoogleEvent("exception", { recurringEventId: "master", originalStartTime: { dateTime: "2026-11-01T01:30:00-04:00" } }), "UTC", master)!;
    expect(event.privacy).toBe("PRIVATE"); expect(event.seriesId).toBe("master");
    expect(event.recurrenceRule).toBe("RRULE:FREQ=WEEKLY;COUNT=10");
    expect(event.originalStart?.toISOString()).toBe("2026-11-01T05:30:00.000Z");
  });
  it("handles minimal cancellation tombstones and rejects malformed times", () => {
    expect(normalizeGoogleEvent({ id: "deleted", status: "cancelled" }, "UTC")).toBeNull();
    expect(() => googleTime({ dateTime: "not-a-time" }, "UTC")).toThrow("INVALID_DATA");
    expect(() => normalizeGoogleEvent(sampleGoogleEvent("bad", { end: { dateTime: "2020-01-01T00:00:00Z" } }), "UTC")).toThrow("INVALID_DATA");
    expect(normalizeGoogleEvent(sampleGoogleEvent("no-details", { summary: undefined }), "UTC")?.privacy).toBe("CONFIDENTIAL");
  });
});
