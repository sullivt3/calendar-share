import { spaceApi } from "@/server/space-api";
import { visibleCalendars } from "@/server/spaces";
import { idSchema } from "@/shared/spaces";
export async function GET(request: Request, context: { params: Promise<{ spaceId: string; calendarId?: string }> }) {
  return spaceApi(async (r, user) => {
    const id = idSchema.parse((await context.params).spaceId);
    return visibleCalendars(user, id);
  })(request);
}
