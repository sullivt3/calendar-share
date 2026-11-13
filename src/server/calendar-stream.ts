import { createHash } from "node:crypto";
import { auth } from "./auth";
import { calendarData } from "./calendar";
import { SpaceError } from "./spaces";
import { rangeSchema } from "../shared/calendar";
import { idSchema } from "../shared/spaces";

export async function calendarStream(request: Request, spaceId: string, pollMs = 3000) {
  let initial;
  const range = rangeSchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  idSchema.parse(spaceId);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try { initial = await calendarData(session.user.id, spaceId, range); }
  catch (e) {
    if (e instanceof SpaceError) return Response.json({ error: e.message }, { status: e.status, headers: { "Cache-Control": "no-store" } });
    throw e;
  }
  const fingerprint = (data: unknown) => createHash("sha256").update(JSON.stringify(data)).digest("hex");
  let previous = fingerprint(initial);
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const started = Date.now();
  let dispose = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string) => controller.enqueue(new TextEncoder().encode(`event: ${event}
data: {}

`));
      const close = () => {
        if (stopped) return;
        stopped = true; clearTimeout(timer);
        request.signal.removeEventListener("abort", close);
        try { controller.close(); } catch { /* The browser may already have cancelled. */ }
      };
      dispose = close;
      request.signal.addEventListener("abort", close, { once: true });
      if (request.signal.aborted) { close(); return; }
      controller.enqueue(new TextEncoder().encode(`retry: 3000\n\n`));
      send("invalidate");
      async function tick() {
        if (stopped) return;
        try {
          const current = await auth.api.getSession({ headers: request.headers });
          if (stopped) return;
          if (!current || current.user.id !== session!.user.id) { send("revoked"); close(); return; }
          const data = await calendarData(current.user.id, spaceId, range);
          if (stopped) return;
          const next = fingerprint(data);
          if (previous !== next) { previous = next; send("invalidate"); }
          else controller.enqueue(new TextEncoder().encode(`: keep-alive\n\n`));
        } catch (e) {
          if (stopped) return;
          send(e instanceof SpaceError && e.status === 404 ? "revoked" : "unavailable");
          close(); return;
        }
        if (Date.now() - started > 5 * 60 * 1000) { close(); return; }
        timer = setTimeout(tick, pollMs);
      }
      timer = setTimeout(tick, pollMs);
    },
    cancel() { dispose(); },
  });
  return new Response(stream, { headers: {
    "Content-Type": "text/event-stream", "Cache-Control": "private, no-store, no-transform",
    "X-Accel-Buffering": "no", "Connection": "keep-alive",
  } });
}
