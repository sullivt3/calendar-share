import { requireSession } from "@/server/session";
import { listConnections } from "@/server/connections";
import { Connections } from "@/components/connections";
export const metadata = { title: "Calendar accounts" };
export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<{ google?: string; microsoft?: string }> }) {
  const { user } = await requireSession();
  const params = await searchParams;
  return <Connections initial={await listConnections(user.id)} result={params.microsoft ?? params.google} />;
}
