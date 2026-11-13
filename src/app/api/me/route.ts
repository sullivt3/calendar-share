import { headers } from "next/headers";
import { auth } from "@/server/auth";
export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  const responseHeaders = { "Cache-Control": "private, no-store" };
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401, headers: responseHeaders });
  return Response.json({ user: { id: session.user.id, name: session.user.name, email: session.user.email } }, { headers: responseHeaders });
}
