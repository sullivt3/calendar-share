import { spaceApi } from "@/server/space-api";
import { setSharing } from "@/server/spaces";
import { idSchema, sharingSchema } from "@/shared/spaces";
export async function PUT(request: Request, context: { params: Promise<{ spaceId: string; calendarId: string }> }) {
  return spaceApi(async (r, user) => {
    const params = await context.params;
    const body = sharingSchema.parse(await r.json());
    return setSharing(user, idSchema.parse(params.spaceId), idSchema.parse(params.calendarId), body.mode, body.includeDescription);
  })(request);
}
