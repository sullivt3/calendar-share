import { spaceApi } from "@/server/space-api";
import { getSpace, renameSpace, leaveSpace } from "@/server/spaces";
import { idSchema, spaceNameSchema } from "@/shared/spaces";
export async function GET(request: Request, context: { params: Promise<{ spaceId: string; calendarId?: string }> }) {
  return spaceApi(async (r, user) => {
    const id = idSchema.parse((await context.params).spaceId);
    return getSpace(user, id);
  })(request);
}
export async function PATCH(request: Request, context: { params: Promise<{ spaceId: string; calendarId?: string }> }) {
  return spaceApi(async (r, user) => {
    const id = idSchema.parse((await context.params).spaceId);
    return renameSpace(user, id, spaceNameSchema.parse(await r.json()).name);
  })(request);
}
export async function DELETE(request: Request, context: { params: Promise<{ spaceId: string; calendarId?: string }> }) {
  return spaceApi(async (r, user) => {
    const id = idSchema.parse((await context.params).spaceId);
    return leaveSpace(user, id);
  })(request);
}
