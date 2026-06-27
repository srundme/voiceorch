import type { Chapter } from "../types";

export const usersAndAgents: Chapter = {
  slug: "users-and-agents",
  moduleId: "m2",
  number: "2.2",
  title: "The Core Tables: Users & Agents",
  summary:
    "The two tables everything hangs off of, including the repurposed `clerk_id` Google-sub trick.",
  estMinutes: 14,
  fileRef: "lib/db/src/schema/users.ts",
  prerequisites: ["drizzle-intro"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "If SnapServe were a building, `users` and `agents` would be the foundation slab. A **user** is a person with an account, a wallet balance, and API keys. An **agent** is one of that user's AI voice configurations — its prompt, which speech-to-text vendor to use, which voice, which phone provider. Almost every other table in the database points back to one of these two.",
        "These tables hide one delightfully sneaky decision. SnapServe **used** to authenticate with a service called Clerk, so it has a column literally named `clerk_id`. The product later switched to **Google sign-in** — but instead of renaming the column (a risky migration on a live database), the team **repurposed** it to store the Google account id. The column is still called `clerk_id`; it just holds a Google `sub` now. You'll trip over this everywhere, so let's meet it head-on.",
      ],
    },
    {
      kind: "concept",
      title: "Foreign keys & ownership",
      body: [
        "A **foreign key (FK)** is a column in one table that points at a row in another. It's how a database expresses 'this belongs to that'. In Drizzle you write `.references(() => otherTable.column)`.",
        "FKs also carry a rule for what happens when the parent is deleted. `onDelete: \"cascade\"` means 'if the parent row dies, delete my row too' — so deleting a user automatically cleans up their wallet transactions. `onDelete: \"set null\"` means 'just null out my pointer' — used when the child should survive but lose its link.",
        "One quirk you'll notice: SnapServe stores ownership two different ways. Tables like `agents` keep `userId` as a plain `text` column (because it holds the Google sub string), while strict child tables like `wallet_transactions` use a real integer FK to `users.id`. Both are valid — they're just optimized for different lookups.",
      ],
    },
    {
      kind: "analogy",
      title: "clerk_id is a name tag that outlived its label",
      body: [
        "Imagine a conference where everyone got a lanyard printed 'CLERK PASS'. Halfway through, the venue switched vendors to 'Google Events' — but reprinting 2,000 lanyards mid-event would be chaos. So they kept the old 'CLERK PASS' lanyards and just wrote each attendee's **new Google ID** on them.",
        "The label says one thing; the value means another. `users.clerk_id` is that lanyard: named for the old auth system, now carrying the Google `sub`. When you read the code and see `req.clerkUserId`, mentally translate it to 'the logged-in user's Google id'.",
      ],
    },
    {
      kind: "code",
      filename: "lib/db/src/schema/users.ts",
      language: "typescript",
      intro:
        "The top of the `users` table — identity, money, and API keys all in one place.",
      code: `export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  clerkId: text("clerk_id").notNull().unique(),
  email: text("email"),
  name: text("name"),
  walletBalanceCents: integer("wallet_balance_cents").notNull().default(0),
  freeCreditsGranted: boolean("free_credits_granted").notNull().default(false),
  // …
  apiKey: text("api_key").unique(),
  orgKey: text("org_key").unique(),
  concurrentLimit: integer("concurrent_limit").notNull().default(15),
  onboardingCompleted: boolean("onboarding_completed").notNull().default(false),
  // …
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});`,
      lines: [
        {
          lines: "2",
          label: 'id: serial("id").primaryKey()',
          explanation:
            "The internal numeric id. This is the value strict child tables FK against — distinct from the Google sub. So a user actually has two identities: a numeric `id` and the Google sub in `clerk_id`.",
        },
        {
          lines: "3",
          label: 'clerkId: text("clerk_id").notNull().unique()',
          explanation:
            "The star of the chapter. Named `clerk_id` for historical reasons, it now stores the **Google `sub`** — a stable, unique string Google assigns each account. `.unique()` guarantees one row per Google account; `.notNull()` means every user must have one.",
        },
        {
          lines: "5-6",
          label: "walletBalanceCents / freeCreditsGranted",
          explanation:
            "Billing lives right on the user. Balance is integer cents (no floats!). `freeCreditsGranted` is a flag so the welcome credit is handed out exactly once.",
        },
        {
          lines: "8-9",
          label: "apiKey / orgKey",
          explanation:
            "Programmatic access keys, both `.unique()`. These let a user call SnapServe's own API from their code, independent of the Google-login session JWT.",
        },
        {
          lines: "10",
          label: "concurrentLimit: integer(…).default(15)",
          explanation:
            "A per-user cap on simultaneous live calls. Defaulting to 15 keeps a single account from monopolising the orchestration engine.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "clerk_id holds a Google sub — don't be fooled by the name",
      body: [
        "Straight from replit.md: the session token is an HS256 JWT signed with `SESSION_SECRET`, carrying the Google `sub` + email + name. The `attachSession` middleware validates it and sets `req.clerkUserId` (**= the Google sub**). And: 'the `users.clerk_id` column is **repurposed** to store the Google `sub` (not renamed)'.",
        "So three names all mean the same thing: the SQL column `clerk_id`, the request field `req.clerkUserId`, and 'the Google sub'. First-time users are auto-provisioned with email/name/API keys plus a $5 welcome credit (`userProvisioning.ts`).",
      ],
    },
    {
      kind: "code",
      filename: "lib/db/src/schema/users.ts",
      language: "typescript",
      intro:
        "A user's money has history. `wallet_transactions` is a child table using a **real integer foreign key** with cascade delete.",
      code: `export const walletTransactionsTable = pgTable("wallet_transactions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  amountCents: integer("amount_cents").notNull(),
  description: text("description").notNull(),
  status: text("status").notNull().default("completed"),
  razorpayOrderId: text("razorpay_order_id").unique(),
  razorpayPaymentId: text("razorpay_payment_id").unique(),
  callId: integer("call_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});`,
      lines: [
        {
          lines: "3",
          label: "userId.references(() => usersTable.id, { onDelete: \"cascade\" })",
          explanation:
            "A genuine FK to `users.id` (the **integer**, not the clerk_id). `onDelete: \"cascade\"` means deleting a user wipes all their wallet transactions automatically — no orphaned rows left behind.",
        },
        {
          lines: "4-5",
          label: "type / amountCents",
          explanation:
            "`type` distinguishes a top-up from a debit; `amountCents` is signed integer cents. Reading these rows in order reconstructs the running balance.",
        },
        {
          lines: "8-9",
          label: "razorpayOrderId / razorpayPaymentId (.unique())",
          explanation:
            "Payment-gateway ids, both unique — a hard guarantee the same Razorpay payment can't be recorded twice (idempotency against double-charges).",
        },
      ],
    },
    {
      kind: "code",
      filename: "lib/db/src/schema/agents.ts",
      language: "typescript",
      intro:
        "Now the `agents` table — one row per AI voice configuration. Notice `userId` here is plain `text` (it holds the Google sub), and how the pipeline's whole vendor stack is just columns.",
      code: `export const agentsTable = pgTable("agents", {
  id: serial("id").primaryKey(),
  userId: text("user_id"),
  name: text("name").notNull(),
  status: text("status").notNull().default("draft"),
  asrProvider: text("asr_provider").notNull(),
  asrModel: text("asr_model"),
  llmProvider: text("llm_provider").notNull(),
  llmModel: text("llm_model"),
  ttsProvider: text("tts_provider").notNull(),
  ttsVoice: text("tts_voice"),
  telephonyProvider: text("telephony_provider").notNull(),
  systemPrompt: text("system_prompt").notNull(),
  temperature: real("temperature"),
  // …
  knowledgeBaseId: integer("knowledge_base_id").references(() => knowledgeBasesTable.id, { onDelete: "set null" }),
  // …
  agentConfig: json("agent_config").$type<AgentConfig>(),
});`,
      lines: [
        {
          lines: "3",
          label: 'userId: text("user_id")',
          explanation:
            "Ownership stored as **text**, not an integer FK — because it holds the Google sub (the same value as `users.clerk_id`). This is the looser of SnapServe's two ownership styles, chosen so lookups match the value already in the session token.",
        },
        {
          lines: "5",
          label: 'status: text("status").default("draft")',
          explanation:
            "An agent starts life as a `\"draft\"` and is promoted (e.g. to active) once configured. A plain text enum — Drizzle keeps it simple.",
        },
        {
          lines: "6-12",
          label: "the vendor stack as columns",
          explanation:
            "`asrProvider` (speech-to-text), `llmProvider` (the brain), `ttsProvider` (the voice), and `telephonyProvider` (the phone line) — the four pillars of the call pipeline are literally four `.notNull()` columns. Pick a row and you've described an entire live-call configuration.",
        },
        {
          lines: "13",
          label: 'systemPrompt: text("system_prompt").notNull()',
          explanation:
            "The agent's personality and instructions — required. This is the text fed to the LLM on every turn.",
        },
        {
          lines: "16",
          label: "knowledgeBaseId.references(…, { onDelete: \"set null\" })",
          explanation:
            "An **optional** FK to a knowledge base. Crucially `onDelete: \"set null\"` (not cascade): if the KB is deleted, the agent **survives** and just loses its KB link — you don't want to nuke an agent because a document set was removed.",
        },
        {
          lines: "18",
          label: "agentConfig: json(…).$type<AgentConfig>()",
          explanation:
            "Dozens of advanced settings (VAD tuning, voicemail handling, backchanneling, compliance flags…) live in one `json` column, typed via `.$type<AgentConfig>()` so TypeScript still checks the blob's shape. A pragmatic way to store many optional knobs without 60 extra columns.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "insight",
      title: "Two ownership styles, on purpose",
      body: [
        "`wallet_transactions.userId` is an **integer FK** to `users.id` with cascade delete — tight, relational, auto-cleaning. `agents.userId` is a **text** column holding the Google sub — looser, but it matches the value the session middleware already hands you (`req.clerkUserId`), so ownership checks are a direct string compare with no extra join.",
        "When you read a query like `where(eq(agentsTable.userId, req.clerkUserId))`, now you know why it works: both sides are the Google sub.",
      ],
    },
    {
      kind: "connections",
      title: "How it connects",
      intro:
        "Users and agents sit at the center of the data model. Click a box to explore.",
      nodes: [
        { id: "users", label: "users", sublabel: "clerk_id = Google sub — THIS CHAPTER", current: true },
        { id: "agents", label: "agents", sublabel: "userId = Google sub — THIS CHAPTER", current: true },
        { id: "wallet", label: "wallet_transactions", sublabel: "FK → users.id (cascade)", current: true },
        { id: "auth", label: "auth & middleware", sublabel: "sets req.clerkUserId", chapterSlug: "middleware-and-auth" },
        { id: "calls", label: "calls", sublabel: "FK → agents.id", chapterSlug: "calls-and-providers" },
        { id: "memory", label: "caller memory", sublabel: "keyed by agentId", chapterSlug: "caller-memory-tables" },
        { id: "drizzle", label: "Drizzle basics", sublabel: "pgTable, $inferSelect", chapterSlug: "drizzle-intro" },
        { id: "builder", label: "agent builder UI", sublabel: "writes agent rows", chapterSlug: "agent-builder" },
      ],
      edges: [
        { from: "auth", to: "users", label: "Google sub → clerk_id" },
        { from: "users", to: "agents", label: "owns (text userId)" },
        { from: "users", to: "wallet", label: "owns (FK cascade)" },
        { from: "agents", to: "calls", label: "agentId FK" },
        { from: "agents", to: "memory", label: "agentId key" },
        { from: "builder", to: "agents", label: "creates/edits" },
        { from: "drizzle", to: "users", label: "defines" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "What does the `clerk_id` column in the `users` table actually store today?",
          choices: [
            "A Clerk authentication token.",
            "The user's Google `sub` (account id) — the column was repurposed, not renamed.",
            "A random UUID.",
            "The user's password hash.",
          ],
          correctIndex: 1,
          explanation:
            "SnapServe migrated from Clerk to Google login but kept the column name. It now holds the Google `sub`, which is also what `req.clerkUserId` resolves to.",
        },
        {
          prompt: "Why is `agents.userId` a plain `text` column while `wallet_transactions.userId` is an integer FK to `users.id`?",
          choices: [
            "It's a bug.",
            "`agents.userId` holds the Google sub (matching the session token) for direct string ownership checks; wallet rows use a strict integer FK with cascade delete.",
            "Text is always faster than integers.",
            "Agents don't belong to users.",
          ],
          correctIndex: 1,
          explanation:
            "Two deliberate ownership styles: text-sub on agents matches `req.clerkUserId` with no join, while wallet transactions use a relational FK that cascades on user delete.",
        },
        {
          prompt: "The agent's `knowledgeBaseId` FK uses `onDelete: \"set null\"`. What happens if that knowledge base is deleted?",
          choices: [
            "The agent is deleted too.",
            "Nothing changes.",
            "The agent survives; its `knowledgeBaseId` is set to null, just losing the link.",
            "The delete is blocked.",
          ],
          correctIndex: 2,
          explanation:
            "`set null` keeps the child (agent) alive and only nulls the pointer — you don't want to destroy an agent because a document set was removed. Compare with `cascade` on wallet transactions.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "`users` and `agents` are the foundation tables almost everything else references.",
        "`users.clerk_id` is repurposed to hold the Google `sub`; it's the same value as `req.clerkUserId`.",
        "SnapServe uses two ownership styles: integer FKs (e.g. `wallet_transactions` → `users.id`, cascade) and text-sub columns (e.g. `agents.userId`).",
        "An `agents` row is a full call configuration: ASR + LLM + TTS + telephony providers, system prompt, plus a typed `agentConfig` JSON blob.",
        "`onDelete: \"cascade\"` cleans up children with the parent; `onDelete: \"set null\"` keeps the child and only drops the link.",
      ],
    },
  ],
};
