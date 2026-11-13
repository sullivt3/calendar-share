-- CreateEnum
CREATE TYPE "EventPrivacy" AS ENUM ('PUBLIC', 'PRIVATE', 'CONFIDENTIAL');

-- AlterTable
ALTER TABLE "calendar_shares" ADD COLUMN     "includeDescription" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "calendars" ADD COLUMN     "lastSyncedAt" TIMESTAMP(3),
ADD COLUMN     "mockProvider" "Provider";

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "calendarId" UUID NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "start" TIMESTAMPTZ(3) NOT NULL,
    "end" TIMESTAMPTZ(3) NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "timeZone" TEXT NOT NULL DEFAULT 'UTC',
    "location" TEXT,
    "description" TEXT,
    "privacy" "EventPrivacy" NOT NULL DEFAULT 'PRIVATE',
    "busy" BOOLEAN NOT NULL DEFAULT true,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "recurrenceRule" TEXT,
    "seriesId" TEXT,
    "originalStart" TIMESTAMPTZ(3),
    "exceptions" JSONB,
    "providerVersion" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_preferences" (
    "userId" UUID NOT NULL,
    "displayColor" TEXT,
    "theme" TEXT NOT NULL DEFAULT 'SYSTEM',

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "events_calendarId_start_end_idx" ON "events"("calendarId", "start", "end");

-- CreateIndex
CREATE UNIQUE INDEX "events_calendarId_externalId_key" ON "events"("calendarId", "externalId");

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "calendars"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
