import { microsoftNotification } from "@/server/microsoft/webhook";
export async function POST(request: Request) {
  try { return await microsoftNotification(request); }
  catch { return new Response(null, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
