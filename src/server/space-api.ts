import { auth } from "./auth";
import { SpaceError } from "./spaces";
import { ZodError } from "zod";
const noStore = { "Cache-Control": "private, no-store" };
export function spaceApi(work: (request: Request, userId: string) => Promise<unknown>) {
  return async (request: Request) => {
    try {
      if (request.method !== "GET") {
        const origin = process.env.BETTER_AUTH_URL;
        if (!origin || request.headers.get("origin") !== new URL(origin).origin)
          return Response.json({ error: "Untrusted request origin" }, { status: 403, headers: noStore });
        if (!request.headers.get("content-type")?.startsWith("application/json"))
          return Response.json({ error: "Expected JSON" }, { status: 415, headers: noStore });
      }
      const session = await auth.api.getSession({ headers: request.headers });
      if (!session) return Response.json({ error: "Unauthorized" }, { status: 401, headers: noStore });
      return Response.json(await work(request, session.user.id) ?? { ok: true }, { headers: noStore });
    } catch (error) {
      if (error instanceof SpaceError) return Response.json({ error: error.message }, { status: error.status, headers: noStore });
      if (error instanceof ZodError || error instanceof SyntaxError)
        return Response.json({ error: "Invalid request." }, { status: 400, headers: noStore });
      return Response.json({ error: "Unable to complete the request." }, { status: 500, headers: noStore });
    }
  };
}
