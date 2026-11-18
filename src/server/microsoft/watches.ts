import { randomBytes, randomUUID } from "node:crypto";
import { db } from "../db";
import { secretHash } from "../credentials";
import { fenced } from "../sync/queue";
import { microsoftWebhookAddress } from "./config";
import { MicrosoftError } from "./errors";
import type { MicrosoftJobContext } from "./context";
function expiry(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now() + 60000 || date.getTime() > Date.now() + 7 * 86400000) throw new MicrosoftError("INVALID_DATA");
  return date;
}
export async function watchMicrosoftCalendar(ctx: MicrosoftJobContext) {
  const calendar = await ctx.calendar(false), address = microsoftWebhookAddress();
  let subscriptions = await db.syncSubscription.findMany({ where: { calendarId: calendar.id } });
  const enabled = calendar.isEnabled && calendar.syncEnabled && !!address;
  let active = subscriptions.find(s => s.status === "ACTIVE" && s.expiresAt > new Date());
  if (enabled && active && active.expiresAt.getTime() <= Date.now() + 3600000 && active.resourceId) {
    try {
      const result = await ctx.use(token => ctx.gateway.renew(token, active!.resourceId!));
      if (result.id !== active.resourceId) throw new MicrosoftError("INVALID_DATA");
      const expiresAt = expiry(result.expirationDateTime);
      await fenced(ctx.lease, tx => tx.syncSubscription.update({ where: { id: active!.id }, data: { expiresAt } }));
      active = { ...active, expiresAt };
    } catch (error) {
      if (!(error instanceof MicrosoftError) || error.code !== "NOT_FOUND") throw error;
      await fenced(ctx.lease, tx => tx.syncSubscription.deleteMany({ where: { id: active!.id } })); active = undefined;
    }
  }
  const pending = subscriptions.some(s => s.status === "PENDING" && !s.resourceId && s.expiresAt > new Date());
  if (enabled && !active && !pending) {
    const id = randomUUID(), clientState = randomBytes(32).toString("base64url");
    await fenced(ctx.lease, tx => tx.syncSubscription.create({ data: { id, connectionId: calendar.connectionId, calendarId: calendar.id,
      tokenHash: secretHash(clientState), expiresAt: new Date(Date.now() + 86400000), status: "PENDING" } }));
    try {
      const result = await ctx.use(token => ctx.gateway.subscribe(token, address!, clientState));
      const expiresAt = expiry(result.expirationDateTime);
      await fenced(ctx.lease, async tx => {
        const current = await tx.calendar.findUniqueOrThrow({ where: { id: calendar.id } });
        const previous = await tx.syncSubscription.findUniqueOrThrow({ where: { id } });
        if (previous.resourceId && previous.resourceId !== result.id) throw new MicrosoftError("INVALID_DATA");
        await tx.syncSubscription.update({ where: { id }, data: { resourceId: result.id, expiresAt,
          status: current.isEnabled && current.syncEnabled ? "ACTIVE" : "RETIRING" } });
        await tx.syncSubscription.updateMany({ where: { calendarId: calendar.id, id: { not: id } }, data: { status: "RETIRING" } });
      });
    } catch (error) {
      if (error instanceof MicrosoftError && error.code !== "PROVIDER_UNAVAILABLE")
        await fenced(ctx.lease, tx => tx.syncSubscription.deleteMany({ where: { id, resourceId: null } }));
      throw error;
    }
  }
  subscriptions = await db.syncSubscription.findMany({ where: { calendarId: calendar.id } });
  for (const subscription of subscriptions) {
    if (subscription.expiresAt <= new Date()) { await fenced(ctx.lease, tx => tx.syncSubscription.deleteMany({ where: { id: subscription.id } })); continue; }
    if (enabled && ["ACTIVE", "PENDING"].includes(subscription.status)) continue;
    if (subscription.resourceId) await ctx.use(token => ctx.gateway.stop(token, subscription.resourceId!));
    else continue; // Unknown remote outcome: periodic cleanup waits for a verified callback or expiry.
    await fenced(ctx.lease, tx => tx.syncSubscription.deleteMany({ where: { id: subscription.id } }));
  }
  const remaining = await db.syncSubscription.findFirst({ where: { calendarId: calendar.id, status: "ACTIVE", expiresAt: { gt: new Date() } }, orderBy: { expiresAt: "desc" } });
  await fenced(ctx.lease, tx => tx.calendar.update({ where: { id: calendar.id }, data: {
    nextWatchAt: remaining ? new Date(remaining.expiresAt.getTime() - 3600000) : new Date(Date.now() + 300000) } }));
}
export async function disconnectMicrosoft(ctx: MicrosoftJobContext) {
  const subscriptions = await db.syncSubscription.findMany({ where: { connectionId: ctx.lease.connectionId } });
  for (const subscription of subscriptions) {
    if (subscription.expiresAt <= new Date() || !subscription.resourceId) continue;
    await ctx.use(token => ctx.gateway.stop(token, subscription.resourceId!));
    await fenced(ctx.lease, tx => tx.syncSubscription.deleteMany({ where: { id: subscription.id } }));
  }
  await fenced(ctx.lease, async tx => {
    await tx.syncSubscription.deleteMany({ where: { connectionId: ctx.lease.connectionId } });
    await tx.calendar.deleteMany({ where: { connectionId: ctx.lease.connectionId } });
    await tx.providerConnection.update({ where: { id: ctx.lease.connectionId }, data: { status: "DISCONNECTED", credentialCiphertext: null, grantedScopes: null,
      lastErrorCode: "MICROSOFT_CONSENT_REMOVAL" } });
  });
}
