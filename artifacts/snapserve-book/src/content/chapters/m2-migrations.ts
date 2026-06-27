import type { Chapter } from "../types";

export const migrations: Chapter = {
  slug: "migrations",
  moduleId: "m2",
  number: "2.5",
  title: "Migrations: Changing the Schema Safely",
  summary:
    "How schema changes reach the database in dev and in production without losing data.",
  estMinutes: 12,
  prerequisites: ["drizzle-intro"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "You've defined ~50 tables as TypeScript. But the actual PostgreSQL database doesn't read your `.ts` files — it only understands SQL. So how does a change you make in `schema/agents.ts` (say, adding a new column) actually reach the live database? That's the job of **migrations**.",
        "This matters more than it sounds. In development you want speed: change the schema, see it instantly. In production you want **safety**: the database is full of real customer data, and a careless change could drop a column full of records or lock the table mid-business-hours. SnapServe uses **two different tools** for these two situations — and this chapter explains exactly when each one is used.",
      ],
    },
    {
      kind: "concept",
      title: "Two strategies: push vs versioned migrations",
      body: [
        "**`drizzle-kit push`** (dev): Drizzle compares your TypeScript schema to the live database and immediately runs whatever SQL is needed to make them match. No files, no history — just 'make the DB look like the code, now.' Fast and frictionless for local iteration, but it can be destructive (it might drop a column to match) and it leaves no audit trail.",
        "**Versioned SQL migrations** (prod): each schema change is captured as a numbered `.sql` file in `lib/db/drizzle/` (e.g. `0024_connections_hub.sql`). These files are committed to git, applied in order, and recorded in a journal table so each one runs **exactly once**. This is the safe, reviewable, repeatable path for production.",
        "The mental model: `push` is for the messy workshop where you're still sketching; numbered migration files are the signed, dated blueprints you hand to the construction crew building the real thing.",
      ],
    },
    {
      kind: "analogy",
      title: "Push is a whiteboard; migrations are a ledger",
      body: [
        "Imagine designing a room. On a **whiteboard** you erase and redraw freely — that's `drizzle-kit push`: instant, disposable, no record of what changed. Perfect while you're still figuring things out.",
        "But to actually build, you keep a **ledger**: 'Change #24: add a window here.' Each entry is numbered, dated, reviewed, and once it's done you tick it off so nobody builds the same window twice. That ledger is `lib/db/drizzle/` — a folder of ordered SQL files, each applied once, each recorded in a journal.",
      ],
    },
    {
      kind: "code",
      filename: "lib/db/package.json",
      language: "json",
      intro:
        "The dev path is two npm scripts. This is what you run locally to sync the database to your schema.",
      code: `"scripts": {
  "push": "drizzle-kit push --config ./drizzle.config.ts",
  "push-force": "drizzle-kit push --force --config ./drizzle.config.ts"
},`,
      lines: [
        {
          lines: "2",
          label: "push",
          explanation:
            "Runs `drizzle-kit push` — diff the TS schema against the DB and apply the changes interactively. You run it with `pnpm --filter @workspace/db run push`. Drizzle will pause and ask before doing anything it considers risky.",
        },
        {
          lines: "3",
          label: "push-force",
          explanation:
            "The `--force` variant skips those confirmation prompts. Handy for scripted/dev resets — but the name is a warning: it won't stop to protect you, so never point it at production.",
        },
      ],
    },
    {
      kind: "code",
      filename: "lib/db/drizzle.config.ts",
      language: "typescript",
      intro:
        "Both push and the migration generator read this config — it tells drizzle-kit where the schema lives and how to reach the database.",
      code: `export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});`,
      lines: [
        {
          lines: "2",
          label: "schema: …/src/schema/index.ts",
          explanation:
            "Points drizzle-kit at the **barrel file** from Chapter 2.1. That single import is how the tool sees all ~50 tables at once when diffing.",
        },
        {
          lines: "3",
          label: 'dialect: "postgresql"',
          explanation:
            "Tells drizzle-kit to generate Postgres-flavoured SQL (vs MySQL/SQLite). The column builders you saw map to Postgres types.",
        },
        {
          lines: "4-6",
          label: "dbCredentials.url = process.env.DATABASE_URL",
          explanation:
            "The connection string comes from an environment variable — never hard-coded. This is the same `DATABASE_URL` the runtime `db` client uses.",
        },
      ],
    },
    {
      kind: "code",
      filename: "lib/db/drizzle/0024_connections_hub.sql",
      language: "sql",
      intro:
        "Now a REAL production migration. The golden rule here is idempotency — `IF NOT EXISTS` so re-running it can never break.",
      code: `-- Connections Hub: HMAC secret + webhook status tracking on campaigns,
-- and Meta app-secret support for signature verification.

ALTER TABLE "campaigns"
  ADD COLUMN IF NOT EXISTS "hmac_secret" text,
  ADD COLUMN IF NOT EXISTS "last_webhook_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "last_webhook_status" text;
--> statement-breakpoint
ALTER TABLE "meta_integrations"
  ADD COLUMN IF NOT EXISTS "app_secret_encrypted" text;`,
      lines: [
        {
          lines: "1-2",
          label: "the header comment",
          explanation:
            "Migrations are reviewed by humans, so a plain-English summary of intent goes up top. This one adds three campaign columns plus a Meta app-secret column.",
        },
        {
          lines: "4-7",
          label: 'ADD COLUMN IF NOT EXISTS …',
          explanation:
            "The idempotency convention. `IF NOT EXISTS` means: if the column is already there (because the migration ran before, or `push` added it in dev), do nothing instead of erroring. Re-running the migration is always safe.",
        },
        {
          lines: "6",
          label: '"last_webhook_at" timestamp with time zone',
          explanation:
            "This is the raw SQL form of the same `timestamp({ withTimezone: true })` you write in Drizzle. Reading migrations is a great way to see what your TypeScript actually compiles to.",
        },
        {
          lines: "8",
          label: "--> statement-breakpoint",
          explanation:
            "A Drizzle marker that splits the file into separate statements. The migrator runs each chunk independently, so one big file can contain several distinct `ALTER`/`CREATE` operations.",
        },
      ],
    },
    {
      kind: "code",
      filename: "lib/db/drizzle/0025_crm_connections.sql",
      language: "sql",
      intro:
        "Creating a whole new table follows the same idempotency rule — `CREATE TABLE IF NOT EXISTS`.",
      code: `CREATE TABLE IF NOT EXISTS "crm_connections" (
  "id"               serial PRIMARY KEY NOT NULL,
  "user_id"          text NOT NULL,
  "provider"         text NOT NULL,
  "account_id"       text NOT NULL,
  "encrypted_tokens" text NOT NULL,
  "field_mapping"    jsonb DEFAULT '{}'::jsonb,
  "last_sync_at"     timestamp,
  "created_at"       timestamp DEFAULT now() NOT NULL,
  "updated_at"       timestamp DEFAULT now() NOT NULL
);`,
      lines: [
        {
          lines: "1",
          label: "CREATE TABLE IF NOT EXISTS",
          explanation:
            "Same safety net at the table level — if `crm_connections` already exists, this is a no-op instead of a crash. Every SnapServe migration leans on this so deploys are re-runnable.",
        },
        {
          lines: "2",
          label: '"id" serial PRIMARY KEY NOT NULL',
          explanation:
            "The SQL behind `serial(\"id\").primaryKey()`. Compare this to the Drizzle column you'd write — the migration is just the compiled output.",
        },
        {
          lines: "6",
          label: '"encrypted_tokens" text NOT NULL',
          explanation:
            "Note the name: like provider API keys, OAuth tokens are stored already-encrypted (Chapter 2.3's pattern). The column is plain `text` holding ciphertext.",
        },
        {
          lines: "7",
          label: "\"field_mapping\" jsonb DEFAULT '{}'::jsonb",
          explanation:
            "A `jsonb` column with an empty-object default. `::jsonb` is a Postgres cast. This mirrors a Drizzle `jsonb(...)` column with a default.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "If a prod migration is missing, the INSERT fails",
      body: [
        "Real example from replit.md: admin impersonation requires migration `0012`. `POST /api/admin/impersonate/:clerkId` writes `exchange_code` and `exchange_code_expires_at` in its INSERT. If `0012_impersonation_exchange_code` hasn't been applied to the production database, the INSERT fails with an **unknown column error**.",
        "The fix: run `pnpm --filter @workspace/db run push` (dev) or apply the migration SQL on prod **before** using the feature. Code and schema must ship together — a feature is only as deployed as its migration.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/api-server/src/index.ts",
      language: "typescript",
      intro:
        "In production, migrations don't run from your laptop — the server applies them itself at boot, in the background, right after binding the port.",
      code: `server.listen(port, () => {
  logger.info({ port }, "Server listening");
  // …
  const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "../../../lib/db/drizzle");
  bootstrapMigrationJournal()
    .then(() => migrate(db, { migrationsFolder }))
    .then(() => {
      logger.info({ migrationsFolder }, "DB migrations applied");
      // … start background workers …
    })
    .catch((err: unknown) => {
      // Log but do NOT exit — keeps the process alive so Railway's healthcheck
      // passes and we can inspect the error in the Console tab.
    });
});`,
      lines: [
        {
          lines: "4",
          label: "migrationsFolder = …/lib/db/drizzle",
          explanation:
            "The same folder of numbered `.sql` files you just saw. The running server reads them at startup, so a deploy automatically brings the schema up to date.",
        },
        {
          lines: "5-6",
          label: "bootstrapMigrationJournal().then(() => migrate(db, …))",
          explanation:
            "First seed the migration **journal** (a record of which migrations already ran), then call `migrate()`, which applies only the files NOT yet in the journal — each migration runs exactly once, in order.",
        },
        {
          lines: "5-6",
          label: "why a journal?",
          explanation:
            "Some production DBs were first created with `push` (no history). `bootstrapMigrationJournal` marks known historical migrations as 'already applied' so `migrate()` doesn't try to re-create tables that exist — and the `IF NOT EXISTS` convention is the backstop if it ever does.",
        },
        {
          lines: "11-14",
          label: "the .catch that does NOT exit",
          explanation:
            "If a migration fails, the server deliberately stays up (logs the error) so the health-check passes and you can diagnose it — rather than crash-looping a whole deployment over one bad statement.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "tip",
      title: "Read migrations to learn the schema's history",
      body: [
        "The `lib/db/drizzle/` folder is a time-lapse of the database. Files like `0006_add_recording_error.sql` or `0018_caller_preferred_language.sql` tell you exactly when and why each column appeared. When you're confused about a column, `git log` and the migration that added it are often the fastest explanation.",
      ],
    },
    {
      kind: "connections",
      title: "How it connects",
      intro:
        "Migrations are the bridge from your TypeScript schema to the live Postgres database. Click to explore.",
      nodes: [
        { id: "schema", label: "schema/*.ts", sublabel: "the source of truth", chapterSlug: "drizzle-intro" },
        { id: "push", label: "drizzle-kit push", sublabel: "dev: instant sync — THIS CHAPTER", current: true },
        { id: "sql", label: "lib/db/drizzle/*.sql", sublabel: "prod: versioned migrations — THIS CHAPTER", current: true },
        { id: "journal", label: "migration journal", sublabel: "runs each once — THIS CHAPTER", current: true },
        { id: "bootstrap", label: "server bootstrap", sublabel: "migrate() at startup", chapterSlug: "server-bootstrap" },
        { id: "db", label: "PostgreSQL", sublabel: "the live database" },
      ],
      edges: [
        { from: "schema", to: "push", label: "diff & apply (dev)" },
        { from: "schema", to: "sql", label: "generate .sql (prod)" },
        { from: "push", to: "db", label: "instant changes" },
        { from: "sql", to: "journal", label: "tracked by" },
        { from: "bootstrap", to: "journal", label: "seed then migrate()" },
        { from: "journal", to: "db", label: "apply pending, once each" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "When is `drizzle-kit push` the right tool, and when are versioned SQL migrations?",
          choices: [
            "Push for production, migrations for dev.",
            "Push for fast local dev iteration; numbered SQL migrations for safe, reviewable, repeatable production changes.",
            "They're identical.",
            "Push for adding columns, migrations for deleting them.",
          ],
          correctIndex: 1,
          explanation:
            "`push` diffs and applies instantly (great in dev, potentially destructive). Versioned `.sql` files in `lib/db/drizzle/` are committed, ordered, journaled, and run once — the production-safe path.",
        },
        {
          prompt: "Why do SnapServe's migrations use `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS`?",
          choices: [
            "To make them shorter.",
            "Idempotency — re-running a migration (or running it on a DB where push already made the change) is a safe no-op instead of an error.",
            "It's required by SQL.",
            "To speed up queries.",
          ],
          correctIndex: 1,
          explanation:
            "`IF NOT EXISTS` makes migrations re-runnable: if the change is already present, nothing happens. This is the backstop for DBs bootstrapped with `push` and for repeated deploys.",
        },
        {
          prompt: "In production, how do pending migrations get applied?",
          choices: [
            "A developer runs them by hand every deploy.",
            "The server applies them at startup via `migrate(db, { migrationsFolder })`, after seeding the journal so each runs exactly once.",
            "Postgres applies them automatically.",
            "They never run in production.",
          ],
          correctIndex: 1,
          explanation:
            "The server runs `migrate()` in the background after binding the port. `bootstrapMigrationJournal()` first records already-applied migrations so only new ones run, each exactly once.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Migrations bridge your TypeScript schema and the actual SQL database.",
        "`drizzle-kit push` = fast dev sync (can be destructive, no history); numbered `.sql` files in `lib/db/drizzle/` = safe prod migrations.",
        "Every migration uses `IF NOT EXISTS` for idempotency — re-running it is always a safe no-op.",
        "`--> statement-breakpoint` splits a migration file into independently-run SQL statements.",
        "In production the server applies pending migrations at boot via `migrate()`, using a journal so each runs exactly once.",
        "Ship code and its migration together — a missing migration means an INSERT against a non-existent column will fail.",
      ],
    },
  ],
};
