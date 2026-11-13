import { spaceApi } from "@/server/space-api";
import { listConnections } from "@/server/connections";
export const GET = spaceApi(async (_request, userId) => listConnections(userId));
