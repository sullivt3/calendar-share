import { spaceApi } from "@/server/space-api";
import { db } from "@/server/db";
import { preferenceSchema } from "@/shared/calendar";
export const PATCH = spaceApi(async (request, userId) => {
  const input = preferenceSchema.parse(await request.json());
  return db.userPreference.upsert({ where: { userId }, create: { userId, ...input }, update: input,
    select: { theme: true, displayColor: true } });
});
