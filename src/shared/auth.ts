import { z } from "zod";
export const loginSchema = z.object({
  email: z.email().max(254).transform((value) => value.trim().toLowerCase()),
  password: z.string().min(12, "Use at least 12 characters.").max(128),
});
export const registrationSchema = loginSchema.extend({
  name: z.string().trim().min(1, "Enter your name.").max(80),
});
export type RegistrationInput = z.infer<typeof registrationSchema>;
export type CalendarProvider = "GOOGLE" | "MICROSOFT" | "APPLE" | "MOCK";
export type SharingMode = "NOT_SHARED" | "BUSY_ONLY" | "FULL_DETAILS";
