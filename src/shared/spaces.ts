import { z } from "zod";
export const spaceNameSchema = z.object({ name: z.string().trim().min(1).max(80) });
export const idSchema = z.uuid();
export const tokenSchema = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) });
export const sharingSchema = z.object({ mode: z.enum(["NOT_SHARED", "BUSY_ONLY", "FULL_DETAILS"]), includeDescription: z.boolean().default(false) });
