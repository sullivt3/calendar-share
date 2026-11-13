import { createCipheriv, createDecipheriv, randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { GoogleError } from "./google/errors";
function keys() {
  try {
    const active = process.env.PROVIDER_ENCRYPTION_KEY_ID ?? "v1";
    if (!/^[a-zA-Z0-9_-]{1,24}$/.test(active)) throw new Error();
    const ring = z.record(z.string(), z.string()).parse(JSON.parse(process.env.PROVIDER_ENCRYPTION_KEYS ?? "{}"));
    const bytes = Object.fromEntries(Object.entries(ring).map(([id, encoded]) => {
      const key = Buffer.from(encoded, "base64");
      if (key.length !== 32 || key.toString("base64") !== encoded) throw new Error();
      return [id, key];
    }));
    if (!Object.hasOwn(bytes, active)) throw new Error();
    return { active, bytes };
  } catch { throw new GoogleError("CONFIG_MISSING"); }
}
export function encryptionConfigured() { try { keys(); return true; } catch { return false; } }
export function seal(value: unknown, context: string): string {
  const { active, bytes } = keys();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", bytes[active], iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [active, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}
export function unseal(value: string, context: string): unknown {
  const { bytes } = keys();
  try {
    const [id, encodedIv, encodedTag, encodedData, extra] = value.split(".");
    if (extra || !Object.hasOwn(bytes, id)) throw new Error();
    const iv = Buffer.from(encodedIv, "base64url"), tag = Buffer.from(encodedTag, "base64url");
    if (iv.length !== 12 || tag.length !== 16) throw new Error();
    const cipher = createDecipheriv("aes-256-gcm", bytes[id], iv);
    cipher.setAAD(Buffer.from(context)); cipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([cipher.update(Buffer.from(encodedData, "base64url")), cipher.final()]).toString("utf8"));
  } catch { throw new GoogleError("CONFIG_MISSING"); }
}
export const secretHash = (value: string) => createHash("sha256").update(value).digest("hex");
export function secretMatches(value: string, expectedHash: string) {
  if (value.length > 512 || !/^[a-f0-9]{64}$/.test(expectedHash)) return false;
  return timingSafeEqual(Buffer.from(secretHash(value), "hex"), Buffer.from(expectedHash, "hex"));
}
