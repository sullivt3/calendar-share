import { spaceApi } from "@/server/space-api";
import { invite, revokeInvitation } from "@/server/spaces";
import { idSchema } from "@/shared/spaces";
export async function POST(request: Request, context: { params: Promise<{ spaceId: string; calendarId?: string }> }) {
  return spaceApi(async (r, user) => {
    const id = idSchema.parse((await context.params).spaceId);
    return invite(user, id);
  })(request);
}
export async function DELETE(request: Request, context: { params: Promise<{ spaceId: string; calendarId?: string }> }) {
  return spaceApi(async (r, user) => {
    const id = idSchema.parse((await context.params).spaceId);
    return revokeInvitation(user, id);
  })(request);
}
