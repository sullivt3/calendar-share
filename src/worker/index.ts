import "dotenv/config";
import { db } from "../server/db";
// Phase 1: process lifecycle and database connectivity only. No sync jobs exist yet.
let stopping = false;
async function main() {
  await db.$queryRaw`SELECT 1`;
  console.info(JSON.stringify({ service: "worker", status: "ready", mode: "foundation-no-sync" }));
  const timer = setInterval(() => {}, 30_000);
  async function stop() {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    await db.$disconnect();
  }
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}
main().catch(() => {
  console.error(JSON.stringify({ service: "worker", status: "startup-failed" }));
  process.exitCode = 1;
});
