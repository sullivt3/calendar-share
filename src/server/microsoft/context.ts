import { db } from "../db";
import { microsoftCredentialsSchema as credentialsSchema, hasReadOnlyScopes } from "./contracts";
import type { MicrosoftGateway } from "./gateway";
import type { z } from "zod";
type MicrosoftCredentials = z.infer<typeof credentialsSchema>;
import { unseal, seal } from "../credentials";
import { CancelledJob } from "../google/errors";
import { MicrosoftError } from "./errors";
import { fenced, type JobLease } from "../sync/queue";
export function microsoftContext(lease: JobLease, gateway: MicrosoftGateway) {
  let cached: MicrosoftCredentials | undefined;
  async function connection() {
    return fenced(lease, async tx => {
      const value = await tx.providerConnection.findUniqueOrThrow({ where: { id: lease.connectionId } });
      if (value.provider !== "MICROSOFT") throw new CancelledJob();
      if (lease.kind === "DISCONNECT" ? value.status !== "DISCONNECTING" : !["CONNECTED", "ERROR"].includes(value.status)) throw new CancelledJob();
      return value;
    });
  }
  async function credentials(force = false): Promise<MicrosoftCredentials> {
    const value = await connection();
    if (!value.credentialCiphertext) throw new MicrosoftError("REAUTH_REQUIRED");
    cached ??= credentialsSchema.parse(unseal(value.credentialCiphertext, "connection:" + value.id));
    if (!force && cached.expiresAt > Date.now() + 60000) return cached;
    const next = await gateway.refresh(cached.refreshToken);
    if (next.scope && !hasReadOnlyScopes(next.scope)) throw new MicrosoftError("REAUTH_REQUIRED");
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
      if (!(e instanceof MicrosoftError) || e.code !== "ACCESS_EXPIRED") throw e;
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
export type MicrosoftJobContext = ReturnType<typeof microsoftContext>;
