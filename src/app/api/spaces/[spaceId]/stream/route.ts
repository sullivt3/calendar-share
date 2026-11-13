import { calendarStream } from "@/server/calendar-stream";
import { ZodError } from "zod";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ spaceId: string }> }) {
  try { return await calendarStream(request, (await context.params).spaceId); }
  catch (e) {
    return Response.json({ error: e instanceof ZodError ? "Invalid date range." : "Unable to open live view." },
      { status: e instanceof ZodError ? 400 : 500, headers: { "Cache-Control": "no-store" } });
  }
}
