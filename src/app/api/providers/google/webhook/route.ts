import { googleNotification } from "@/server/google/webhook";
export async function POST(request: Request) {
  try { return await googleNotification(request); }
  catch { return new Response(null, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
