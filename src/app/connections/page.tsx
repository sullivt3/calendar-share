import { requireSession } from "@/server/session";
import { listConnections } from "@/server/connections";
import { Connections } from "@/components/connections";
export const metadata = { title: "Calendar accounts" };
export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<{ google?: string }> }) {
  const { user } = await requireSession();
  return <Connections initial={await listConnections(user.id)} result={(await searchParams).google} />;
}
