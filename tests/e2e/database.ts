import { db } from "../../src/server/db";

// Each browser case gets its own auth-rate window. Never clear a normal DB.
export async function resetAuthLimits() {
  const database = process.env.DATABASE_URL;
  if (!database || !new URL(database).pathname.endsWith("_browser"))
    throw new Error("Browser tests require a disposable database whose name ends with _browser.");
  await db.rateLimit.deleteMany();
}
