import { spaceApi } from "@/server/space-api";
import { disconnectProvider } from "@/server/connections";
import { idSchema } from "@/shared/spaces";
export async function DELETE(request: Request, context: { params: Promise<{ connectionId: string }> }) {
  return spaceApi(async (_r, userId) => disconnectProvider(userId, idSchema.parse((await context.params).connectionId)))(request);
}
