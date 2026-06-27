import type { Chapter } from "../types";

export const productionOps: Chapter = {
  slug: "production-ops",
  moduleId: "m11",
  number: "12.3",
  title: "Production Operations",
  summary:
    "How to debug live issues, read Railway logs, sync schema changes to prod, run admin scripts, and keep the platform healthy.",
  estMinutes: 16,
  fileRef: "artifacts/api-server/src/app.ts",
  prerequisites: ["railway-deployment", "secrets-and-env"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "The operational lifecycle",
      paragraphs: [
        "Building software is only half the job. Keeping it running — debugging production issues, applying schema changes safely, running backfill scripts, interpreting logs, and responding to alerts — is the other half. This chapter covers the operational patterns SnapServe uses in production.",
        "The production environment is a single Railway service running the `api-server` bundle. It connects to a Railway-provisioned PostgreSQL database via `DATABASE_URL`. All of this is observable via the Railway dashboard's log viewer.",
      ],
    },
    {
      kind: "concept",
      title: "Structured logging with Pino",
      body: [
        "SnapServe uses **Pino** for logging — a fast, structured JSON logger. Every log line is a JSON object: `{\"level\": \"info\", \"time\": 1234567890, \"msg\": \"...\", \"callId\": 42, ...}`. JSON logs are machine-parseable, enabling log aggregation tools (Datadog, Papertrail, Railway's built-in viewer) to filter and search on specific fields.",
        "The convention: **never use `console.log` in server code**. Use `req.log.info(...)` in route handlers (this Pino logger is attached to every request by the `pinoHttp` middleware) and the singleton `logger` from `lib/logger.ts` for non-request code.",
        "The log level can be changed at runtime via the `LOG_LEVEL` env var (`debug`, `info`, `warn`, `error`). In production, `info` is the default. Setting `LOG_LEVEL=debug` in Railway temporarily enables verbose logging for a specific investigation without a redeployment.",
      ],
    },
    {
      kind: "code",
      filename: "lib/logger.ts",
      language: "typescript",
      intro:
        "The singleton logger. Used in services, session, scheduler — anywhere outside a request handler.",
      code: `import pino from "pino";

export const logger = pino({
  level: process.env["LOG_LEVEL"] ?? "info",
  ...(process.env["NODE_ENV"] === "production"
    ? {} // plain JSON in production (Railway parseable)
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }
  ),
});`,
      lines: [
        {
          lines: "5-12",
          label: "pino-pretty only in dev",
          explanation:
            "`pino-pretty` reformats the JSON logs into human-readable coloured text. It's beautiful in the Replit console but terrible in Railway's log viewer (which expects JSON). The conditional ensures plain JSON in production and pretty output in dev.",
        },
      ],
    },
    {
      kind: "prose",
      heading: "Schema changes: dev → production",
      paragraphs: [
        "During development, `pnpm --filter @workspace/db run push` uses Drizzle Kit to apply schema changes directly to the dev database — it's fast and interactive. You add a column, run push, it's there.",
        "Production is different. The `api-server` runs `migrate()` from `drizzle-orm/node-postgres/migrator` at startup. It reads `lib/db/drizzle/meta/_journal.json` to determine which migration SQL files have already been applied, then applies any new ones. This is safe, idempotent, and plays well with Railway's rolling redeploy (two instances run briefly; both see the same applied-migration state in the `__drizzle_migrations` table).",
        "The critical rule: **every new table, column, or index must have a migration file**. Never use `push` against production — push drops and recreates constraints, which can cause data loss. Generate migration files with `pnpm --filter @workspace/db run generate` and check them in.",
      ],
    },
    {
      kind: "concept",
      title: "Admin scripts: the `@workspace/scripts` package",
      body: [
        "One-off production database operations (backfills, identity merges, data wipes) live in `scripts/src/`. Each script is a standalone Node.js program that connects to the database via `DATABASE_URL` and performs its operation. Scripts are run from the Railway dashboard's one-off job runner, or from a local terminal with the production `DATABASE_URL` exported.",
        "Current scripts: `backfill-user-identity` (fills in `email`/`name` from Clerk for users with NULL identity), `backfill-caller-identity` (canonicalises phone number format in caller memory tables), `merge-user-identities` (consolidates duplicate user rows from the Google migration), `wipe-beta-data` (deletes call/agent data while preserving users and wallets).",
        "Every script that mutates data has a **dry-run mode** (default) and an `--apply` flag. Always run dry-run first and verify the output before applying. This is enforced by convention — the script prints what it would do and exits without commits unless `--apply` is present.",
      ],
    },
    {
      kind: "code",
      filename: "scripts/src/backfill-caller-identity.ts",
      language: "typescript",
      intro:
        "The dry-run / apply pattern. Every admin script follows this structure.",
      code: `const args = process.argv.slice(2);
const DRY_RUN = !args.includes("--apply");

if (DRY_RUN) {
  console.log("=== DRY RUN — no changes will be made ===");
  console.log("=== Pass --apply to execute ===\\n");
}

// ... collect and print the plan ...

if (!DRY_RUN) {
  // Execute inside one transaction per group
  await db.transaction(async (tx) => {
    // ... apply changes ...
    console.log(\`Applied \${changes} changes\`);
  });
} else {
  console.log("\\nDry-run complete. Run with --apply to execute.");
}`,
      lines: [
        {
          lines: "1-2",
          label: "--apply flag",
          explanation:
            "`process.argv.slice(2)` gives the CLI arguments. `DRY_RUN` is `true` by default — you have to explicitly pass `--apply` to make changes. This is the opposite of most tools' defaults, which is intentional: safe by default.",
        },
        {
          lines: "11-15",
          label: "transaction per group",
          explanation:
            "Destructive operations (merges, canonicalisations) run inside a transaction so that if any individual update fails, the entire group is rolled back. Partial application is usually worse than a complete failure — at least you know what state you're in.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "tip",
      title: "Debugging production issues: the Railway log viewer",
      body: [
        "Railway's log viewer supports filtering by log level and field values. To see all errors: filter by `level: error`. To trace a specific call: search for the `callId`. To see all activity for a user: search their `userId`. Since every Pino log line includes structured fields, these searches are precise — you're not grepping through a wall of text.",
        "For particularly thorny production bugs, set `LOG_LEVEL=debug` in Railway variables and redeploy. Debug logs include adapter constructor arguments, session config details, and per-frame audio processing — verbose but invaluable.",
      ],
    },
    {
      kind: "callout",
      variant: "warning",
      title: "Graceful shutdown under Railway SIGTERM",
      body: [
        "Railway sends SIGTERM to the old container when deploying a new version. The server's SIGTERM handler calls `Agent.close()` on the HTTP keepalive pool (not `destroy()`) — this waits for in-flight provider REST calls to finish before closing sockets. Live calls in progress during a deploy finish their current LLM/TTS request before the pipeline tears down. Abrupt `destroy()` would cut active voice calls mid-sentence.",
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "Why should `console.log` never be used in server code?",
          choices: [
            "It's blocked by the Node.js security policy",
            "`console.log` produces unstructured output that can't be searched or filtered by field",
            "It writes synchronously and blocks the event loop",
            "Railway strips console output from logs",
          ],
          correctIndex: 1,
          explanation:
            "Structured JSON logs (Pino) can be filtered by field: `{callId: 42, level: 'error'}` vs `\"call 42 failed\"`. Unstructured console output requires grep and is much harder to search in production log aggregators.",
        },
        {
          prompt: "What's the difference between `pnpm run push` (Drizzle Kit) and `migrate()` at startup?",
          choices: [
            "`push` is for adding tables only; `migrate` handles all schema changes",
            "`push` is interactive and safe for dev; `migrate` applies versioned SQL files safely in production",
            "They do the same thing — `migrate` is just the production alias",
            "`push` uses SQLite in dev; `migrate` uses PostgreSQL in prod",
          ],
          correctIndex: 1,
          explanation:
            "`push` in Drizzle Kit introspects the current schema and applies the diff — it can drop and recreate constraints, potentially losing data. `migrate()` applies versioned SQL files in order, idempotently, and is designed for safe production schema updates.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Use Pino structured logging (`logger.info`, `req.log.info`) — never `console.log` in server code",
        "`LOG_LEVEL=debug` env var enables verbose logging without redeployment",
        "Production schema changes via migration files; never `drizzle-kit push` against prod",
        "Admin scripts live in `@workspace/scripts`, default to dry-run, require `--apply` to execute",
        "Graceful SIGTERM: `Agent.close()` (not `destroy()`) so in-flight calls finish before shutdown",
      ],
    },
  ],
};
