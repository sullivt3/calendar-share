import { randomUUID } from "node:crypto";
import { db } from "../db";
import { LostLease } from "../google/errors";
import { Prisma, type SyncJobKind } from "../../generated/prisma/client";
export type Tx = Prisma.TransactionClient;
export const LEASE_MS = 120000;
export type JobLease = { id: string; connectionId: string; calendarId: string | null; kind: SyncJobKind; token: string; claimedVersion: number };
export const jobKey = (kind: SyncJobKind, connectionId: string, calendarId?: string | null) => "google:" + kind + ":" + (calendarId ?? connectionId);
export async function enqueue(tx: Tx, kind: SyncJobKind, connectionId: string, calendarId?: string | null) {
  const dedupeKey = jobKey(kind, connectionId, calendarId);
  await tx.syncJob.upsert({ where: { dedupeKey },
    create: { connectionId, calendarId: calendarId ?? null, kind, dedupeKey },
    update: { requestVersion: { increment: 1 } } });
}
export async function ensureJob(kind: SyncJobKind, connectionId: string, calendarId?: string | null) {
  await db.$transaction(async tx => {
    // Acquire the parent before inserting the job: FK key-share locks taken after
    // an insert could otherwise deadlock a webhook holding this connection row.
    await tx.$queryRaw`SELECT id FROM provider_connections WHERE id = ${connectionId}::uuid FOR UPDATE`;
    const connection = await tx.providerConnection.findUnique({ where: { id: connectionId } });
    if (!connection || !["CONNECTED", "ERROR"].includes(connection.status)) return;
    await tx.syncJob.createMany({ data: [{ connectionId, calendarId: calendarId ?? null, kind, dedupeKey: jobKey(kind, connectionId, calendarId) }], skipDuplicates: true });
  });
}
export async function claimJob(): Promise<JobLease | null> {
  return db.$transaction(async tx => {
    const now = new Date();
    const connections = await tx.$queryRaw<{ id: string }[]>`
      SELECT c.id FROM provider_connections c
      WHERE c."nextAllowedAt" <= ${now}
        AND (c."leaseUntil" IS NULL OR c."leaseUntil" < ${now})
        AND EXISTS (SELECT 1 FROM sync_jobs j WHERE j."connectionId" = c.id AND j."runAt" <= ${now}
          AND (j.status = 'PENDING' OR (j.status = 'RUNNING' AND j."leaseUntil" < ${now})))
      ORDER BY c.id LIMIT 1 FOR UPDATE OF c SKIP LOCKED
    `;
    if (!connections[0]) return null;
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM sync_jobs WHERE "connectionId" = ${connections[0].id}::uuid AND "runAt" <= ${now}
        AND (status = 'PENDING' OR (status = 'RUNNING' AND "leaseUntil" < ${now}))
      ORDER BY "runAt", id LIMIT 1 FOR UPDATE SKIP LOCKED
    `;
    if (!rows[0]) return null;
    const job = await tx.syncJob.findUniqueOrThrow({ where: { id: rows[0].id } });
    const token = randomUUID(), leaseUntil = new Date(Date.now() + LEASE_MS);
    await tx.syncJob.update({ where: { id: job.id }, data: { status: "RUNNING", leaseToken: token, leaseUntil,
      claimedVersion: job.requestVersion, attempts: { increment: 1 } } });
    await tx.providerConnection.update({ where: { id: job.connectionId }, data: { leaseToken: token, leaseUntil } });
    return { id: job.id, connectionId: job.connectionId, calendarId: job.calendarId, kind: job.kind, token, claimedVersion: job.requestVersion };
  });
}
export async function checkLease(tx: Tx, lease: JobLease) {
  await tx.$queryRaw`SELECT id FROM provider_connections WHERE id = ${lease.connectionId}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM sync_jobs WHERE id = ${lease.id}::uuid FOR UPDATE`;
  const job = await tx.syncJob.findUnique({ where: { id: lease.id } });
  const connection = await tx.providerConnection.findUnique({ where: { id: lease.connectionId } });
  const now = new Date();
  if (!job || !connection || job.leaseToken !== lease.token || connection.leaseToken !== lease.token ||
      !job.leaseUntil || job.leaseUntil <= now || !connection.leaseUntil || connection.leaseUntil <= now) throw new LostLease();
  return { job, connection };
}
export async function fenced<T>(lease: JobLease, work: (tx: Tx) => Promise<T>): Promise<T> {
  return db.$transaction(async tx => { await checkLease(tx, lease); return work(tx); }, { timeout: 20000 });
}
export async function renewLease(lease: JobLease) {
  return db.$transaction(async tx => {
    await checkLease(tx, lease);
    const leaseUntil = new Date(Date.now() + LEASE_MS);
    await tx.syncJob.update({ where: { id: lease.id }, data: { leaseUntil } });
    await tx.providerConnection.update({ where: { id: lease.connectionId }, data: { leaseUntil } });
  });
}
export async function finishJob(lease: JobLease) {
  await db.$transaction(async tx => {
    const { job } = await checkLease(tx, lease);
    if (job.requestVersion > lease.claimedVersion)
      await tx.syncJob.update({ where: { id: job.id }, data: { status: "PENDING", runAt: new Date(), leaseToken: null, leaseUntil: null, attempts: 0, lastErrorCode: null } });
    else await tx.syncJob.delete({ where: { id: job.id } });
    await tx.providerConnection.update({ where: { id: lease.connectionId }, data: { leaseToken: null, leaseUntil: null } });
  });
}
