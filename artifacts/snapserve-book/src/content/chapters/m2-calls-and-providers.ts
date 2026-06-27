import type { Chapter } from "../types";

export const callsAndProviders: Chapter = {
  slug: "calls-and-providers",
  moduleId: "m2",
  number: "3.3",
  title: "Calls, Providers & Encrypted Keys",
  summary:
    "How a call is recorded and how user-supplied API keys are stored encrypted at rest.",
  estMinutes: 14,
  fileRef: "lib/db/src/schema/calls.ts",
  prerequisites: ["drizzle-intro", "users-and-agents"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "Every phone call SnapServe makes or answers leaves a paper trail: who was dialed, how long it lasted, the transcript, a summary, latency numbers, the cost in cents, and — optionally — the recorded audio itself. That trail is the `calls` table and its satellites. It's what powers the call list, the analytics dashboards, and the per-call billing you'll meet in Module 8.",
        "Right next door is the `providers` table. When a user brings their **own** API keys (BYOP — 'bring your own provider') for OpenAI, Deepgram, ElevenLabs, and friends, those secrets have to be stored somewhere. Storing a customer's API key as plain text in a database is a security incident waiting to happen — so SnapServe **encrypts them at rest**. This chapter walks both tables and the little crypto helper that protects those keys.",
      ],
    },
    {
      kind: "concept",
      title: "Storing binary, and the satellite-table pattern",
      body: [
        "Most columns hold text or numbers, but a call **recording** is raw binary audio. Postgres has a type for that — `bytea` — and Drizzle reaches it through `customType`, returning the bytes to JavaScript as a Node `Buffer`.",
        "SnapServe keeps recordings in their **own** table (`call_recordings`) rather than as a column on `calls`. Why? Because every time you list calls, you'd otherwise drag megabytes of audio along for the ride. By splitting the heavy binary into a satellite table linked by a foreign key, the normal 'list my calls' query stays fast and light.",
        "You'll see the same pattern for `call_events` and `execution_logs`: high-volume, append-only child rows that hang off a call without bloating it.",
      ],
    },
    {
      kind: "analogy",
      title: "Encryption at rest is a locked filing cabinet",
      body: [
        "Imagine a user hands you their house key (their API key) so your agent can run errands on their behalf. You can't just leave it on the front desk. You lock it in a filing cabinet, and the **only** key to that cabinet is derived from a master secret (`SESSION_SECRET`) that lives in the server's environment, never in the database.",
        "Even if someone walked off with the entire database, all they'd find is scrambled ciphertext — `enc:v1:…` — useless without the master secret. That's 'encryption at rest': the data sits encrypted on disk and is only unlocked, in memory, the moment it's actually needed.",
      ],
    },
    {
      kind: "code",
      filename: "lib/db/src/schema/calls.ts",
      language: "typescript",
      intro:
        "The core `calls` table. One row is the full record of a single phone call — and notice the real FK back to `agents`.",
      code: `export const callsTable = pgTable("calls", {
  id: serial("id").primaryKey(),
  userId: text("user_id"),
  agentId: integer("agent_id").notNull().references(() => agentsTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"),
  toNumber: text("to_number").notNull(),
  fromNumber: text("from_number").notNull(),
  durationSeconds: integer("duration_seconds"),
  transcript: text("transcript"),
  recordingUrl: text("recording_url"),
  callSummary: text("call_summary"),
  // …
  sttLatencyMs: integer("stt_latency_ms"),
  llmLatencyMs: integer("llm_latency_ms"),
  ttsFirstChunkMs: integer("tts_first_chunk_ms"),
  costCents: integer("cost_cents"),
  dispositionResult: json("disposition_result").$type<Record<string, string | number | boolean>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
});`,
      lines: [
        {
          lines: "3",
          label: "agentId.references(() => agentsTable.id, { onDelete: \"cascade\" })",
          explanation:
            "A real integer FK to `agents.id`. `onDelete: \"cascade\"` means deleting an agent removes all of its calls too. (`userId` above is text — the Google sub — same dual-ownership style you saw in the last chapter.)",
        },
        {
          lines: "4",
          label: 'status: text("status").default("pending")',
          explanation:
            "A call's lifecycle as a text enum: it starts `\"pending\"` and moves through ringing / in-progress / completed / failed as the orchestration engine drives it.",
        },
        {
          lines: "5-6",
          label: "toNumber / fromNumber",
          explanation:
            "Both required. For inbound calls `fromNumber` is the caller; for outbound it's reversed. These two numbers are exactly what caller-memory canonicalization keys on (next chapter).",
        },
        {
          lines: "8-10",
          label: "transcript / recordingUrl / callSummary",
          explanation:
            "The conversational artifacts. `transcript` is the full text, `callSummary` is the LLM-generated TL;DR, and `recordingUrl` may point at audio (the bytes themselves live in a separate table).",
        },
        {
          lines: "12-14",
          label: "the three latency columns",
          explanation:
            "Performance telemetry baked right into the row: how long speech-to-text, the LLM, and the first chunk of text-to-speech took. These feed the analytics and the agent's rolling averages.",
        },
        {
          lines: "15",
          label: 'costCents: integer("cost_cents")',
          explanation:
            "The resolved price of the call in integer cents — written at call-end by the billing engine (Module 8). Integer cents again, never a float.",
        },
        {
          lines: "16",
          label: "dispositionResult: json(…).$type<…>()",
          explanation:
            "Structured post-call extraction (e.g. 'interested: true', 'budget: 50000') stored as a typed JSON object — the `$type<>` keeps TypeScript honest about its shape.",
        },
      ],
    },
    {
      kind: "code",
      filename: "lib/db/src/schema/calls.ts",
      language: "typescript",
      intro:
        "The binary recording lives in its own satellite table. Here's the `bytea` custom type and the `call_recordings` table that uses it.",
      code: `/** Raw binary column (PostgreSQL \`bytea\`) stored/returned as a Node Buffer. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

// ── Call Recordings — encoded WAV blobs stored directly in Postgres ────────
export const callRecordingsTable = pgTable("call_recordings", {
  id: serial("id").primaryKey(),
  callId: integer("call_id").notNull().references(() => callsTable.id, { onDelete: "cascade" }),
  audio: bytea("audio").notNull(),
  contentType: text("content_type").notNull().default("audio/wav"),
  byteSize: integer("byte_size").notNull(),
  sampleRate: integer("sample_rate").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("call_recordings_call_id_idx").on(t.callId)]);`,
      lines: [
        {
          lines: "2-6",
          label: "customType<{ data: Buffer }>({ dataType() { return \"bytea\" } })",
          explanation:
            "Drizzle has no built-in binary column, so this defines one. `dataType()` returns the raw SQL type `bytea`; the generic `{ data: Buffer }` tells TypeScript the value is a Node `Buffer` on both read and write.",
        },
        {
          lines: "11",
          label: "callId FK with cascade",
          explanation:
            "Links each recording to its call. Cascade delete means removing a call also removes its audio — no orphaned blobs left taking up space.",
        },
        {
          lines: "12",
          label: 'audio: bytea("audio").notNull()',
          explanation:
            "The actual encoded WAV bytes, stored **directly in Postgres**. Because it's in a separate table, listing calls never touches these megabytes.",
        },
        {
          lines: "17",
          label: "index(\"call_recordings_call_id_idx\").on(t.callId)",
          explanation:
            "The table's third argument is a function returning index definitions. This index makes 'fetch the recording for call X' an instant lookup instead of a full-table scan.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "why",
      title: "Why split recordings into their own table?",
      body: [
        "The file even says it: recordings are 'kept in a separate table (not a column on `calls`) so the binary audio is **never loaded by normal call list/detail queries**.' Audio is huge; metadata is tiny. Keep them apart and the 99% of queries that only want metadata stay snappy.",
      ],
    },
    {
      kind: "code",
      filename: "lib/db/src/schema/providers.ts",
      language: "typescript",
      intro:
        "Now the `providers` table — where a user's BYOP API keys are stored. Look closely: `apiKey` is just a `text` column. The encryption happens in the route layer before the value ever reaches here.",
      code: `export const providersTable = pgTable("providers", {
  id: serial("id").primaryKey(),
  userId: text("user_id"),
  providerType: text("provider_type").notNull(),
  providerName: text("provider_name").notNull(),
  apiKey: text("api_key").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  extraConfig: text("extra_config"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});`,
      lines: [
        {
          lines: "4-5",
          label: "providerType / providerName",
          explanation:
            "`providerType` is the category (e.g. `\"stt\"`, `\"llm\"`, `\"tts\"`) and `providerName` is the vendor (e.g. `\"deepgram\"`, `\"openai\"`). Together they say 'this is the user's OpenAI LLM key'.",
        },
        {
          lines: "6",
          label: 'apiKey: text("api_key").notNull()',
          explanation:
            "Just a text column — the **schema itself doesn't encrypt anything**. What gets stored here is already-encrypted ciphertext (`enc:v1:…`), produced by `encryptKey()` in the providers route before insert. The DB only ever sees the scrambled form.",
        },
        {
          lines: "7",
          label: 'isActive: boolean(…).default(true)',
          explanation:
            "Lets a user disable a provider without deleting it — handy for temporarily switching vendors.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/lib/crypto.ts",
      language: "typescript",
      intro:
        "Here's the actual encryption helper. AES-256-GCM, with the key derived from `SESSION_SECRET` via scrypt — exactly as replit.md describes.",
      code: `// Stable 32-byte AES key derived from the app secret
const ENCRYPTION_KEY = scryptSync(APP_SECRET, "voiceorch-api-key-salt-v1", 32);

const ALGO   = "aes-256-gcm";
const PREFIX = "enc:v1:";

export function encryptKey(plaintext: string): string {
  const iv      = randomBytes(12); // 96-bit IV — recommended for GCM
  const cipher  = createCipheriv(ALGO, ENCRYPTION_KEY, iv);
  const enc     = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag     = cipher.getAuthTag();
  return \`\${PREFIX}\${iv.toString("hex")}:\${tag.toString("hex")}:\${enc.toString("hex")}\`;
}

export function decryptKey(stored: string): string {
  // Plaintext passthrough — handles pre-encryption keys transparently
  if (!stored.startsWith(PREFIX)) return stored;
  // … parse iv/tag/ciphertext, then decrypt …
}`,
      lines: [
        {
          lines: "2",
          label: "scryptSync(APP_SECRET, \"…salt…\", 32)",
          explanation:
            "Turns the app secret (derived from `SESSION_SECRET`) into a deterministic **32-byte** key — exactly what AES-256 needs — using the slow `scrypt` hash. Same secret in → same key out, every time the server boots.",
        },
        {
          lines: "4",
          label: 'ALGO = "aes-256-gcm"',
          explanation:
            "AES-256 in **GCM** mode. GCM is 'authenticated' encryption — it not only hides the data but also produces an `authTag` that detects tampering. Mess with a single byte and decryption refuses to run.",
        },
        {
          lines: "8",
          label: "iv = randomBytes(12)",
          explanation:
            "A fresh random 96-bit **initialization vector** per encryption. This is why encrypting the same key twice yields two different ciphertexts — it prevents pattern leaks.",
        },
        {
          lines: "12",
          label: "return `enc:v1:<iv>:<tag>:<ciphertext>`",
          explanation:
            "The stored format is just hex strings glued together with a version prefix. Everything needed to decrypt (except the secret key) travels with the ciphertext.",
        },
        {
          lines: "17",
          label: 'if (!stored.startsWith(PREFIX)) return stored',
          explanation:
            "**Plaintext passthrough**: any value not starting with `enc:v1:` is returned as-is. This is the migration trick — keys saved before encryption existed still work, untouched.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "Old provider keys are still plaintext until re-saved",
      body: [
        "From replit.md: provider `apiKey` is encrypted at rest (AES-256-GCM, key derived from `SESSION_SECRET`). But existing keys added **before** this change are still plaintext in the DB — `decryptKey` passes them through transparently thanks to the `enc:v1:` prefix check.",
        "The fix is human, not automatic: 're-save each provider in the Providers page to encrypt them.' So don't assume every row in `providers` is ciphertext — some legacy rows may still be plaintext until touched.",
      ],
    },
    {
      kind: "connections",
      title: "How it connects",
      intro:
        "Calls and providers tie the data model to the live engine and the billing system. Click to explore.",
      nodes: [
        { id: "calls", label: "calls", sublabel: "one row per phone call — THIS CHAPTER", current: true },
        { id: "recordings", label: "call_recordings", sublabel: "bytea audio satellite — THIS CHAPTER", current: true },
        { id: "providers", label: "providers", sublabel: "encrypted BYOP keys — THIS CHAPTER", current: true },
        { id: "crypto", label: "crypto.ts", sublabel: "encryptKey / decryptKey", current: true },
        { id: "agents", label: "agents", sublabel: "calls FK here", chapterSlug: "users-and-agents" },
        { id: "pipeline", label: "the pipeline", sublabel: "writes call rows live", chapterSlug: "session-and-pipeline" },
        { id: "adapters", label: "adapters", sublabel: "use decrypted keys", chapterSlug: "adapter-pattern" },
        { id: "billing", label: "billing", sublabel: "sets costCents", chapterSlug: "minute-rates" },
      ],
      edges: [
        { from: "agents", to: "calls", label: "agentId FK (cascade)" },
        { from: "calls", to: "recordings", label: "callId FK (cascade)" },
        { from: "pipeline", to: "calls", label: "status, transcript, latency" },
        { from: "crypto", to: "providers", label: "encryptKey on save" },
        { from: "providers", to: "adapters", label: "decryptKey at call time" },
        { from: "calls", to: "billing", label: "costCents" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "Why are call recordings stored in a separate `call_recordings` table instead of a column on `calls`?",
          choices: [
            "Postgres can't store binary in the main table.",
            "So the heavy binary audio is never loaded by normal call list/detail queries, keeping them fast.",
            "Because recordings belong to a different user.",
            "To allow more than one recording per call.",
          ],
          correctIndex: 1,
          explanation:
            "Splitting the megabyte-scale `bytea` audio into a satellite table means the common metadata queries stay lightweight. Only when you explicitly want the audio do you touch it.",
        },
        {
          prompt: "Where does the encryption of a provider's API key actually happen?",
          choices: [
            "Inside the `providers` table definition.",
            "In Postgres automatically.",
            "In the route layer via `encryptKey()` before insert; the schema column is plain `text` holding ciphertext.",
            "It isn't encrypted.",
          ],
          correctIndex: 2,
          explanation:
            "The schema stores `apiKey` as text. `encryptKey()` (AES-256-GCM, key from `SESSION_SECRET`) scrambles the value into `enc:v1:…` before it's saved, so the DB only ever sees ciphertext.",
        },
        {
          prompt: "What does `decryptKey` do when it sees a value that does NOT start with `enc:v1:`?",
          choices: [
            "Throws an error.",
            "Returns it unchanged (plaintext passthrough) so pre-encryption keys still work.",
            "Deletes the row.",
            "Re-encrypts it.",
          ],
          correctIndex: 1,
          explanation:
            "The prefix check makes the migration transparent: legacy plaintext keys pass through untouched until a user re-saves the provider, which then encrypts them.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "`calls` is the full record of one phone call: numbers, status, transcript, summary, latency, cost, and disposition.",
        "`calls.agentId` is a real FK to `agents.id` with cascade delete; `userId` is the text Google sub.",
        "Binary recordings live in a satellite `call_recordings` table (a `bytea`/Buffer column) so listing calls stays fast.",
        "Provider BYOP keys are encrypted at rest with AES-256-GCM, the key derived from `SESSION_SECRET` via scrypt.",
        "Encryption happens in the route layer (`encryptKey`), not the schema; the column is plain text holding `enc:v1:…` ciphertext.",
        "`decryptKey` passes non-prefixed values through unchanged — legacy plaintext keys keep working until re-saved.",
      ],
    },
  ],
};
