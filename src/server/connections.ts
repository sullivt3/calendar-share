import { db } from "./db";
import { SpaceError } from "./spaces";
import { enqueue, jobKey } from "./sync/queue";
import { microsoftConfigured, microsoftWebhookAddress } from "./microsoft/config";
import { googleConfigured, webhookAddress } from "./google/config";

export async function listConnections(userId: string) {
  const connections = await db.providerConnection.findMany({ where: { userId, provider: { in: ["GOOGLE", "MICROSOFT"] } }, orderBy: { id: "asc" },
    select: { id: true, provider: true, accountLabel: true, status: true, lastErrorCode: true, nextAllowedAt: true,
      calendars: { orderBy: { name: "asc" }, select: { id: true, name: true, timeZone: true, isPrimary: true, isEnabled: true,
        syncEnabled: true, lastSyncedAt: true, lastErrorCode: true,
        syncState: { select: { phase: true, windowStart: true, windowEnd: true } },
        subscriptions: { where: { status: "ACTIVE", expiresAt: { gt: new Date() } }, select: { expiresAt: true } },
      } },
      jobs: { select: { kind: true, status: true, runAt: true, lastErrorCode: true } },
    } });
  return { microsoftConfigured: microsoftConfigured(), microsoftPushConfigured: !!microsoftWebhookAddress(), googleConfigured: googleConfigured(), pushConfigured: !!webhookAddress(), connections: connections.map(connection => ({
    ...connection, provider: connection.provider === "MICROSOFT" ? "MICROSOFT" as const : "GOOGLE" as const, nextAllowedAt: connection.nextAllowedAt.toISOString(),
    jobs: connection.jobs.map(job => ({ ...job, runAt: job.runAt.toISOString() })),
    calendars: connection.calendars.map(calendar => ({
      ...calendar, lastSyncedAt: calendar.lastSyncedAt?.toISOString() ?? null,
      syncState: calendar.syncState ? { ...calendar.syncState, windowStart: calendar.syncState.windowStart?.toISOString() ?? null, windowEnd: calendar.syncState.windowEnd?.toISOString() ?? null } : null,
      subscriptions: calendar.subscriptions.map(subscription => ({ expiresAt: subscription.expiresAt.toISOString() })),
    })),
  })) };
}
export async function requestDiscovery(userId: string, connectionId: string) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM provider_connections WHERE id = ${connectionId}::uuid FOR UPDATE`;
    const connection = await tx.providerConnection.findFirst({ where: { id: connectionId, userId, provider: { in: ["GOOGLE", "MICROSOFT"] }, status: { in: ["CONNECTED", "ERROR"] } } });
    if (!connection) throw new SpaceError(404, "Connection not found.");
    if (connection.lastManualSyncAt && connection.lastManualSyncAt.getTime() > Date.now() - 10000)
      throw new SpaceError(429, "Please wait a few seconds before requesting another sync.");
    await tx.providerConnection.update({ where: { id: connectionId }, data: { lastManualSyncAt: new Date() } });
    await enqueue(tx, "DISCOVER", connectionId);
    await tx.syncJob.updateMany({ where: { dedupeKey: jobKey("DISCOVER", connectionId), status: "FAILED" },
      data: { status: "PENDING", attempts: 0, runAt: new Date(Math.max(Date.now(), connection.nextAllowedAt.getTime())), lastErrorCode: null } });
    const calendars = await tx.calendar.findMany({ where: { connectionId, syncEnabled: true, isEnabled: true } });
    for (const calendar of calendars) {
      await enqueue(tx, "SYNC", connectionId, calendar.id);
      await enqueue(tx, "WATCH", connectionId, calendar.id);
      await tx.syncJob.updateMany({ where: { dedupeKey: jobKey("WATCH", connectionId, calendar.id), status: "FAILED" },
        data: { status: "PENDING", attempts: 0, runAt: new Date(Math.max(Date.now(), connection.nextAllowedAt.getTime())), lastErrorCode: null } });
      await tx.syncJob.updateMany({ where: { dedupeKey: jobKey("SYNC", connectionId, calendar.id), status: "FAILED" },
        data: { status: "PENDING", attempts: 0, runAt: new Date(Math.max(Date.now(), connection.nextAllowedAt.getTime())), lastErrorCode: null } });
    }
  });
}
export async function selectProviderCalendar(userId: string, connectionId: string, calendarId: string, enabled: boolean) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM provider_connections WHERE id = ${connectionId}::uuid FOR UPDATE`;
    const connection = await tx.providerConnection.findFirst({ where: { id: connectionId, userId, provider: { in: ["GOOGLE", "MICROSOFT"] }, status: { in: ["CONNECTED", "ERROR"] } } });
    if (!connection) throw new SpaceError(404, "Connection not found.");
    const calendar = await tx.calendar.findFirst({ where: { id: calendarId, connectionId, isEnabled: true } });
    if (!calendar) throw new SpaceError(404, "Calendar not found.");
    await tx.calendar.update({ where: { id: calendarId }, data: { syncEnabled: enabled, nextSyncAt: new Date(), nextWatchAt: new Date(), lastErrorCode: null,
      ...(!enabled || !calendar.syncEnabled ? { lastSyncedAt: null } : {}) } });
    if (!enabled) {
      await tx.calendarShare.deleteMany({ where: { calendarId } });
      await tx.event.deleteMany({ where: { calendarId } });
      await tx.sourceEvent.deleteMany({ where: { calendarId } });
      await tx.syncState.deleteMany({ where: { calendarId } });
    } else await enqueue(tx, "SYNC", connectionId, calendarId);
    await enqueue(tx, "WATCH", connectionId, calendarId);
  });
}
export async function disconnectProvider(userId: string, connectionId: string) {
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM provider_connections WHERE id = ${connectionId}::uuid FOR UPDATE`;
    const connection = await tx.providerConnection.findFirst({ where: { id: connectionId, userId, provider: { in: ["GOOGLE", "MICROSOFT"] } } });
    if (!connection) throw new SpaceError(404, "Connection not found.");
    if (connection.status === "DISCONNECTED") return;
    await tx.providerConnection.update({ where: { id: connectionId }, data: { status: "DISCONNECTING",
      leaseToken: null, leaseUntil: null, nextAllowedAt: new Date(), lastErrorCode: null } });
    await tx.syncJob.deleteMany({ where: { connectionId } });
    await tx.calendar.updateMany({ where: { connectionId }, data: { syncEnabled: false, isEnabled: false } });
    await tx.calendarShare.deleteMany({ where: { calendar: { connectionId } } });
    await tx.event.deleteMany({ where: { calendar: { connectionId } } });
    await tx.sourceEvent.deleteMany({ where: { calendar: { connectionId } } });
    await tx.syncState.deleteMany({ where: { calendar: { connectionId } } });
    await enqueue(tx, "DISCONNECT", connectionId);
  });
}

// Existing server callers retain the same ownership and mutation checks.
export const selectGoogleCalendar = selectProviderCalendar;
export const disconnectGoogle = disconnectProvider;
