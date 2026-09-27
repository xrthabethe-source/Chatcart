// Per-seller courier credentials are encrypted at rest with AES-256-GCM
// under DELIVERY_CREDENTIALS_KEY. They are decrypted only in the service
// that is about to call the provider and are never sent to a browser —
// the settings API reports `hasCredentials: true` instead.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key(): Buffer {
  const raw = process.env.DELIVERY_CREDENTIALS_KEY;
  if (!raw) throw new Error("DELIVERY_CREDENTIALS_KEY is not set; cannot store courier credentials.");
  const buf = Buffer.from(raw, "base64");
  if (buf.length !== 32) throw new Error("DELIVERY_CREDENTIALS_KEY must be 32 bytes, base64-encoded.");
  return buf;
}

export function encryptCredentials(credentials: Record<string, string>): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(credentials), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), ciphertext.toString("base64")].join(".");
}

export function decryptCredentials(payload: string | null): Record<string, string> | null {
  if (!payload) return null;
  const [version, iv, tag, data] = payload.split(".");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Unrecognised credentials format.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  const plain = Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
  return JSON.parse(plain) as Record<string, string>;
}
