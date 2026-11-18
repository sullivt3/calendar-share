import { randomBytes, randomUUID, createHash } from "node:crypto";
import { db } from "../db";
import { seal, unseal, secretHash, secretMatches } from "../credentials";
import { SpaceError } from "../spaces";
import { googleGateway } from "./gateway";
import { googleConfigured } from "./config";
import { hasReadOnlyScopes, credentialsSchema, type GoogleGateway } from "./contracts";
import { GoogleError } from "./errors";
import { enqueue } from "../sync/queue";
export const OAUTH_COOKIE = "calendar-google-browser";
export async function beginGoogleOAuth(userId: string, sessionId: string, gateway?: GoogleGateway) {
  if (!googleConfigured()) throw new SpaceError(503, "Google connections are not configured on this installation.");
  const id = randomUUID(), state = randomBytes(32).toString("base64url"), browser = randomBytes(32).toString("base64url");
  const verifier = randomBytes(64).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
    if (await tx.providerConnection.findFirst({ where: { userId, status: "DISCONNECTING" } }))
      throw new SpaceError(409, "Please wait for the current disconnection to finish.");
    const recent = await tx.oAuthAttempt.count({ where: { userId, createdAt: { gt: new Date(Date.now() - 3600000) } } });
    if (recent >= 10) throw new SpaceError(429, "Too many connection attempts. Please try again later.");
    await tx.oAuthAttempt.create({ data: { id, userId, sessionId, stateHash: secretHash(state), browserHash: secretHash(browser),
      verifierCiphertext: seal(verifier, "oauth:" + id), expiresAt: new Date(Date.now() + 600000) } });
  });
  return { url: (gateway ?? googleGateway()).authorization(state, challenge), browser };
}
export async function completeGoogleOAuth(userId: string, sessionId: string, input: { state: string; browser: string; code?: string; denied?: boolean }, gateway?: GoogleGateway) {
  if (!/^[a-zA-Z0-9_-]{43}$/.test(input.state) || !input.browser || (input.code?.length ?? 0) > 4096)
    throw new SpaceError(400, "This connection attempt is invalid or expired.");
  const attempt = await db.oAuthAttempt.findUnique({ where: { stateHash: secretHash(input.state) } });
  if (!attempt || attempt.provider !== "GOOGLE" || attempt.userId !== userId || attempt.sessionId !== sessionId || attempt.expiresAt <= new Date() || !secretMatches(input.browser, attempt.browserHash))
    throw new SpaceError(400, "This connection attempt is invalid or expired.");
  const consumed = await db.oAuthAttempt.deleteMany({ where: { id: attempt.id, provider: "GOOGLE", expiresAt: { gt: new Date() } } });
  if (consumed.count !== 1) throw new SpaceError(400, "This connection attempt is invalid or expired.");
  if (input.denied) return { denied: true };
  if (!input.code) throw new SpaceError(400, "This connection attempt is invalid or expired.");
  const verifier = unseal(attempt.verifierCiphertext, "oauth:" + attempt.id);
  if (typeof verifier !== "string") throw new GoogleError("CONFIG_MISSING");
  const api = gateway ?? googleGateway();
  const tokens = await api.exchange(input.code, verifier);
  if (!hasReadOnlyScopes(tokens.scope))
    throw new SpaceError(400, "Google did not grant the required read-only access.");
  if (!tokens.idToken) throw new GoogleError("REAUTH_REQUIRED");
  const identity = await api.identity(tokens.idToken);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
    const existing = await tx.providerConnection.findUnique({ where: { userId_provider_externalId: { userId, provider: "GOOGLE", externalId: identity.subject } } });
    if (existing) await tx.$queryRaw`SELECT id FROM provider_connections WHERE id = ${existing.id}::uuid FOR UPDATE`;
    if (existing?.status === "DISCONNECTING") throw new SpaceError(409, "Please wait for disconnection to finish.");
    const id = existing?.id ?? randomUUID();
    let refreshToken = tokens.refreshToken;
    if (!refreshToken && existing?.credentialCiphertext) refreshToken = credentialsSchema.parse(unseal(existing.credentialCiphertext, "connection:" + id)).refreshToken;
    if (!refreshToken) throw new SpaceError(400, "Google did not grant offline access. Try connecting again.");
    const credentials = credentialsSchema.parse({ ...tokens, refreshToken });
    const data = {
      accountLabel: identity.email ?? "Google account", credentialCiphertext: seal(credentials, "connection:" + id),
      grantedScopes: tokens.scope, status: "CONNECTED" as const, lastErrorCode: null,
      nextDiscoveryAt: new Date(), nextAllowedAt: new Date(), leaseToken: null, leaseUntil: null,
    };
    await tx.providerConnection.upsert({ where: { userId_provider_externalId: { userId, provider: "GOOGLE", externalId: identity.subject } },
      create: { id, userId, provider: "GOOGLE", externalId: identity.subject, ...data }, update: data });
    // Revoke any in-flight worker's authority before replacing credentials.
    await tx.syncJob.deleteMany({ where: { connectionId: id } });
    if (existing && ["REAUTH_REQUIRED", "DISCONNECTED", "DISCONNECTING"].includes(existing.status)) {
      await tx.calendarShare.deleteMany({ where: { calendar: { connectionId: id } } });
      await tx.event.deleteMany({ where: { calendar: { connectionId: id } } });
      await tx.sourceEvent.deleteMany({ where: { calendar: { connectionId: id } } });
      await tx.syncState.deleteMany({ where: { calendar: { connectionId: id } } });
      await tx.calendar.updateMany({ where: { connectionId: id }, data: { syncEnabled: false, isEnabled: false, lastSyncedAt: null } });
    }
    await enqueue(tx, "DISCOVER", id);
    return { denied: false };
  }, { timeout: 15000 });
}
