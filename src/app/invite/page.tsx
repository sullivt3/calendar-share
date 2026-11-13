import { headers } from "next/headers";
import { auth } from "@/server/auth";
import { Invite } from "@/components/invite";
export const metadata = { title: "Join a shared space", referrer: "no-referrer" };
export default async function InvitePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  return <Invite signedIn={!!session} />;
}
