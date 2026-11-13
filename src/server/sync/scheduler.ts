import { db } from "../db";
import { ensureJob } from "./queue";
export async function scheduleDue() {
  const now = new Date();
  await db.oAuthAttempt.deleteMany({ where: { expiresAt: { lt: now } } });
  await db.syncSubscription.deleteMany({ where: { expiresAt: { lt: now } } });
  await db.syncJob.updateMany({ where: { status: "FAILED", updatedAt: { lt: new Date(Date.now() - 3600000) },
    connection: { status: { in: ["CONNECTED", "ERROR"] } } }, data: { status: "PENDING", runAt: now, attempts: 0 } });
  const connections = await db.providerConnection.findMany({ where: { provider: "GOOGLE", status: { in: ["CONNECTED", "ERROR"] },
    nextDiscoveryAt: { lte: now }, nextAllowedAt: { lte: now } }, select: { id: true }, take: 100 });
  for (const connection of connections) await ensureJob("DISCOVER", connection.id);
  const calendars = await db.calendar.findMany({ where: {
    connection: { provider: "GOOGLE", status: { in: ["CONNECTED", "ERROR"] }, nextAllowedAt: { lte: now } },
    OR: [{ syncEnabled: true, isEnabled: true, nextSyncAt: { lte: now } }, { nextWatchAt: { lte: now }, OR: [{ syncEnabled: true, isEnabled: true }, { subscriptions: { some: { expiresAt: { gt: now } } } }] }],
  }, select: { id: true, connectionId: true, syncEnabled: true, isEnabled: true, nextSyncAt: true, nextWatchAt: true }, take: 500 });
  for (const calendar of calendars) {
    if (calendar.syncEnabled && calendar.isEnabled && calendar.nextSyncAt <= now) await ensureJob("SYNC", calendar.connectionId, calendar.id);
    if (calendar.nextWatchAt <= now) await ensureJob("WATCH", calendar.connectionId, calendar.id);
  }
}
