-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('CONNECTED', 'ERROR', 'REAUTH_REQUIRED', 'DISCONNECTING', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "SyncJobKind" AS ENUM ('DISCOVER', 'SYNC', 'WATCH', 'DISCONNECT');

-- CreateEnum
CREATE TYPE "SyncJobStatus" AS ENUM ('PENDING', 'RUNNING', 'FAILED');

-- CreateEnum
CREATE TYPE "SyncPhase" AS ENUM ('IDLE', 'FETCH', 'MATERIALIZE');

-- AlterTable
ALTER TABLE "calendars" ADD COLUMN     "isEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "lastErrorCode" TEXT,
ADD COLUMN     "nextSyncAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "nextWatchAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "syncEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "timeZone" TEXT NOT NULL DEFAULT 'UTC';

-- AlterTable
ALTER TABLE "provider_connections" ADD COLUMN     "accountLabel" TEXT,
ADD COLUMN     "credentialCiphertext" TEXT,
ADD COLUMN     "grantedScopes" TEXT,
ADD COLUMN     "lastErrorCode" TEXT,
ADD COLUMN     "lastManualSyncAt" TIMESTAMP(3),
ADD COLUMN     "leaseToken" UUID,
ADD COLUMN     "leaseUntil" TIMESTAMP(3),
ADD COLUMN     "nextAllowedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "nextDiscoveryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "status" "ConnectionStatus" NOT NULL DEFAULT 'CONNECTED';

-- CreateTable
CREATE TABLE "oauth_attempts" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "stateHash" TEXT NOT NULL,
    "browserHash" TEXT NOT NULL,
    "verifierCiphertext" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oauth_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_states" (
    "calendarId" UUID NOT NULL,
    "phase" "SyncPhase" NOT NULL DEFAULT 'IDLE',
    "syncTokenCiphertext" TEXT,
    "pageTokenCiphertext" TEXT,
    "pendingTokenCiphertext" TEXT,
    "snapshotId" UUID,
    "fullSync" BOOLEAN NOT NULL DEFAULT false,
    "pageCount" INTEGER NOT NULL DEFAULT 0,
    "targetWindowStart" TIMESTAMP(3),
    "targetWindowEnd" TIMESTAMP(3),
    "windowStart" TIMESTAMP(3),
    "windowEnd" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),

    CONSTRAINT "sync_states_pkey" PRIMARY KEY ("calendarId")
);

-- CreateTable
CREATE TABLE "source_events" (
    "id" UUID NOT NULL,
    "calendarId" UUID NOT NULL,
    "externalId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "snapshotId" UUID,
    "dirty" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "source_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_jobs" (
    "id" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "calendarId" UUID,
    "kind" "SyncJobKind" NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "status" "SyncJobStatus" NOT NULL DEFAULT 'PENDING',
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "requestVersion" INTEGER NOT NULL DEFAULT 1,
    "claimedVersion" INTEGER NOT NULL DEFAULT 0,
    "leaseToken" UUID,
    "leaseUntil" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sync_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_subscriptions" (
    "id" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "calendarId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "resourceId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "lastMessage" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "sync_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "oauth_attempts_stateHash_key" ON "oauth_attempts"("stateHash");

-- CreateIndex
CREATE INDEX "oauth_attempts_userId_createdAt_idx" ON "oauth_attempts"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "oauth_attempts_expiresAt_idx" ON "oauth_attempts"("expiresAt");

-- CreateIndex
CREATE INDEX "source_events_calendarId_dirty_idx" ON "source_events"("calendarId", "dirty");

-- CreateIndex
CREATE UNIQUE INDEX "source_events_calendarId_externalId_key" ON "source_events"("calendarId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "sync_jobs_dedupeKey_key" ON "sync_jobs"("dedupeKey");

-- CreateIndex
CREATE INDEX "sync_jobs_status_runAt_idx" ON "sync_jobs"("status", "runAt");

-- CreateIndex
CREATE INDEX "sync_subscriptions_calendarId_expiresAt_idx" ON "sync_subscriptions"("calendarId", "expiresAt");

-- CreateIndex
CREATE INDEX "calendars_syncEnabled_nextSyncAt_idx" ON "calendars"("syncEnabled", "nextSyncAt");

-- CreateIndex
CREATE INDEX "provider_connections_provider_status_nextDiscoveryAt_idx" ON "provider_connections"("provider", "status", "nextDiscoveryAt");

-- AddForeignKey
ALTER TABLE "oauth_attempts" ADD CONSTRAINT "oauth_attempts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_attempts" ADD CONSTRAINT "oauth_attempts_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_states" ADD CONSTRAINT "sync_states_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "calendars"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_events" ADD CONSTRAINT "source_events_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "calendars"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "provider_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "calendars"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_subscriptions" ADD CONSTRAINT "sync_subscriptions_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "provider_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_subscriptions" ADD CONSTRAINT "sync_subscriptions_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "calendars"("id") ON DELETE CASCADE ON UPDATE CASCADE;
