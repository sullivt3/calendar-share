import { randomBytes, randomUUID } from "node:crypto";
import { db } from "../db";
import { seal, unseal, secretHash, secretMatches } from "../credentials";
import { SpaceError } from "../spaces";
import { enqueue } from "../sync/queue";
import { microsoftConfig } from "./config";
import { microsoftGateway, microsoftPkce, type MicrosoftGateway } from "./gateway";
import { verifyMicrosoftIdentity } from "./identity";
import { hasReadOnlyScopes, microsoftCredentialsSchema } from "./contracts";
export const MICROSOFT_COOKIE = "calendar-microsoft-browser";
type Dependencies = { gateway?: MicrosoftGateway; identity?: typeof verifyMicrosoftIdentity };
export async function beginMicrosoftOAuth(userId: string, sessionId: string, gateway: MicrosoftGateway = microsoftGateway()) {
  try { microsoftConfig(); } catch { throw new SpaceError(503, "Microsoft connections are not configured on this installation."); }
  const id = randomUUID(), state = randomBytes(32).toString("base64url"), browser = randomBytes(32).toString("base64url"), nonce = randomBytes(32).toString("base64url");
  const proof = microsoftPkce();
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
    const session = await tx.session.findFirst({ where: { id: sessionId, userId, expiresAt: { gt: new Date() } } });
    if (!session) throw new SpaceError(401, "Please log in again.");
    if (await tx.providerConnection.findFirst({ where: { userId, provider: "MICROSOFT", status: "DISCONNECTING" } }))
      throw new SpaceError(409, "Please wait for disconnection to finish.");
    if (await tx.oAuthAttempt.count({ where: { userId, createdAt: { gt: new Date(Date.now() - 3600000) } } }) >= 10)
      throw new SpaceError(429, "Too many connection attempts. Try again later.");
    await tx.oAuthAttempt.create({ data: { id, provider: "MICROSOFT", userId, sessionId, stateHash: secretHash(state),
      browserHash: secretHash(browser), nonceHash: secretHash(nonce), verifierCiphertext: seal(proof.verifier, "microsoft:oauth:" + id), expiresAt: new Date(Date.now() + 600000) } });
  });
  return { url: gateway.authorization(state, proof.challenge, nonce), browser };
}
export async function completeMicrosoftOAuth(userId: string, sessionId: string, input: { state: string; browser: string; code?: string; denied?: boolean }, dependencies: Dependencies = {}) {
  const invalid = () => new SpaceError(400, "This connection attempt is invalid or expired.");
  if (!/^[a-zA-Z0-9_-]{43}$/.test(input.state) || !input.browser || (input.code?.length ?? 0) > 4096) throw invalid();
  const attempt = await db.oAuthAttempt.findUnique({ where: { stateHash: secretHash(input.state) } });
  if (!attempt || attempt.provider !== "MICROSOFT" || !attempt.nonceHash || attempt.userId !== userId || attempt.sessionId !== sessionId ||
    attempt.expiresAt <= new Date() || !secretMatches(input.browser, attempt.browserHash)) throw invalid();
  const session = await db.session.findFirst({ where: { id: sessionId, userId, expiresAt: { gt: new Date() } } });
  if (!session) throw invalid();
  if ((await db.oAuthAttempt.deleteMany({ where: { id: attempt.id, provider: "MICROSOFT", expiresAt: { gt: new Date() } } })).count !== 1) throw invalid();
  if (input.denied) return { denied: true };
  if (!input.code) throw invalid();
  const verifier = unseal(attempt.verifierCiphertext, "microsoft:oauth:" + attempt.id);
  if (typeof verifier !== "string") throw invalid();
  const tokens = await (dependencies.gateway ?? microsoftGateway()).exchange(input.code, verifier);
  if (!hasReadOnlyScopes(tokens.scope) || !tokens.idToken) throw new SpaceError(400, "Microsoft did not grant the required read-only access.");
  const identity = await (dependencies.identity ?? verifyMicrosoftIdentity)(tokens.idToken, attempt.nonceHash);
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
    // A logout/revocation during the provider exchange must not install a grant.
    await tx.$queryRaw`SELECT id FROM sessions WHERE id = ${sessionId}::uuid FOR UPDATE`;
    if (!await tx.session.findFirst({ where: { id: sessionId, userId, expiresAt: { gt: new Date() } } })) throw invalid();
    const where = { userId_provider_externalId: { userId, provider: "MICROSOFT" as const, externalId: identity.subject } };
    let existing = await tx.providerConnection.findUnique({ where });
    if (existing) {
      await tx.$queryRaw`SELECT id FROM provider_connections WHERE id = ${existing.id}::uuid FOR UPDATE`;
      existing = await tx.providerConnection.findUnique({ where });
    }
    if (existing?.status === "DISCONNECTING") throw new SpaceError(409, "Please wait for disconnection to finish.");
    const id = existing?.id ?? randomUUID();
    let refreshToken = tokens.refreshToken;
    if (!refreshToken && existing?.credentialCiphertext) refreshToken = microsoftCredentialsSchema.parse(unseal(existing.credentialCiphertext, "connection:" + id)).refreshToken;
    if (!refreshToken) throw new SpaceError(400, "Microsoft did not grant offline access. Reconnect to grant access.");
    const credentials = microsoftCredentialsSchema.parse({ ...tokens, refreshToken });
    const data = { accountLabel: identity.label, status: "CONNECTED" as const, lastErrorCode: null,
      credentialCiphertext: seal(credentials, "connection:" + id), grantedScopes: tokens.scope,
      nextDiscoveryAt: new Date(), nextAllowedAt: new Date(), leaseToken: null, leaseUntil: null };
    await tx.providerConnection.upsert({ where, create: { id, userId, provider: "MICROSOFT", externalId: identity.subject, ...data }, update: data });
    await tx.syncJob.deleteMany({ where: { connectionId: id } });
    if (existing && ["REAUTH_REQUIRED", "DISCONNECTED"].includes(existing.status)) {
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
