-- CreateEnum
CREATE TYPE "SharingMode" AS ENUM ('NOT_SHARED', 'BUSY_ONLY', 'FULL_DETAILS');

-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('GOOGLE', 'MICROSOFT', 'APPLE', 'MOCK');

-- CreateTable
CREATE TABLE "shared_spaces" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shared_spaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shared_space_members" (
    "spaceId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shared_space_members_pkey" PRIMARY KEY ("spaceId","userId")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "spaceId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_connections" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "provider" "Provider" NOT NULL,
    "externalId" TEXT NOT NULL,

    CONSTRAINT "provider_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendars" (
    "id" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "calendars_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_shares" (
    "calendarId" UUID NOT NULL,
    "spaceId" UUID NOT NULL,
    "mode" "SharingMode" NOT NULL DEFAULT 'NOT_SHARED',

    CONSTRAINT "calendar_shares_pkey" PRIMARY KEY ("calendarId","spaceId")
);

-- CreateIndex
CREATE INDEX "shared_space_members_userId_idx" ON "shared_space_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_tokenHash_key" ON "invitations"("tokenHash");

-- CreateIndex
CREATE INDEX "invitations_spaceId_idx" ON "invitations"("spaceId");

-- CreateIndex
CREATE UNIQUE INDEX "provider_connections_userId_provider_externalId_key" ON "provider_connections"("userId", "provider", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "calendars_connectionId_externalId_key" ON "calendars"("connectionId", "externalId");

-- CreateIndex
CREATE INDEX "calendar_shares_spaceId_idx" ON "calendar_shares"("spaceId");

-- AddForeignKey
ALTER TABLE "shared_space_members" ADD CONSTRAINT "shared_space_members_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "shared_spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shared_space_members" ADD CONSTRAINT "shared_space_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "shared_spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_connections" ADD CONSTRAINT "provider_connections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendars" ADD CONSTRAINT "calendars_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "provider_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_shares" ADD CONSTRAINT "calendar_shares_calendarId_fkey" FOREIGN KEY ("calendarId") REFERENCES "calendars"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_shares" ADD CONSTRAINT "calendar_shares_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "shared_spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
