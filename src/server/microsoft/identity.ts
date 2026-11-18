import { decodeJwt, decodeProtectedHeader, createLocalJWKSet, jwtVerify, type JSONWebKeySet } from "jose";
import { z } from "zod";
import { microsoftConfig } from "./config";
import { MicrosoftError } from "./errors";
import { secretMatches } from "../credentials";
const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const issuerTemplate = "https://login.microsoftonline.com/{tenantid}/v2.0";
const schema = z.object({ keys: z.array(z.object({ kid: z.string(), kty: z.literal("RSA"), n: z.string(), e: z.string(),
  issuer: z.string(), use: z.literal("sig").optional(), alg: z.literal("RS256").optional() }).passthrough()).min(1).max(100) });
let cached: { value: z.infer<typeof schema>; until: number } | undefined;
let pending: Promise<z.infer<typeof schema>> | undefined;
async function signingKeys() {
  if (cached && cached.until > Date.now()) return cached.value;
  // One fixed authority. Token jku/x5u/issuer URLs never control network requests.
  pending ??= (async () => {
    const response = await fetch("https://login.microsoftonline.com/common/discovery/v2.0/keys", {
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000),
    }).catch(() => { throw new MicrosoftError("PROVIDER_UNAVAILABLE"); });
    if (!response.ok) throw new MicrosoftError("PROVIDER_UNAVAILABLE");
    const value = schema.parse(await response.json());
    cached = { value, until: Date.now() + 300000 }; return value;
  })();
  try { return await pending; } finally { pending = undefined; }
}
export async function verifyMicrosoftIdentity(idToken: string, nonceHash: string, loadKeys: () => Promise<unknown> = signingKeys) {
  const { clientId } = microsoftConfig();
  try {
    if (idToken.length > 32768) throw new Error();
    const header = decodeProtectedHeader(idToken), unsafe = decodeJwt(idToken);
    if (header.alg !== "RS256" || !header.kid || typeof unsafe.tid !== "string" || !guid.test(unsafe.tid)) throw new Error();
    const issuer = issuerTemplate.replace("{tenantid}", unsafe.tid);
    const keys = schema.parse(await loadKeys()).keys.filter(key => key.kid === header.kid &&
      key.issuer.replace("{tenantid}", unsafe.tid as string) === issuer);
    if (!keys.length) throw new Error();
    const { payload } = await jwtVerify(idToken, createLocalJWKSet({ keys } as JSONWebKeySet), {
      algorithms: ["RS256"], issuer, audience: clientId, clockTolerance: 30, maxTokenAge: "24h",
      requiredClaims: ["iss", "aud", "sub", "exp", "iat", "nbf", "nonce", "tid", "oid", "ver"],
    });
    if (payload.aud !== clientId || payload.ver !== "2.0" || typeof payload.oid !== "string" || !guid.test(payload.oid) ||
      typeof payload.nonce !== "string" || !secretMatches(payload.nonce, nonceHash)) throw new Error();
    // Email/preferred_username are display-only, never authorization identifiers.
    const label = [payload.email, payload.preferred_username, payload.name].find(v => typeof v === "string" && v.length > 0 && v.length <= 320);
    return { subject: payload.tid + ":" + payload.oid, label: typeof label === "string" ? label : "Microsoft account" };
  } catch (error) {
    if (error instanceof MicrosoftError && error.code === "PROVIDER_UNAVAILABLE") throw error;
    throw new MicrosoftError("REAUTH_REQUIRED");
  }
}
