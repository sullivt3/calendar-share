import { db } from "./db";
import { lock, member, SpaceError } from "./spaces";
import type { EventPrivacy } from "../generated/prisma/client";

export const mockEnabled = () => process.env.ENABLE_MOCK_CALENDARS === "true" && process.env.NODE_ENV !== "production";
export async function loadMockCalendars(userId: string, spaceId: string) {
  if (!mockEnabled()) throw new SpaceError(403, "Sample calendars are disabled.");
  return db.$transaction(async tx => {
    await lock(tx, spaceId); await member(tx, userId, spaceId);
    const connection = await tx.providerConnection.upsert({
      where: { userId_provider_externalId: { userId, provider: "MOCK", externalId: "phase3-samples" } },
      create: { userId, provider: "MOCK", externalId: "phase3-samples" }, update: {},
    });
    const now = new Date(), monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
    for (const [index, provider, name] of [[0, "GOOGLE", "Sample · Personal"], [1, "MICROSOFT", "Sample · Work"], [2, "APPLE", "Sample · Life"]] as const) {
      const calendar = await tx.calendar.upsert({
        where: { connectionId_externalId: { connectionId: connection.id, externalId: provider } },
        create: { connectionId: connection.id, externalId: provider, name, mockProvider: provider, lastSyncedAt: now },
        update: { lastSyncedAt: now },
      });
      const keys: string[] = [];
      for (let week = -3; week <= 4; week++) {
        const start = new Date(monday);
        start.setUTCDate(start.getUTCDate() + week * 7 + index + 1);
        start.setUTCHours(index === 0 ? 17 : index === 1 ? 14 : 0);
        const end = new Date(start.getTime() + (index === 2 ? 86400000 : 3600000));
        const externalId = "sample-" + start.toISOString().slice(0, 10);
        keys.push(externalId);
        const data = {
          title: index === 0 ? "Coffee & a catch-up" : index === 1 ? "Project check-in" : "A little time outside",
          start, end, allDay: index === 2, timeZone: "UTC",
          location: index === 0 ? "The corner café" : index === 1 ? "Studio" : "Local park",
          description: "Sample event for trying Calendar Share. No external account is connected.",
          privacy: "PUBLIC" as EventPrivacy, busy: true, seriesId: "sample-weekly-" + index,
          recurrenceRule: "FREQ=WEEKLY;COUNT=8", providerVersion: "sample-v1",
        };
        await tx.event.upsert({ where: { calendarId_externalId: { calendarId: calendar.id, externalId } }, create: { calendarId: calendar.id, externalId, ...data }, update: data });
      }
      const start = new Date(monday); start.setUTCDate(start.getUTCDate() + 4);
      start.setUTCHours(16 + index);
      const externalId = "sample-private"; keys.push(externalId);
      const privateData = { title: "Private sample appointment", start, end: new Date(start.getTime() + 1800000), timeZone: "America/New_York", location: "Private sample location", description: "Only the owner can see this sample description.", privacy: "PRIVATE" as EventPrivacy, busy: true };
      await tx.event.upsert({ where: { calendarId_externalId: { calendarId: calendar.id, externalId } }, create: { calendarId: calendar.id, externalId, ...privateData }, update: privateData });
      await tx.event.deleteMany({ where: { calendarId: calendar.id, externalId: { notIn: keys } } });
      // Do not create or modify shares. Loading samples never opts into sharing.
    }
    return { ok: true };
  }, { timeout: 20000 });
}
