import { spaceApi } from "@/server/space-api";
import { requestDiscovery } from "@/server/connections";
import { idSchema } from "@/shared/spaces";
export async function POST(request: Request, context: { params: Promise<{ connectionId: string }> }) {
  return spaceApi(async (_r, userId) => requestDiscovery(userId, idSchema.parse((await context.params).connectionId)))(request);
}
