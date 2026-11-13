import { db } from "../db";
import { credentialsSchema, hasReadOnlyScopes, type GoogleCredentials, type GoogleGateway } from "../google/contracts";
import { unseal, seal } from "../credentials";
import { CancelledJob, GoogleError } from "../google/errors";
import { fenced, type JobLease } from "./queue";
export function jobContext(lease: JobLease, gateway: GoogleGateway) {
  let cached: GoogleCredentials | undefined;
  async function connection() {
    return fenced(lease, async tx => {
      const value = await tx.providerConnection.findUniqueOrThrow({ where: { id: lease.connectionId } });
      if (value.provider !== "GOOGLE") throw new CancelledJob();
      if (lease.kind === "DISCONNECT" ? value.status !== "DISCONNECTING" : !["CONNECTED", "ERROR"].includes(value.status)) throw new CancelledJob();
      return value;
    });
  }
  async function credentials(force = false): Promise<GoogleCredentials> {
    const value = await connection();
    if (!value.credentialCiphertext) throw new GoogleError("REAUTH_REQUIRED");
    cached ??= credentialsSchema.parse(unseal(value.credentialCiphertext, "connection:" + value.id));
    if (!force && cached.expiresAt > Date.now() + 60000) return cached;
    const next = await gateway.refresh(cached.refreshToken);
    if (next.scope && !hasReadOnlyScopes(next.scope)) throw new GoogleError("REAUTH_REQUIRED");
    const merged = credentialsSchema.parse({ accessToken: next.accessToken,
      refreshToken: next.refreshToken ?? cached.refreshToken, expiresAt: next.expiresAt, scope: next.scope || cached.scope });
    await fenced(lease, tx => tx.providerConnection.update({ where: { id: value.id }, data: { credentialCiphertext: seal(merged, "connection:" + value.id) } }));
    cached = merged;
    return merged;
  }
  async function use<T>(work: (token: string) => Promise<T>): Promise<T> {
    const token = (await credentials()).accessToken;
    try { return await work(token); }
    catch (e) {
      if (!(e instanceof GoogleError) || e.code !== "ACCESS_EXPIRED") throw e;
      return work((await credentials(true)).accessToken);
    }
  }
  async function calendar(enabled = true) {
    await connection();
    if (!lease.calendarId) throw new CancelledJob();
    const value = await db.calendar.findFirst({ where: { id: lease.calendarId, connectionId: lease.connectionId } });
    if (!value || (enabled && (!value.syncEnabled || !value.isEnabled))) throw new CancelledJob();
    return value;
  }
  return { lease, gateway, connection, credentials, use, calendar };
}
export type JobContext = ReturnType<typeof jobContext>;
