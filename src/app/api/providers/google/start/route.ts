import { sessionApi } from "@/server/space-api";
import { beginGoogleOAuth, OAUTH_COOKIE } from "@/server/google/oauth";
export const POST = sessionApi(async (_request, session) => {
  const result = await beginGoogleOAuth(session.user.id, session.session.id);
  const response = Response.json({ url: result.url });
  response.headers.append("Set-Cookie", OAUTH_COOKIE + "=" + result.browser +
    "; HttpOnly; SameSite=Lax; Path=/api/providers/google/callback; Max-Age=600" +
    (process.env.NODE_ENV === "production" ? "; Secure" : ""));
  return response;
});
