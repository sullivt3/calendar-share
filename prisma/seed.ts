import "dotenv/config";
import { auth } from "../src/server/auth";
import { db } from "../src/server/db";
async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Demo seed is disabled in production");
  const password = process.env.DEMO_PASSWORD;
  if (!password || password.length < 12) throw new Error("Set DEMO_PASSWORD to at least 12 characters");
  for (const [name, email] of [["Alex Demo", "alex@example.test"], ["Sam Demo", "sam@example.test"]]) {
    if (!await db.user.findUnique({ where: { email } })) await auth.api.signUpEmail({ body: { name, email, password } });
  }
  console.info("Demo accounts ready: alex@example.test and sam@example.test. No live calendars connected.");
}
main().catch(() => { console.error("Demo seed failed. Check database and environment configuration."); process.exitCode = 1; }).finally(() => db.$disconnect());
