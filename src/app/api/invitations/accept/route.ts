import { spaceApi } from "@/server/space-api";
import { acceptInvitation } from "@/server/spaces";
import { tokenSchema } from "@/shared/spaces";
export const POST = spaceApi(async (r, user) => acceptInvitation(user, tokenSchema.parse(await r.json()).token));
