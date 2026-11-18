import { z } from "zod";
import { db } from "../db";
import { secretHash, secretMatches } from "../credentials";
import { enqueue } from "../sync/queue";
const notices = z.object({ value: z.array(z.object({ subscriptionId: z.uuid(), clientState: z.string().min(32).max(128), tenantId: z.uuid().optional(),
  resource: z.string().max(2048).optional(), changeType: z.enum(["created", "updated", "deleted"]).optional(),
  lifecycleEvent: z.enum(["missed", "subscriptionRemoved", "reauthorizationRequired"]).optional() })).min(1).max(100) });
const reply = (status: number) => new Response(null, { status, headers: { "Cache-Control": "no-store" } });
export async function microsoftNotification(request: Request) {
  const challenge = new URL(request.url).searchParams.get("validationToken");
  if (challenge !== null) {
    if (!challenge || challenge.length > 2048) return reply(400);
    return new Response(challenge, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  }
  const reader = request.body?.getReader(); if (!reader) return reply(400);
  const decoder = new TextDecoder(); let content = "", size = 0;
  try {
    while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length;
      if (size > 65536) { await reader.cancel(); return reply(413); } content += decoder.decode(chunk.value, { stream: true }); }
    content += decoder.decode();
  } finally { reader.releaseLock(); }
  let body: z.infer<typeof notices>;
  try { body = notices.parse(JSON.parse(content)); } catch { return reply(400); }
  for (const notice of body.value) {
    const subscription = await db.syncSubscription.findFirst({ where: { OR: [{ resourceId: notice.subscriptionId }, { status: "PENDING", tokenHash: secretHash(notice.clientState) }] }, select: { id: true, connectionId: true } });
    if (!subscription) continue;
    await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM provider_connections WHERE id = ${subscription.connectionId}::uuid FOR UPDATE`;
      const current = await tx.syncSubscription.findUnique({ where: { id: subscription.id }, include: { connection: true, calendar: true } });
      if (!current || current.connection.provider !== "MICROSOFT" || !secretMatches(notice.clientState, current.tokenHash) || current.expiresAt <= new Date() ||
        (current.resourceId && current.resourceId !== notice.subscriptionId) || !["CONNECTED", "ERROR"].includes(current.connection.status) || !current.calendar.syncEnabled || !current.calendar.isEnabled) return;
      const [tenant, object] = current.connection.externalId.split(":");
      if (notice.tenantId && notice.tenantId.toLowerCase() !== tenant.toLowerCase()) return;
      if (!notice.lifecycleEvent) {
        if (!notice.changeType || !notice.resource) return;
        const resource = notice.resource.replace(/^\//, "");
        if (!new RegExp("^users/" + object.replace(/[^a-zA-Z0-9-]/g, "") + "/events(?:/[^/]+)?$", "i").test(resource) && resource.toLowerCase() !== "me/events") return;
      }
      await tx.syncSubscription.update({ where: { id: current.id }, data: { resourceId: notice.subscriptionId,
        status: notice.lifecycleEvent === "reauthorizationRequired" ? "RETIRING" : current.status === "PENDING" ? "ACTIVE" : current.status } });
      await enqueue(tx, "SYNC", current.connectionId, current.calendarId);
      if (notice.lifecycleEvent === "subscriptionRemoved") await tx.syncSubscription.delete({ where: { id: current.id } });
      if (notice.lifecycleEvent) await enqueue(tx, "WATCH", current.connectionId, current.calendarId);
    });
  }
  return reply(202);
}
