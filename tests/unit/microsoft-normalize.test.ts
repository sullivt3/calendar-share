import { expect, it } from "vitest";
import { normalizeMicrosoftEvent, microsoftZone } from "../../src/server/microsoft/normalize";
import type { MicrosoftEvent } from "../../src/server/microsoft/contracts";
const sample = (changes: Partial<MicrosoftEvent> = {}): MicrosoftEvent => ({ id: "event", subject: "Private meeting", sensitivity: "private", start: { dateTime: "2026-11-01T05:30:00.0000000", timeZone: "UTC" }, end: { dateTime: "2026-11-01T06:30:00.0000000", timeZone: "UTC" }, originalStartTimeZone: "Eastern Standard Time", type: "exception", seriesMasterId: "series", originalStart: "2026-11-01T05:30:00Z", ...changes });
it("normalizes Windows/IANA zones, UTC instants and DST recurrence exceptions", () => {
  expect(microsoftZone("Eastern Standard Time")).toBe("America/New_York"); expect(microsoftZone("Europe/London")).toBe("Europe/London");
  const result = normalizeMicrosoftEvent(sample())!;
  expect(result.start.toISOString()).toBe("2026-11-01T05:30:00.000Z"); expect(result.end.toISOString()).toBe("2026-11-01T06:30:00.000Z");
  expect(result.timeZone).toBe("America/New_York"); expect(result.privacy).toBe("PRIVATE"); expect(result.seriesId).toBe("series");
});
it("preserves exclusive all-day dates across DST and UTC conversion", () => {
  const event = sample({ isAllDay: true, start: { dateTime: "2026-11-01T04:00:00", timeZone: "UTC" }, end: { dateTime: "2026-11-02T05:00:00", timeZone: "UTC" } });
  const result = normalizeMicrosoftEvent(event)!;
  expect(result.start.toISOString()).toBe("2026-11-01T00:00:00.000Z"); expect(result.end.toISOString()).toBe("2026-11-02T00:00:00.000Z");
});
it("removes cancelled/tombstone records and conservatively redacts missing privacy", () => {
  expect(normalizeMicrosoftEvent({ id: "gone", "@removed": { reason: "deleted" } })).toBeNull();
  expect(normalizeMicrosoftEvent(sample({ isCancelled: true }))).toBeNull();
  expect(normalizeMicrosoftEvent(sample({ sensitivity: undefined }))!.privacy).toBe("CONFIDENTIAL");
  expect(normalizeMicrosoftEvent(sample({ sensitivity: "normal", body: { contentType: "html", content: "<script>evil</script>" } }))!.description).toBeNull();
});
it("rejects unsupported zones, invalid times and unexpanded series masters", () => {
  expect(() => microsoftZone("Unsupported timezone")).toThrow("INVALID_DATA");
  expect(() => normalizeMicrosoftEvent(sample({ end: { dateTime: "invalid", timeZone: "UTC" } }))).toThrow("INVALID_DATA");
  expect(() => normalizeMicrosoftEvent(sample({ originalStart: "invalid" }))).toThrow("INVALID_DATA");
  expect(() => normalizeMicrosoftEvent(sample({ type: "seriesMaster" }))).toThrow("INVALID_DATA");
});
