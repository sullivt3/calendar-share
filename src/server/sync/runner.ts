import { microsoftGateway, type MicrosoftGateway } from "../microsoft/gateway";
import { MicrosoftError } from "../microsoft/errors";
import { microsoftContext } from "../microsoft/context";
import { discoverMicrosoftCalendars } from "../microsoft/discovery";
import { syncMicrosoftCalendar } from "../microsoft/events";
import { watchMicrosoftCalendar, disconnectMicrosoft } from "../microsoft/watches";
import { ZodError } from "zod";
import { db } from "../db";
import { googleGateway } from "../google/gateway";
import type { GoogleGateway } from "../google/contracts";
import { GoogleError, LostLease, CancelledJob } from "../google/errors";
import { claimJob, checkLease, finishJob, renewLease, type JobLease } from "./queue";
import { jobContext } from "./context";
import { discoverCalendars } from "./discovery";
import { syncCalendar } from "./events";
import { syncWatch, disconnect } from "./watches";
export function backoff(attempt: number, retryAfter = 0, random = Math.random()) {
  return Math.max(retryAfter, Math.min(3600000, 1000 * 2 ** Math.min(attempt, 12)) * (0.75 + random * 0.5));
}
async function fail(lease: JobLease, error: unknown) {
  const code = (error instanceof GoogleError || error instanceof MicrosoftError) ? error.code : error instanceof ZodError ? "INVALID_DATA" : "PROVIDER_UNAVAILABLE";
  await db.$transaction(async tx => {
    const { job, connection } = await checkLease(tx, lease);
    if (lease.kind === "DISCONNECT" && (job.attempts >= 5 || ["REAUTH_REQUIRED", "CONFIG_MISSING"].includes(code))) {
      await tx.syncSubscription.deleteMany({ where: { connectionId: connection.id } });
      await tx.calendar.deleteMany({ where: { connectionId: connection.id } });
      await tx.providerConnection.update({ where: { id: connection.id }, data: { status: "DISCONNECTED",
        credentialCiphertext: null, grantedScopes: null, leaseToken: null, leaseUntil: null, lastErrorCode: "REVOKE_UNCONFIRMED" } });
      await tx.syncJob.deleteMany({ where: { connectionId: connection.id } });
      return;
    }
    if (["REAUTH_REQUIRED", "ACCESS_EXPIRED", "POLICY_BLOCKED"].includes(code) || (lease.kind === "DISCOVER" && code === "ACCESS_DENIED")) {
      await tx.providerConnection.update({ where: { id: connection.id }, data: {
        status: "REAUTH_REQUIRED", credentialCiphertext: null, lastErrorCode: ["ACCESS_DENIED", "POLICY_BLOCKED"].includes(code) ? code : "REAUTH_REQUIRED",
        leaseToken: null, leaseUntil: null,
      } });
      await tx.syncJob.deleteMany({ where: { connectionId: connection.id } });
      return;
    }
    const delay = backoff(job.attempts, (error instanceof GoogleError || error instanceof MicrosoftError) ? error.retryAfterMs : 0);
    const terminal = job.attempts >= 5 || ["CONFIG_MISSING", "DATA_LIMIT", "INVALID_DATA"].includes(code);
    const runAt = new Date(Date.now() + (terminal ? 3600000 : delay));
    await tx.syncJob.update({ where: { id: job.id }, data: { status: terminal ? "FAILED" : "PENDING", runAt,
      leaseToken: null, leaseUntil: null, lastErrorCode: code } });
    await tx.providerConnection.update({ where: { id: connection.id }, data: {
      status: lease.kind === "DISCONNECT" ? "DISCONNECTING" : "ERROR", lastErrorCode: code,
      leaseToken: null, leaseUntil: null,
      ...(code === "RATE_LIMIT" ? { nextAllowedAt: new Date(Math.max(runAt.getTime(), connection.nextAllowedAt.getTime())) } : {}),
    } });
    if (lease.calendarId) {
      await tx.calendar.updateMany({ where: { id: lease.calendarId }, data: { lastErrorCode: code, nextSyncAt: runAt } });
      if (["INVALID_DATA", "DATA_LIMIT"].includes(code)) await tx.syncState.updateMany({ where: { calendarId: lease.calendarId, phase: "MATERIALIZE" },
        data: { phase: "IDLE", pendingTokenCiphertext: null, pageTokenCiphertext: null } });
    }
  });
}
export async function runOne(factory: () => GoogleGateway = googleGateway, microsoftFactory: () => MicrosoftGateway = microsoftGateway) {
  const lease = await claimJob();
  if (!lease) return false;
  let renewalFailed = false;
  const heartbeat = setInterval(() => { void renewLease(lease).catch(() => { renewalFailed = true; }); }, 20000);
  try {
    const connection = await db.providerConnection.findUniqueOrThrow({ where: { id: lease.connectionId } });
    if (connection.provider === "MICROSOFT") {
      const ctx = microsoftContext(lease, microsoftFactory());
      if (lease.kind === "DISCOVER") await discoverMicrosoftCalendars(ctx);
      if (lease.kind === "SYNC") await syncMicrosoftCalendar(ctx);
      if (lease.kind === "WATCH") await watchMicrosoftCalendar(ctx);
      if (lease.kind === "DISCONNECT") await disconnectMicrosoft(ctx);
    } else {
    const ctx = jobContext(lease, factory());
    if (lease.kind === "DISCOVER") await discoverCalendars(ctx);
    if (lease.kind === "SYNC") await syncCalendar(ctx);
    if (lease.kind === "WATCH") await syncWatch(ctx);
    if (lease.kind === "DISCONNECT") await disconnect(ctx);
    }
    if (!renewalFailed) await finishJob(lease);
  } catch (error) {
    if (error instanceof CancelledJob) {
      try { await finishJob(lease); } catch (e) { if (!(e instanceof LostLease)) throw e; }
    } else if (!(error instanceof LostLease)) {
      try { await fail(lease, error); } catch (e) { if (!(e instanceof LostLease)) throw e; }
      console.info(JSON.stringify({ service: "sync", kind: lease.kind, status: "retry-or-attention",
        code: (error instanceof GoogleError || error instanceof MicrosoftError) ? error.code : error instanceof ZodError ? "INVALID_DATA" : "PROVIDER_UNAVAILABLE" }));
    }
  } finally { clearInterval(heartbeat); }
  return true;
}
