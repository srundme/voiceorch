import type { Chapter } from "../types";

export const callerMemoryTables: Chapter = {
  slug: "caller-memory-tables",
  moduleId: "m2",
  number: "3.4",
  title: "Caller Memory: Remembering Who Called",
  summary:
    "The phone-keyed tables that let an agent greet a returning caller by name.",
  estMinutes: 16,
  fileRef: "lib/db/src/schema/callerProfiles.ts",
  prerequisites: ["drizzle-intro", "users-and-agents"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "The difference between a robot and a receptionist is **memory**. When you call your bank for the third time, you'd love it if they already knew your name, what you called about last week, and that you prefer Hindi. SnapServe's caller-memory tables make exactly that possible: an agent can greet a returning caller by name and pick up where the last conversation left off.",
        "Three tables do the heavy lifting. `caller_profiles` is the one-line summary of a person ('who is this, how many times have they called, what do they prefer'). `caller_facts` is an append-only ledger of atomic things we've learned ('budget = 50k', 'has a golden retriever'). And `caller_call_archive` keeps one row per past call — the full transcript and summary. All three are keyed the same way: by **agent + phone number**.",
        "That key is the whole ballgame — and it's also the source of SnapServe's nastiest historical bug. Let's see why.",
      ],
    },
    {
      kind: "concept",
      title: "Composite keys & the canonicalization problem",
      body: [
        "Memory isn't global — it belongs to a specific agent. Your dentist's AI shouldn't see what you told your bank's AI. So caller memory is keyed on a **pair**: `(agent_id, phone_number)`. This is a **composite key** — two columns that together identify a caller's memory for that agent.",
        "Here's the trap. A phone number arrives in many shapes across calls: `+919876543210` on one call, `919876543210` on the next, `09876543210` on a third. To a database those are **three different strings** — so memory written under one shape is invisible when you look it up under another. The agent would greet a regular as a total stranger.",
        "The fix is **canonicalization**: run every number through one function (`canonicalizeCallerKey`) that collapses all the variants to a single stable form **before** reading or writing. The `(agent_id, phone_number)` you store is always the canonical one, so read and write can never drift apart.",
      ],
    },
    {
      kind: "analogy",
      title: "A filing cabinet keyed by a messy name",
      body: [
        "Imagine filing customer folders by name, but people write theirs differently each visit: 'Bob', 'Robert', 'BOB '. File under each spelling and you end up with three half-empty folders for one person — and you can never find the right one.",
        "Canonicalization is the office rule: 'always file under the full legal name, uppercased, trimmed.' Everyone follows it on the way in **and** the way out, so there's exactly one folder per person and you always find it. `canonicalizeCallerKey` is that office rule for phone numbers.",
      ],
    },
    {
      kind: "code",
      filename: "lib/db/src/schema/callerProfiles.ts",
      language: "typescript",
      intro:
        "The `caller_profiles` table — the at-a-glance record of one caller. Note the composite key at the bottom.",
      code: `export const callerProfilesTable = pgTable("caller_profiles", {
  id:                serial("id").primaryKey(),
  agentId:           integer("agent_id").references(() => agentsTable.id, { onDelete: "cascade" }).notNull(),
  phoneNumber:       text("phone_number").notNull(),
  name:              text("name"),
  summary:           text("summary"),
  callCount:         integer("call_count").default(0).notNull(),
  lastCalledAt:      timestamp("last_called_at"),
  // Dropped-call tracking — used to inject continuation context on the next call
  lastCallDropped:   boolean("last_call_dropped").default(false).notNull(),
  preferredLanguage: text("preferred_language"),
  createdAt:         timestamp("created_at").defaultNow().notNull(),
  updatedAt:         timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("caller_profiles_agent_phone_uidx").on(t.agentId, t.phoneNumber),
]);`,
      lines: [
        {
          lines: "3",
          label: "agentId.references(() => agentsTable.id, { onDelete: \"cascade\" })",
          explanation:
            "Memory belongs to an agent. FK to `agents.id` with cascade — delete an agent and all of its caller memory goes too. This is the first half of the composite key.",
        },
        {
          lines: "4",
          label: 'phoneNumber: text("phone_number").notNull()',
          explanation:
            "The second half of the key — and the value that MUST be canonicalized before it lands here. Store a non-canonical number and you've created a folder nobody will find again.",
        },
        {
          lines: "5-6",
          label: "name / summary",
          explanation:
            "The human-friendly payload: the caller's name (so the agent can say 'Hi Priya') and a rolling one-line summary of who they are. Both nullable — filled in as the agent learns.",
        },
        {
          lines: "7-8",
          label: "callCount / lastCalledAt",
          explanation:
            "Frequency signals. `callCount` increments each call; `lastCalledAt` records recency. Together they let the agent say 'welcome back' to a third-time caller.",
        },
        {
          lines: "9-10",
          label: "lastCallDropped",
          explanation:
            "If the previous call dropped unexpectedly, this flag lets the next call open with continuation context ('sorry we got cut off earlier') instead of starting cold.",
        },
        {
          lines: "11",
          label: 'preferredLanguage: text("preferred_language")',
          explanation:
            "The BCP-47 language the caller ended their last call in. When auto-detect is on, the next call starts in this language — so a Hindi speaker never has to switch again.",
        },
        {
          lines: "14-16",
          label: "uniqueIndex(\"…\").on(t.agentId, t.phoneNumber)",
          explanation:
            "The crucial line. A **unique** composite index on `(agentId, phoneNumber)` — the database itself guarantees at most one profile per caller per agent. This is what makes the canonical key enforceable, not just convention.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "Canonicalize on BOTH the read and write paths — or memory silently misses",
      body: [
        "Straight from replit.md: caller memory is keyed on `(agent_id, phone_number)`, and the `phone_number` MUST be derived via `canonicalizeCallerKey` (`lib/db/src/caller-identity.ts`, exported from `@workspace/db`) on **both** the read path (`loadCallerContext`) and the write path (`updateCallerProfile` / `archiveCall` / `supersedeFact` / `latch*`).",
        "Otherwise format drift between calls (a `+` prefix, a trunk `0`, inbound `fromNumber` vs outbound `toNumber`) **silently misses** stored memory and the agent greets a returning caller as a stranger. `humanPhone` already returns the canonical key; web calls use the synthetic `webcall:user_<id>` key (passed through unchanged). India defaults (CC `91`, national length `10`) are tunable via `CALLER_ID_DEFAULT_CC` / `CALLER_ID_NATIONAL_LEN`.",
      ],
    },
    {
      kind: "code",
      filename: "lib/db/src/caller-identity.ts",
      language: "typescript",
      intro:
        "Here's the canonicalizer itself — the single rule both read and write obey. It collapses every common phone-number shape into one string.",
      code: `export function canonicalizeCallerKey(identity: string | null | undefined): string | null {
  const raw = (identity ?? "").trim();
  if (!raw) return null;

  // Modern canonical form — pass through unchanged.
  if (raw.startsWith(WEBCALL_KEY_PREFIX)) {
    const id = raw.slice(WEBCALL_KEY_PREFIX.length).trim();
    return id ? \`\${WEBCALL_KEY_PREFIX}\${id}\` : null;
  }
  // … other web-call prefixes normalised to webcall:user_<id> …

  if (isRealPhoneNumber(raw)) return canonicalizePhone(raw);

  // Not a phone number and not a known synthetic shape — nothing to key on.
  return null;
}`,
      lines: [
        {
          lines: "1",
          label: "canonicalizeCallerKey(identity): string | null",
          explanation:
            "One identity string in, one canonical key (or `null`) out. The whole point: feed it any shape of the same caller and you always get the same string back.",
        },
        {
          lines: "2-3",
          label: "trim + empty guard",
          explanation:
            "Normalize whitespace first, and bail to `null` for empty input — `null` means 'no memory key', so the caller is treated as anonymous rather than mis-filed.",
        },
        {
          lines: "5-9",
          label: "web-call passthrough",
          explanation:
            "Browser web calls don't have a real phone number, so they use a synthetic `webcall:user_<id>` key. Those are already canonical and pass straight through.",
        },
        {
          lines: "12",
          label: "if (isRealPhoneNumber(raw)) return canonicalizePhone(raw)",
          explanation:
            "Real phone numbers go through `canonicalizePhone`, which strips `+`, handles `00` international prefixes, drops the national trunk `0`, and expands bare national numbers with the default country code. All variants → one form.",
        },
        {
          lines: "14-15",
          label: "return null for unknown shapes",
          explanation:
            "If it's neither a phone number nor a known synthetic key, return `null`. Both read and write land here identically, so even the 'give up' case is deterministic.",
        },
      ],
    },
    {
      kind: "code",
      filename: "lib/db/src/schema/callerFacts.ts",
      language: "typescript",
      intro:
        "Facts are stored **append-only**: instead of editing a row, a new one is inserted and the old one is marked superseded. Here's the `caller_facts` table.",
      code: `export const callerFactsTable = pgTable("caller_facts", {
  id:             serial("id").primaryKey(),
  agentId:        integer("agent_id").references(() => agentsTable.id, { onDelete: "cascade" }).notNull(),
  phoneNumber:    text("phone_number").notNull(),
  key:            text("key").notNull(),
  value:          text("value").notNull(),
  confidence:     real("confidence").notNull().default(1.0),
  sourceCallId:   integer("source_call_id"),
  /** FK → caller_facts.id — superseded_by edge for conflict resolution */
  supersededById: integer("superseded_by_id").references((): AnyPgColumn => callerFactsTable.id),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("caller_facts_lookup_idx").on(t.agentId, t.phoneNumber),
  index("caller_facts_active_idx").on(t.agentId, t.phoneNumber, t.supersededById),
]);`,
      lines: [
        {
          lines: "2-4",
          label: "same composite key (agentId, phoneNumber)",
          explanation:
            "Facts use the identical `(agent_id, phone_number)` key as profiles — so the same canonicalization rule applies. Same caller, same key, across all three memory tables.",
        },
        {
          lines: "5-6",
          label: "key / value",
          explanation:
            "An atomic fact as a key/value pair — `key: \"preferred_name\"`, `value: \"Sam\"`. Small, composable nuggets the agent can recall individually.",
        },
        {
          lines: "7",
          label: 'confidence: real(…).default(1.0)',
          explanation:
            "How sure we are of this fact (0.0–1.0). Lets the agent weigh a confidently-extracted fact more heavily than a guess.",
        },
        {
          lines: "9",
          label: "supersededById.references((): AnyPgColumn => callerFactsTable.id)",
          explanation:
            "A **self-referencing FK** — a fact points at the newer fact that replaced it. The `AnyPgColumn` annotation is needed because the table references itself (a chicken-and-egg type the compiler needs help with). 'Current' facts are those WHERE `superseded_by_id IS NULL`.",
        },
        {
          lines: "13-14",
          label: "lookup + active indexes",
          explanation:
            "Two indexes on the composite key: one for all facts about a caller, and one that also includes `supersededById` so 'fetch only the current (non-superseded) facts' is fast. Append-only means the table grows, so good indexes matter.",
        },
      ],
    },
    {
      kind: "code",
      filename: "lib/db/src/schema/callerCallArchive.ts",
      language: "typescript",
      intro:
        "The third table: one row per past call, never deleted — the raw material facts are later extracted from.",
      code: `export const callerCallArchiveTable = pgTable("caller_call_archive", {
  id:              serial("id").primaryKey(),
  agentId:         integer("agent_id").references(() => agentsTable.id, { onDelete: "cascade" }).notNull(),
  phoneNumber:     text("phone_number").notNull(),
  callId:          integer("call_id"),
  transcript:      text("transcript").notNull(),
  summary:         text("summary"),
  durationSeconds: integer("duration_seconds"),
  factsExtracted:  boolean("facts_extracted").default(false).notNull(),
  sentiment:       text("sentiment"),  // "positive" | "neutral" | "negative" | "frustrated" | "resolved"
  createdAt:       timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("caller_call_archive_lookup_idx").on(t.agentId, t.phoneNumber),
]);`,
      lines: [
        {
          lines: "2-3",
          label: "the same composite key, a third time",
          explanation:
            "Profiles, facts, and archive all share `(agent_id, phone_number)`. Learn the key once and you understand the whole memory subsystem.",
        },
        {
          lines: "5-6",
          label: "transcript / summary",
          explanation:
            "The full conversation text (required) plus an LLM summary. One row is preserved per call — 'never deleted', per the file's own docs — so memory has a permanent source to draw from.",
        },
        {
          lines: "8",
          label: 'factsExtracted: boolean(…).default(false)',
          explanation:
            "A processing flag. After a background job mines this transcript for atomic `caller_facts`, it flips to `true` — so the same call isn't mined twice.",
        },
        {
          lines: "9",
          label: 'sentiment',
          explanation:
            "How the call felt overall. Feeds the profile's sentiment trend so an agent can be extra careful with a caller whose last few calls were 'frustrated'.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "insight",
      title: "Append-only is a feature, not waste",
      body: [
        "Notice that facts are never UPDATEd in place — a new row supersedes the old one via `superseded_by_id`. This gives you a full **history** of how your understanding of a caller changed over time, plus provenance (which call a fact came from via `source_call_id`). The schema comments call this a 'Graphiti-style memory graph': L0 = atomic facts, L1 = call episodes, linked by junction tables.",
      ],
    },
    {
      kind: "connections",
      title: "How it connects",
      intro:
        "The three memory tables, the canonical key that unites them, and where the runtime reads/writes them. Click to explore.",
      nodes: [
        { id: "profiles", label: "caller_profiles", sublabel: "who is this — THIS CHAPTER", current: true },
        { id: "facts", label: "caller_facts", sublabel: "append-only fact ledger — THIS CHAPTER", current: true },
        { id: "archive", label: "caller_call_archive", sublabel: "one row per call — THIS CHAPTER", current: true },
        { id: "canon", label: "canonicalizeCallerKey", sublabel: "caller-identity.ts — THIS CHAPTER", current: true },
        { id: "agents", label: "agents", sublabel: "agentId FK", chapterSlug: "users-and-agents" },
        { id: "calls", label: "calls", sublabel: "source transcripts", chapterSlug: "calls-and-providers" },
        { id: "memory", label: "caller memory end-to-end", sublabel: "extract & recall at runtime", chapterSlug: "caller-memory" },
        { id: "session", label: "the session", sublabel: "loadCallerContext", chapterSlug: "session-and-pipeline" },
      ],
      edges: [
        { from: "canon", to: "profiles", label: "(agentId, phone) key" },
        { from: "canon", to: "facts", label: "(agentId, phone) key" },
        { from: "canon", to: "archive", label: "(agentId, phone) key" },
        { from: "agents", to: "profiles", label: "owns (cascade)" },
        { from: "calls", to: "archive", label: "transcript source" },
        { from: "archive", to: "facts", label: "facts extracted" },
        { from: "session", to: "canon", label: "read path" },
        { from: "memory", to: "canon", label: "write path" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "What is the composite key that all three caller-memory tables share?",
          choices: [
            "(user_id, call_id)",
            "(agent_id, phone_number)",
            "(id, created_at)",
            "(phone_number, name)",
          ],
          correctIndex: 1,
          explanation:
            "Profiles, facts, and the call archive are all keyed on `(agent_id, phone_number)` — memory belongs to a specific agent and a specific (canonicalized) caller.",
        },
        {
          prompt: "Why must `canonicalizeCallerKey` run on BOTH the read and write paths?",
          choices: [
            "For performance.",
            "So format drift (+ prefix, trunk 0, from vs to number) doesn't store under one key and look up under another — which silently misses memory.",
            "Because Drizzle requires it.",
            "To encrypt the phone number.",
          ],
          correctIndex: 1,
          explanation:
            "If write and read canonicalize differently (or one skips it), the same caller maps to different keys and stored memory is never found — the agent greets a regular as a stranger.",
        },
        {
          prompt: "How does `caller_facts` handle an updated fact?",
          choices: [
            "It UPDATEs the existing row in place.",
            "It deletes the old row.",
            "It inserts a new row and sets the old row's `superseded_by_id` to the new id (append-only).",
            "It does nothing.",
          ],
          correctIndex: 2,
          explanation:
            "Facts are append-only. A new row supersedes the old via the self-referencing `superseded_by_id` FK; 'current' facts are those WHERE `superseded_by_id IS NULL`. This preserves full history and provenance.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Caller memory lets an agent recognize a returning caller by name and context.",
        "Three tables — `caller_profiles`, `caller_facts`, `caller_call_archive` — all keyed on `(agent_id, phone_number)`.",
        "Phone numbers must be run through `canonicalizeCallerKey` on BOTH read and write, or format drift silently misses stored memory.",
        "A unique composite index on `(agentId, phoneNumber)` enforces one profile per caller per agent.",
        "Facts are append-only: a new row supersedes the old via a self-referencing `superseded_by_id` FK, preserving history and provenance.",
        "Web calls use a synthetic `webcall:user_<id>` key; India defaults are tunable via `CALLER_ID_DEFAULT_CC` / `CALLER_ID_NATIONAL_LEN`.",
      ],
    },
  ],
};
