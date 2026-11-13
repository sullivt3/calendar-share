import "dotenv/config";
import { db } from "../server/db";
import { scheduleDue } from "../server/sync/scheduler";
import { runOne } from "../server/sync/runner";
let stopping = false;
const shutdown = new AbortController();
process.once("SIGTERM", () => { stopping = true; shutdown.abort(); });
process.once("SIGINT", () => { stopping = true; shutdown.abort(); });
async function main() {
  await db.$queryRaw`SELECT 1`;
  console.info(JSON.stringify({ service: "worker", status: "ready", mode: "durable-provider-sync" }));
  let scheduled = 0;
  while (!stopping) {
    try {
      if (Date.now() - scheduled > 30000) { await scheduleDue(); scheduled = Date.now(); }
      if (!await runOne()) await new Promise<void>(resolve => {
        const done = () => { clearTimeout(timer); shutdown.signal.removeEventListener("abort", done); resolve(); };
        const timer = setTimeout(done, 1000);
        shutdown.signal.addEventListener("abort", done, { once: true });
        if (shutdown.signal.aborted) done();
      });
    } catch {
      console.error(JSON.stringify({ service: "worker", status: "database-or-job-unavailable" }));
      if (!stopping) await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}
main().catch(() => {
  console.error(JSON.stringify({ service: "worker", status: "startup-failed" })); process.exitCode = 1;
}).finally(() => db.$disconnect());
