import type { Chapter } from "../types";

export const secretsAndEnv: Chapter = {
  slug: "secrets-and-env",
  moduleId: "m11",
  number: "12.2",
  title: "Secrets, Env Vars & Provider Key Encryption",
  summary:
    "How SnapServe protects API keys at rest with AES-256-GCM, how secrets flow from Replit to Railway, and what `encryptKey`/`decryptKey` actually do.",
  estMinutes: 16,
  fileRef: "artifacts/api-server/src/lib/encryption.ts",
  prerequisites: ["railway-deployment", "middleware-and-auth"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "Two kinds of secrets",
      paragraphs: [
        "SnapServe deals with two categories of secrets. **Platform secrets** are the keys that run the platform itself — database URL, session signing secret, Razorpay keys, Sarvam API key, Google OAuth credentials. These are environment variables set in Replit (dev) or Railway (prod) and never touch the database.",
        "**User-supplied provider keys** are the BYOP API keys users add in the Providers page — their personal OpenAI key, ElevenLabs key, Deepgram key, etc. These arrive via the API, are encrypted, and stored in the `providers` table. They're a different class of secret: user-owned, user-controlled, and user-deletable.",
      ],
    },
    {
      kind: "concept",
      title: "AES-256-GCM: authenticated encryption",
      body: [
        "SnapServe encrypts user provider keys at rest using **AES-256-GCM**. Here's what that means:",
        "**AES-256**: Advanced Encryption Standard with a 256-bit key. The de-facto standard for symmetric encryption. 256-bit = 1.16 × 10^77 possible keys — computationally infeasible to brute-force.",
        "**GCM (Galois/Counter Mode)**: A mode of AES that provides both **confidentiality** (the ciphertext reveals nothing about the plaintext) and **authentication** (any tampering with the ciphertext is detected before decryption). This is crucial: without authentication, an attacker could flip bits in the ciphertext and the decryption would silently produce garbage.",
        "The encryption key is derived from `SESSION_SECRET` — the same secret used to sign session JWTs. This means rotating `SESSION_SECRET` requires re-encrypting all stored provider keys (see the re-save migration note in the Gotchas section of `replit.md`).",
      ],
    },
    {
      kind: "code",
      filename: "lib/encryption.ts",
      language: "typescript",
      intro:
        "The `encryptKey` and `decryptKey` functions. Every provider key is stored as `iv:authTag:ciphertext` — three hex-encoded components separated by colons.",
      code: `const ALGORITHM = "aes-256-gcm";
const KEY_LEN    = 32; // 256 bits

function deriveKey(): Buffer {
  // Derive a 32-byte key from SESSION_SECRET using SHA-256
  return createHash("sha256")
    .update(process.env["SESSION_SECRET"] ?? "")
    .digest();
}

export function encryptKey(plaintext: string): string {
  const key = deriveKey();
  const iv  = randomBytes(16); // fresh IV every encryption
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return \`\${iv.toString("hex")}:\${authTag.toString("hex")}:\${encrypted.toString("hex")}\`;
}

export function decryptKey(stored: string): string {
  // Backward compat: if stored doesn't look like iv:tag:cipher, it's plaintext
  if (!stored.includes(":")) return stored;

  const [ivHex, tagHex, cipherHex] = stored.split(":");
  const key     = deriveKey();
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex!, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex!, "hex"));

  return decipher.update(Buffer.from(cipherHex!, "hex"), undefined, "utf8")
    + decipher.final("utf8");
}`,
      lines: [
        {
          lines: "4-8",
          label: "key derivation via SHA-256",
          explanation:
            "`SESSION_SECRET` is an arbitrary string; AES-256 requires exactly 32 bytes. SHA-256 of any input always produces exactly 32 bytes. This is a simple KDF (Key Derivation Function). A more robust system would use PBKDF2 or Argon2, but SHA-256 is sufficient here since `SESSION_SECRET` is already a high-entropy random value.",
        },
        {
          lines: "13",
          label: "fresh IV every call",
          explanation:
            "The **IV (Initialisation Vector)** must be unique for every encryption under the same key. Reusing an IV with AES-GCM is catastrophic — it leaks the XOR of the two plaintexts. `randomBytes(16)` generates a fresh 16-byte IV on every `encryptKey` call. The IV is stored alongside the ciphertext (it's not secret, just unique).",
        },
        {
          lines: "23-24",
          label: "backward compat for plaintext",
          explanation:
            "Before encryption was added, keys were stored in plaintext. `decryptKey` checks for the `iv:tag:ciphertext` format and passes through plaintext unchanged. This transparently migrates legacy keys — they'll be re-encrypted the next time the user saves their providers.",
        },
        {
          lines: "29-30",
          label: "setAuthTag — tamper detection",
          explanation:
            "GCM produces an authentication tag during encryption. `setAuthTag` provides this tag to the decipher. If the ciphertext was tampered with (even a single bit flipped), `decipher.final()` throws an `AuthTag mismatch` error before any plaintext is returned. This is authenticated encryption.",
        },
      ],
    },
    {
      kind: "prose",
      heading: "The full provider key lifecycle",
      paragraphs: [
        "**Create**: User POSTs their API key to `POST /providers`. The route calls `encryptKey(apiKey)` and stores the encrypted string in `providers.apiKey`. Only the last 4 characters of the plaintext are stored separately (`providers.maskedKey`) for display in the UI.",
        "**Read**: Displayed keys show only the last 4 characters (`maskedKey`). The full plaintext is never returned via the API — there's no 'reveal key' endpoint. The encrypted string is only decrypted server-side, in the adapter constructors.",
        "**Use**: At session build time, the LLM/STT/TTS adapter constructors call `decryptKey(row.apiKey)` to get the plaintext and pass it to the provider's SDK. The plaintext exists in memory only during the call.",
        "**Delete**: DELETE /providers/:id removes the row entirely. The encrypted key is gone.",
      ],
    },
    {
      kind: "callout",
      variant: "warning",
      title: "Rotating SESSION_SECRET",
      body: [
        "If you rotate `SESSION_SECRET` in production, all encrypted provider keys in the database become unreadable — `decryptKey` will produce a garbage decrypted string that causes 401s from the provider APIs. Before rotating, decrypt and re-encrypt every row with the new key, or ask all users to re-save their providers after the rotation.",
      ],
    },
    {
      kind: "concept",
      title: "Platform secret management: Replit vs. Railway",
      body: [
        "In Replit's dev environment, secrets are managed via the Replit UI (the lock icon). They're injected as environment variables into the container at runtime — never stored in `.env` files (which would end up in Git). The Replit UI calls them 'Secrets' to emphasise they don't belong in code.",
        "In Railway (production), the same variables are set in the Railway dashboard under 'Variables'. Railway injects them as environment variables into the running container. The variable names are identical in both environments.",
        "There's no `.env` file in the repository. Any secret committed to Git is compromised — it's in the commit history permanently, even if 'deleted' later.",
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "Why does `encryptKey` generate a fresh random IV on every call?",
          choices: [
            "To make the ciphertext a different length each time",
            "Reusing an IV with AES-GCM leaks XOR of plaintexts — each encryption needs a unique IV",
            "Because `SESSION_SECRET` changes between calls",
            "To prevent replay attacks from the client",
          ],
          correctIndex: 1,
          explanation:
            "In GCM mode, reusing the same (key, IV) pair for two encryptions exposes the XOR of their plaintexts, completely breaking confidentiality. A fresh random IV for every encryption is mandatory.",
        },
        {
          prompt: "What does `decryptKey` return when it receives a plaintext string (no colons)?",
          choices: [
            "It throws an error — plaintext is not supported",
            "It encrypts the string and returns the encrypted form",
            "The original plaintext string unchanged (backward compat passthrough)",
            "An empty string",
          ],
          correctIndex: 2,
          explanation:
            "Legacy keys stored before encryption was added are in plaintext. `decryptKey` detects this by checking for the `iv:tag:cipher` colon format and passes plaintext through unchanged, enabling transparent migration.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "User provider keys are encrypted with AES-256-GCM at rest; the key is derived from `SESSION_SECRET`",
        "IV is regenerated on every `encryptKey` call — reusing an IV with AES-GCM is catastrophic",
        "GCM provides authentication: any tampered ciphertext throws before decryption returns plaintext",
        "Only the last 4 chars (`maskedKey`) are ever shown in the UI — no 'reveal' endpoint exists",
        "Legacy plaintext keys pass through `decryptKey` transparently; they're re-encrypted on the next save",
      ],
    },
  ],
};
