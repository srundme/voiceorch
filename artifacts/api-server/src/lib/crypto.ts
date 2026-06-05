/**
 * AES-256-GCM encryption for provider API keys stored in the database.
 *
 * Key is derived from SESSION_SECRET using scrypt so the output is always a
 * 32-byte buffer, regardless of the secret's length.
 *
 * Encrypted format:  enc:v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>
 * Plaintext passthrough: any value that does NOT start with "enc:v1:" is
 * returned as-is, so pre-existing un-encrypted keys continue to work.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { APP_SECRET } from "./app-secret.js";

// Stable 32-byte AES key derived from the app secret
const ENCRYPTION_KEY = scryptSync(APP_SECRET, "voiceorch-api-key-salt-v1", 32);

const ALGO   = "aes-256-gcm";
const PREFIX = "enc:v1:";

export function encryptKey(plaintext: string): string {
  const iv      = randomBytes(12); // 96-bit IV — recommended for GCM
  const cipher  = createCipheriv(ALGO, ENCRYPTION_KEY, iv);
  const enc     = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag     = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

export function decryptKey(stored: string): string {
  // Plaintext passthrough — handles pre-encryption keys transparently
  if (!stored.startsWith(PREFIX)) return stored;

  const parts = stored.slice(PREFIX.length).split(":");
  if (parts.length !== 3) throw new Error("Malformed encrypted key");
  const [ivHex, tagHex, encHex] = parts as [string, string, string];

  const decipher = createDecipheriv(ALGO, ENCRYPTION_KEY, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(encHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
}
