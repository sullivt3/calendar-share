import { sessionApi } from "@/server/space-api";
import { beginMicrosoftOAuth, MICROSOFT_COOKIE } from "@/server/microsoft/oauth";
export const POST = sessionApi(async (_request, session) => {
  const result = await beginMicrosoftOAuth(session.user.id, session.session.id);
  const response = Response.json({ url: result.url });
  response.headers.append("Set-Cookie", MICROSOFT_COOKIE + "=" + result.browser +
    "; HttpOnly; SameSite=Lax; Path=/api/providers/microsoft/callback; Max-Age=600" + (process.env.NODE_ENV === "production" ? "; Secure" : ""));
  return response;
});
