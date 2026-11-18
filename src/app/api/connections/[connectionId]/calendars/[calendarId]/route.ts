import { z } from "zod";
import { spaceApi } from "@/server/space-api";
import { selectProviderCalendar } from "@/server/connections";
import { idSchema } from "@/shared/spaces";
export async function PUT(request: Request, context: { params: Promise<{ connectionId: string; calendarId: string }> }) {
  return spaceApi(async (r, userId) => {
    const params = await context.params;
    const body = z.object({ enabled: z.boolean() }).parse(await r.json());
    return selectProviderCalendar(userId, idSchema.parse(params.connectionId), idSchema.parse(params.calendarId), body.enabled);
  })(request);
}
