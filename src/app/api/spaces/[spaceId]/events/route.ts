import { spaceApi } from "@/server/space-api";
import { calendarData } from "@/server/calendar";
import { rangeSchema } from "@/shared/calendar";
import { idSchema } from "@/shared/spaces";
export async function GET(request: Request, context: { params: Promise<{ spaceId: string }> }) {
  return spaceApi(async (r, userId) => calendarData(userId, idSchema.parse((await context.params).spaceId),
    rangeSchema.parse(Object.fromEntries(new URL(r.url).searchParams))))(request);
}
