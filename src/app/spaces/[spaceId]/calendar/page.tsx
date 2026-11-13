import { requireSession } from "@/server/session";
import { getSpace, SpaceError } from "@/server/spaces";
import { idSchema } from "@/shared/spaces";
import { CalendarDashboard } from "@/components/calendar/dashboard";
import { mockEnabled } from "@/server/mock-calendars";
import { notFound } from "next/navigation";
export const metadata = { title: "Shared calendar" };
export default async function CalendarPage({ params }: { params: Promise<{ spaceId: string }> }) {
  const { user } = await requireSession();
  const parsed = idSchema.safeParse((await params).spaceId);
  if (!parsed.success) notFound();
  const space = await getSpace(user.id, parsed.data).catch(e => {
    if (e instanceof SpaceError && e.status === 404) notFound();
    throw e;
  });
  return <CalendarDashboard userId={user.id} userName={user.name} spaceId={space.id} spaceName={space.name} demoEnabled={mockEnabled()} />;
}
