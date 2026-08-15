// AES-256-GCM encryption for farm connection API keys. Server-only: the
// secret lives in FARM_API_ENCRYPTION_KEY (32 bytes as 64 hex chars, or any
// passphrase which is hashed to 32 bytes). Ciphertext format:
// base64(iv).base64(authTag).base64(data)

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

function keyBytes(): Buffer {
  const raw = process.env.FARM_API_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("FARM_API_ENCRYPTION_KEY is not configured on the server.");
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  return createHash("sha256").update(raw, "utf8").digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${data.toString("base64")}`;
}

export function decryptSecret(ciphertext: string): string {
  const [iv, tag, data] = ciphertext.split(".").map((p) => Buffer.from(p, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", keyBytes(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
