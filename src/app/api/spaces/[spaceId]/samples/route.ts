import { spaceApi } from "@/server/space-api";
import { loadMockCalendars } from "@/server/mock-calendars";
import { idSchema } from "@/shared/spaces";
export async function POST(request: Request, context: { params: Promise<{ spaceId: string }> }) {
  return spaceApi(async (_r, userId) => loadMockCalendars(userId, idSchema.parse((await context.params).spaceId)))(request);
}
