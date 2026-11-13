import { spaceApi } from "@/server/space-api";
import { setSharing } from "@/server/spaces";
import { idSchema, sharingSchema } from "@/shared/spaces";
export async function PUT(request: Request, context: { params: Promise<{ spaceId: string; calendarId?: string }> }) {
  return spaceApi(async (r, user) => {
    const id = idSchema.parse((await context.params).spaceId);
    return setSharing(user, id, idSchema.parse((await context.params).calendarId), sharingSchema.parse(await r.json()).mode);
  })(request);
}
