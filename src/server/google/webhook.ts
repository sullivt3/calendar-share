import { db } from "../db";
import { secretMatches } from "../credentials";
import { idSchema } from "../../shared/spaces";
import { enqueue } from "../sync/queue";
export async function googleNotification(request: Request) {
  const id = request.headers.get("x-goog-channel-id") ?? "";
  const token = request.headers.get("x-goog-channel-token") ?? "";
  const resource = request.headers.get("x-goog-resource-id") ?? "";
  const state = request.headers.get("x-goog-resource-state") ?? "";
  const message = request.headers.get("x-goog-message-number") ?? "";
  const denied = () => new Response(null, { status: 403, headers: { "Cache-Control": "no-store" } });
  if (!idSchema.safeParse(id).success || token.length > 256 || !resource || resource.length > 2048 ||
      !["sync", "exists", "not_exists"].includes(state) || !/^[1-9][0-9]{0,19}$/.test(message)) return denied();
  const initial = await db.syncSubscription.findUnique({ where: { id }, select: { connectionId: true } });
  if (!initial) return denied();
  const valid = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM provider_connections WHERE id = ${initial.connectionId}::uuid FOR UPDATE`;
    const subscription = await tx.syncSubscription.findUnique({ where: { id }, include: { connection: true, calendar: true } });
    if (!subscription || !secretMatches(token, subscription.tokenHash) || subscription.expiresAt <= new Date() ||
        !["CONNECTED", "ERROR"].includes(subscription.connection.status) ||
        !subscription.calendar.syncEnabled || !subscription.calendar.isEnabled ||
        (subscription.resourceId && subscription.resourceId !== resource)) return false;
    const number = BigInt(message);
    if (number > 9223372036854775807n) return false;
    if (number <= subscription.lastMessage) return true;
    const reportedExpiration = Date.parse(request.headers.get("x-goog-channel-expiration") ?? "");
    const expiresAt = Number.isFinite(reportedExpiration) && reportedExpiration > Date.now()
      ? new Date(Math.min(reportedExpiration, subscription.expiresAt.getTime())) : subscription.expiresAt;
    await tx.syncSubscription.update({ where: { id }, data: { resourceId: resource, lastMessage: number, expiresAt,
      ...(subscription.status === "PENDING" ? { status: "ACTIVE" } : {}) } });
    await enqueue(tx, "SYNC", subscription.connectionId, subscription.calendarId);
    return true;
  });
  return valid ? new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } }) : denied();
}
