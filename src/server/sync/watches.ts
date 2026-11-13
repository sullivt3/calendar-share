import { randomBytes, randomUUID } from "node:crypto";
import { db } from "../db";
import { secretHash, unseal } from "../credentials";
import { credentialsSchema } from "../google/contracts";
import { webhookAddress } from "../google/config";
import { GoogleError } from "../google/errors";
import { fenced } from "./queue";
import type { JobContext } from "./context";

export async function syncWatch(ctx: JobContext) {
  const calendar = await ctx.calendar(false);
  const address = webhookAddress();
  let subscriptions = await db.syncSubscription.findMany({ where: { calendarId: calendar.id } });
  const active = subscriptions.find(s => s.status === "ACTIVE" && s.expiresAt.getTime() > Date.now() + 3600000);
  const awaitingConfirmation = subscriptions.some(s => s.status === "PENDING" && !s.resourceId && s.expiresAt > new Date());
  if (calendar.syncEnabled && calendar.isEnabled && address && !active && awaitingConfirmation) {
    await fenced(ctx.lease, tx => tx.calendar.update({ where: { id: calendar.id }, data: { nextWatchAt: new Date(Date.now() + 300000) } }));
    return;
  }
  if (calendar.syncEnabled && calendar.isEnabled && address && !active) {
    const id = randomUUID(), token = randomBytes(32).toString("base64url");
    await fenced(ctx.lease, tx => tx.syncSubscription.create({ data: {
      id, connectionId: calendar.connectionId, calendarId: calendar.id, tokenHash: secretHash(token),
      expiresAt: new Date(Date.now() + 86400000), status: "PENDING",
    } }));
    let created;
    try { created = await ctx.use(access => ctx.gateway.watch(access, calendar.externalId, { id, token, address })); }
    catch (e) {
      // A transport timeout has an unknown remote outcome. Keep its channel ID so
      // an early/late verified notification can confirm it without duplicate watches.
      if (e instanceof GoogleError && e.code !== "PROVIDER_UNAVAILABLE")
        await fenced(ctx.lease, tx => tx.syncSubscription.deleteMany({ where: { id, resourceId: null } }));
      throw e;
    }
    const expiration = Number(created.expiration);
    if (created.id !== id || !created.resourceId || !Number.isFinite(expiration) || expiration <= Date.now() + 60000 ||
        expiration > Date.now() + 8 * 86400000) throw new GoogleError("INVALID_DATA");
    await fenced(ctx.lease, async tx => {
      const current = await tx.calendar.findUniqueOrThrow({ where: { id: calendar.id } });
      if (!current.syncEnabled || !current.isEnabled) {
        await tx.syncSubscription.update({ where: { id }, data: { status: "RETIRING", resourceId: created.resourceId, expiresAt: new Date(expiration) } });
        return;
      }
      const pending = await tx.syncSubscription.findUniqueOrThrow({ where: { id } });
      if (pending.resourceId && pending.resourceId !== created.resourceId) throw new GoogleError("INVALID_DATA");
      await tx.syncSubscription.update({ where: { id }, data: { resourceId: created.resourceId, expiresAt: new Date(expiration), status: "ACTIVE" } });
      await tx.syncSubscription.updateMany({ where: { calendarId: calendar.id, id: { not: id } }, data: { status: "RETIRING" } });
    });
    subscriptions = await db.syncSubscription.findMany({ where: { calendarId: calendar.id } });
  }
  const shouldStopAll = !calendar.syncEnabled || !calendar.isEnabled || !address;
  let retry = false;
  for (const subscription of subscriptions) {
    if (subscription.expiresAt <= new Date()) {
      await fenced(ctx.lease, tx => tx.syncSubscription.deleteMany({ where: { id: subscription.id } }));
      continue;
    }
    if (!shouldStopAll && subscription.status === "ACTIVE") continue;
    if (!subscription.resourceId) { retry = true; continue; } // Early sync callback may supply this before watch returns.
    try {
      await ctx.use(token => ctx.gateway.stop(token, { id: subscription.id, resourceId: subscription.resourceId! }));
      await fenced(ctx.lease, tx => tx.syncSubscription.deleteMany({ where: { id: subscription.id } }));
    } catch (e) {
      if (e instanceof GoogleError && ["REAUTH_REQUIRED", "ACCESS_EXPIRED", "ACCESS_DENIED"].includes(e.code)) throw e;
      retry = true;
    }
  }
  const remaining = await db.syncSubscription.findFirst({ where: { calendarId: calendar.id, status: "ACTIVE", expiresAt: { gt: new Date() } }, orderBy: { expiresAt: "desc" } });
  await fenced(ctx.lease, tx => tx.calendar.update({ where: { id: calendar.id }, data: {
    nextWatchAt: retry ? new Date(Date.now() + 300000) : remaining ? new Date(remaining.expiresAt.getTime() - 3600000) : new Date(Date.now() + 3600000),
  } }));
}
export async function disconnect(ctx: JobContext) {
  const connection = await ctx.connection();
  const subscriptions = await db.syncSubscription.findMany({ where: { connectionId: connection.id } });
  if (connection.credentialCiphertext) {
    for (const subscription of subscriptions) {
      if (!subscription.resourceId) continue;
      try { await ctx.use(token => ctx.gateway.stop(token, { id: subscription.id, resourceId: subscription.resourceId! })); }
      catch { /* Revoking the grant below is authoritative even if channel cleanup fails. */ }
    }
    const latest = await ctx.connection();
    const credentials = credentialsSchema.parse(unseal(latest.credentialCiphertext!, "connection:" + latest.id));
    await ctx.gateway.revoke(credentials.refreshToken);
  }
  await fenced(ctx.lease, async tx => {
    await tx.syncSubscription.deleteMany({ where: { connectionId: connection.id } });
    await tx.calendar.deleteMany({ where: { connectionId: connection.id } });
    await tx.syncJob.deleteMany({ where: { connectionId: connection.id, id: { not: ctx.lease.id } } });
    await tx.providerConnection.update({ where: { id: connection.id }, data: { status: "DISCONNECTED", credentialCiphertext: null, grantedScopes: null, lastErrorCode: null } });
  });
}
