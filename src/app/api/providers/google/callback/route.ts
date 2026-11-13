import { auth } from "@/server/auth";
import { completeGoogleOAuth, OAUTH_COOKIE } from "@/server/google/oauth";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  let result = "failed";
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) result = "login-required";
    else {
      const params = new URL(request.url).searchParams;
      const browser = (request.headers.get("cookie") ?? "").split(";").map(v => v.trim()).find(v => v.startsWith(OAUTH_COOKIE + "="))?.slice(OAUTH_COOKIE.length + 1) ?? "";
      const completed = await completeGoogleOAuth(session.user.id, session.session.id, {
        state: params.get("state") ?? "", browser,
        code: params.get("code") ?? undefined, denied: !!params.get("error"),
      });
      result = completed.denied ? "denied" : "connected";
    }
  } catch { /* Never log callback codes, tokens, state, or raw provider errors. */ }
  const base = process.env.BETTER_AUTH_URL;
  if (!base) return new Response(null, { status: 503 });
  const response = Response.redirect(new URL("/connections?google=" + result, base), 303);
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store"); headers.set("Referrer-Policy", "no-referrer");
  headers.append("Set-Cookie", OAUTH_COOKIE + "=; HttpOnly; SameSite=Lax; Path=/api/providers/google/callback; Max-Age=0" +
    (process.env.NODE_ENV === "production" ? "; Secure" : ""));
  return new Response(null, { status: 303, headers });
}
