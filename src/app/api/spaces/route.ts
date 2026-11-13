import { spaceApi } from "@/server/space-api";
import { createSpace, listSpaces } from "@/server/spaces";
import { spaceNameSchema } from "@/shared/spaces";
export const GET = spaceApi(async (_r, user) => listSpaces(user));
export const POST = spaceApi(async (r, user) => createSpace(user, spaceNameSchema.parse(await r.json()).name));
