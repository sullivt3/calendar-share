import type { Prisma } from "../generated/prisma/client";
export const activeCalendarWhere: Prisma.CalendarWhereInput = {
  isEnabled: true,
  AND: [{ OR: [{ lastErrorCode: null }, { lastErrorCode: { notIn: ["DATA_LIMIT", "INVALID_DATA"] } }] }],
  OR: [{ connection: { provider: "MOCK" } },
    { syncEnabled: true, connection: { status: { in: ["CONNECTED", "ERROR"] } } }],
};
export function visibleCalendarWhere(userId: string, spaceId: string): Prisma.CalendarWhereInput {
  return { AND: [activeCalendarWhere, { OR: [
    { connection: { userId } },
    { connection: { user: { memberships: { some: { spaceId } } } }, shares: { some: { spaceId, mode: { not: "NOT_SHARED" } } } },
  ] }] };
}
