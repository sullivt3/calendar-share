import { auth } from "./auth";

// Require our configured origin on every browser mutation, including signup
// before a session exists. Do not infer a trusted origin from the Host header.
export async function authHandler(request: Request) {
  if (request.method === "POST") {
    const configured = process.env.BETTER_AUTH_URL;
    if (!configured || request.headers.get("origin") !== new URL(configured).origin) {
      return Response.json({ error: "Untrusted request origin" }, { status: 403 });
    }
  }
  const response = await auth.handler(request);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
