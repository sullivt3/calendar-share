import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { db } from "../../src/server/db";
import { acceptInvitation, createSpace, getSpace, invite, leaveSpace, listSpaces, renameSpace, revokeInvitation, setSharing, visibleCalendars } from "../../src/server/spaces";
const ids: string[] = [];
const spaces: string[] = [];
async function space(owner: string) { const s = await createSpace(owner, "Our schedules"); spaces.push(s.id); return s.id; }
beforeAll(async () => {
  for (let i = 0; i < 4; i++) {
    const u = await db.user.create({ data: { name: "Test " + i, email: `spaces-${randomUUID()}@example.test` } }); ids.push(u.id);
  }
});
afterAll(async () => {
  await db.sharedSpace.deleteMany({ where: { id: { in: spaces } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
});
describe("shared accounts with real PostgreSQL", () => {
  it("keeps spaces private and permits equal member management", async () => {
    const id = await space(ids[0]);
    expect((await listSpaces(ids[1])).some(s => s.id === id)).toBe(false);
    await expect(getSpace(ids[1], id)).rejects.toMatchObject({ status: 404 });
    await expect(renameSpace(ids[1], id, "Stolen")).rejects.toMatchObject({ status: 404 });
    await expect(invite(ids[1], id)).rejects.toMatchObject({ status: 404 });
    const link = await invite(ids[0], id);
    await acceptInvitation(ids[1], link.token);
    await renameSpace(ids[1], id, "Together");
    expect((await getSpace(ids[0], id)).name).toBe("Together");
    expect((await getSpace(ids[1], id)).members).toHaveLength(2);
  });
  it("stores only hashes and rejects expired, replaced, revoked and replayed links", async () => {
    const id = await space(ids[0]);
    const first = await invite(ids[0], id);
    const stored = await db.invitation.findFirstOrThrow({ where: { spaceId: id } });
    expect(stored.tokenHash).not.toBe(first.token);
    expect(JSON.stringify(await getSpace(ids[0], id))).not.toContain(first.token);
    const second = await invite(ids[0], id);
    await expect(acceptInvitation(ids[1], first.token)).rejects.toMatchObject({ status: 400 });
    await db.invitation.updateMany({ where: { spaceId: id }, data: { expiresAt: new Date(0) } });
    await expect(acceptInvitation(ids[1], second.token)).rejects.toMatchObject({ status: 400 });
    const third = await invite(ids[0], id);
    await revokeInvitation(ids[0], id);
    await expect(acceptInvitation(ids[1], third.token)).rejects.toMatchObject({ status: 400 });
    const fourth = await invite(ids[0], id);
    await expect(acceptInvitation(ids[0], fourth.token)).rejects.toMatchObject({ status: 409 });
    await acceptInvitation(ids[1], fourth.token);
    await expect(acceptInvitation(ids[2], fourth.token)).rejects.toMatchObject({ status: 400 });
    await expect(invite(ids[0], id)).rejects.toMatchObject({ status: 409 });
  });
  it("serializes concurrent acceptance without exceeding two members", async () => {
    const id = await space(ids[0]);
    const link = await invite(ids[0], id);
    const results = await Promise.allSettled([acceptInvitation(ids[1], link.token), acceptInvitation(ids[2], link.token)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.sharedSpaceMember.count({ where: { spaceId: id } })).toBe(2);
  });
  it("isolates sharing by owner and space, revokes immediately, and cleans departures", async () => {
    const id = await space(ids[0]), other = await space(ids[0]);
    await acceptInvitation(ids[1], (await invite(ids[0], id)).token);
    await acceptInvitation(ids[2], (await invite(ids[0], other)).token);
    const connection = await db.providerConnection.create({ data: { userId: ids[0], provider: "MOCK", externalId: randomUUID() } });
    const calendar = await db.calendar.create({ data: { connectionId: connection.id, externalId: randomUUID(), name: "Private test calendar" } });
    expect(await visibleCalendars(ids[1], id)).toHaveLength(0);
    expect((await visibleCalendars(ids[0], id)).find(c => c.id === calendar.id)?.mode).toBe("NOT_SHARED");
    await expect(setSharing(ids[1], id, calendar.id, "FULL_DETAILS")).rejects.toMatchObject({ status: 404 });
    await expect(setSharing(ids[3], id, calendar.id, "FULL_DETAILS")).rejects.toMatchObject({ status: 404 });
    await setSharing(ids[0], id, calendar.id, "BUSY_ONLY");
    expect((await visibleCalendars(ids[1], id))[0].mode).toBe("BUSY_ONLY");
    expect(await visibleCalendars(ids[2], other)).toHaveLength(0);
    await setSharing(ids[0], id, calendar.id, "FULL_DETAILS");
    expect((await visibleCalendars(ids[1], id))[0].mode).toBe("FULL_DETAILS");
    await setSharing(ids[0], id, calendar.id, "NOT_SHARED");
    expect(await visibleCalendars(ids[1], id)).toHaveLength(0);
    await setSharing(ids[0], id, calendar.id, "FULL_DETAILS");
    await leaveSpace(ids[0], id);
    expect(await visibleCalendars(ids[1], id)).toHaveLength(0);
    await expect(getSpace(ids[0], id)).rejects.toMatchObject({ status: 404 });
    expect(await db.calendarShare.count({ where: { spaceId: id } })).toBe(0);
    await leaveSpace(ids[1], id);
    expect(await db.sharedSpace.findUnique({ where: { id } })).toBeNull();
  });
  it("invalidates outstanding invitations on departure", async () => {
    const id = await space(ids[0]);
    const link = await invite(ids[0], id);
    await leaveSpace(ids[0], id);
    await expect(acceptInvitation(ids[1], link.token)).rejects.toMatchObject({ status: 400 });
  });
});
