import { createHash, randomBytes } from "node:crypto";
import { db } from "./db";
import { Prisma, type SharingMode } from "../generated/prisma/client";

export class SpaceError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
type Tx = Prisma.TransactionClient;
async function lock(tx: Tx, spaceId: string) {
  await tx.$queryRaw`SELECT id FROM shared_spaces WHERE id = ${spaceId}::uuid FOR UPDATE`;
}
async function member(tx: Tx, userId: string, spaceId: string) {
  if (!await tx.sharedSpaceMember.findUnique({ where: { spaceId_userId: { spaceId, userId } } }))
    throw new SpaceError(404, "Shared space not found.");
}
export async function listSpaces(userId: string) {
  return db.sharedSpace.findMany({ where: { members: { some: { userId } } }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } });
}
export async function createSpace(userId: string, name: string) {
  return db.sharedSpace.create({ data: { name, members: { create: { userId } } }, select: { id: true, name: true } });
}
export async function getSpace(userId: string, spaceId: string) {
  return db.$transaction(async tx => {
    await lock(tx, spaceId);
    await member(tx, userId, spaceId);
    return tx.sharedSpace.findUniqueOrThrow({ where: { id: spaceId }, select: {
      id: true, name: true,
      members: { select: { user: { select: { id: true, name: true } } }, orderBy: { joinedAt: "asc" } },
      invitations: { where: { usedAt: null, expiresAt: { gt: new Date() } }, select: { id: true, expiresAt: true } },
    } });
  });
}
export async function renameSpace(userId: string, spaceId: string, name: string) {
  return db.$transaction(async tx => {
    await lock(tx, spaceId); await member(tx, userId, spaceId);
    return tx.sharedSpace.update({ where: { id: spaceId }, data: { name }, select: { id: true, name: true } });
  });
}
export async function invite(userId: string, spaceId: string) {
  return db.$transaction(async tx => {
    await lock(tx, spaceId); await member(tx, userId, spaceId);
    if (await tx.sharedSpaceMember.count({ where: { spaceId } }) >= 2)
      throw new SpaceError(409, "This space already has two members.");
    // Only the latest link is valid; issuance does not reserve a membership slot.
    await tx.invitation.deleteMany({ where: { spaceId } });
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await tx.invitation.create({ data: { spaceId, tokenHash: hash(token), expiresAt } });
    return { token, expiresAt };
  });
}
export async function revokeInvitation(userId: string, spaceId: string) {
  return db.$transaction(async tx => {
    await lock(tx, spaceId); await member(tx, userId, spaceId);
    await tx.invitation.deleteMany({ where: { spaceId } });
  });
}
export async function acceptInvitation(userId: string, token: string) {
  const tokenHash = hash(token);
  const initial = await db.invitation.findUnique({ where: { tokenHash }, select: { spaceId: true } });
  if (!initial) throw new SpaceError(400, "Invitation is invalid or expired.");
  return db.$transaction(async tx => {
    await lock(tx, initial.spaceId);
    const invitation = await tx.invitation.findUnique({ where: { tokenHash } });
    if (!invitation || invitation.usedAt || invitation.expiresAt <= new Date())
      throw new SpaceError(400, "Invitation is invalid or expired.");
    const spaceId = invitation.spaceId;
    if (await tx.sharedSpaceMember.findUnique({ where: { spaceId_userId: { spaceId, userId } } }))
      throw new SpaceError(409, "You already belong to this space.");
    if (await tx.sharedSpaceMember.count({ where: { spaceId } }) >= 2)
      throw new SpaceError(409, "This space already has two members.");
    await tx.sharedSpaceMember.create({ data: { spaceId, userId } });
    await tx.invitation.update({ where: { id: invitation.id }, data: { usedAt: new Date() } });
    return { spaceId };
  });
}
export async function leaveSpace(userId: string, spaceId: string) {
  return db.$transaction(async tx => {
    await lock(tx, spaceId); await member(tx, userId, spaceId);
    // A departure invalidates all links, and never leaves the departing user's shares.
    await tx.invitation.deleteMany({ where: { spaceId } });
    await tx.calendarShare.deleteMany({ where: { spaceId, calendar: { connection: { userId } } } });
    await tx.sharedSpaceMember.delete({ where: { spaceId_userId: { spaceId, userId } } });
    if (!await tx.sharedSpaceMember.count({ where: { spaceId } }))
      await tx.sharedSpace.delete({ where: { id: spaceId } });
  });
}
export async function setSharing(userId: string, spaceId: string, calendarId: string, mode: SharingMode) {
  return db.$transaction(async tx => {
    await lock(tx, spaceId); await member(tx, userId, spaceId);
    if (!await tx.calendar.findFirst({ where: { id: calendarId, connection: { userId } } }))
      throw new SpaceError(404, "Calendar not found.");
    await tx.calendarShare.upsert({
      where: { calendarId_spaceId: { calendarId, spaceId } },
      create: { calendarId, spaceId, mode }, update: { mode },
    });
  });
}
export async function visibleCalendars(userId: string, spaceId: string) {
  return db.$transaction(async tx => {
    await lock(tx, spaceId); await member(tx, userId, spaceId);
    const calendars = await tx.calendar.findMany({
      where: { OR: [
        { connection: { userId } },
        { connection: { user: { memberships: { some: { spaceId } } } }, shares: { some: { spaceId, mode: { not: "NOT_SHARED" } } } },
      ] },
      select: {
        id: true, name: true,
        connection: { select: { userId: true, provider: true, user: { select: { name: true } } } },
        shares: { where: { spaceId }, select: { mode: true } },
      }, orderBy: { name: "asc" },
    });
    return calendars.map(c => ({
      id: c.id, name: c.name, ownerId: c.connection.userId, ownerName: c.connection.user.name,
      provider: c.connection.provider, mode: c.shares[0]?.mode ?? "NOT_SHARED",
    }));
  });
}
