import { requireSession } from "@/server/session";
import { getSpace, visibleCalendars, SpaceError } from "@/server/spaces";
import { idSchema } from "@/shared/spaces";
import { notFound } from "next/navigation";
import { SpaceSettings } from "@/components/space-settings";
export const metadata = { title: "Shared space settings" };
export default async function SpacePage({ params }: { params: Promise<{ spaceId: string }> }) {
  const { user } = await requireSession();
  const parsed = idSchema.safeParse((await params).spaceId);
  if (!parsed.success) notFound();
  const [space, calendars] = await Promise.all([
    getSpace(user.id, parsed.data),
    visibleCalendars(user.id, parsed.data),
  ]).catch(e => {
    if (e instanceof SpaceError && e.status === 404) notFound();
    throw e;
  });
  return <SpaceSettings space={{ ...space, invitations: space.invitations.map(i => ({ ...i, expiresAt: i.expiresAt.toISOString() })) }} userId={user.id} calendars={calendars} />;
}
