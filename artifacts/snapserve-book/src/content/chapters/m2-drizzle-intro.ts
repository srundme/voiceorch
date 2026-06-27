import type { Chapter } from "../types";

export const drizzleIntro: Chapter = {
  slug: "drizzle-intro",
  moduleId: "m2",
  number: "2.1",
  title: "Meet Drizzle: Tables as TypeScript",
  summary:
    "How SnapServe defines ~50 database tables in code, and why the schema is the single source of truth.",
  estMinutes: 12,
  fileRef: "lib/db/src/schema/",
  prerequisites: ["typescript-types"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "SnapServe stores everything in **PostgreSQL** — users, agents, calls, providers, wallet transactions, caller memory, around **50 tables** in all. But you'll almost never write raw `CREATE TABLE` SQL by hand. Instead, every table is described as a **TypeScript object** using a library called **Drizzle**.",
        "This is a big deal. Because the tables live in `.ts` files, your editor knows every column name and type. Misspell `walletBalanceCents` and TypeScript yells at you **before** the query ever runs. The schema isn't documentation that drifts out of date — it **is** the database, and it's also the types your whole backend uses. One source of truth.",
        "Everything in this module lives under `lib/db/src/schema/`. This chapter is your map of the territory: how one table is defined, how Drizzle turns it into types for free, and how all ~50 files get bundled together.",
      ],
    },
    {
      kind: "concept",
      title: "What is an ORM, and what is Drizzle?",
      body: [
        "An **ORM** (Object-Relational Mapper) is a translator between two worlds: the **rows and columns** of a SQL database, and the **objects** of your programming language. You describe your tables once, and the ORM lets you read and write them as ordinary JavaScript objects.",
        "Drizzle is a **thin** ORM. It doesn't hide SQL behind magic — it stays close to it. A table is declared with `pgTable(\"name\", { ...columns })`, where each column is a small builder like `text(\"email\")` or `integer(\"count\").notNull().default(0)`. The method chain reads almost exactly like the SQL it generates.",
        "The killer feature: from that one definition, Drizzle **derives TypeScript types automatically** with `$inferSelect` (the shape of a row you read) and `$inferInsert` (the shape you're allowed to insert). You write the table once; the types follow forever.",
      ],
    },
    {
      kind: "analogy",
      title: "The schema is a cookie cutter",
      body: [
        "Think of a `pgTable` definition as a **cookie cutter**. Its shape decides exactly what every cookie (row) looks like: which fields exist, which are required, which have defaults.",
        "`$inferSelect` is the cookie that comes **out** of the oven — fully baked, every field present (`id`, `createdAt`, everything). `$inferInsert` is the **dough** you put in — you can skip the parts the oven fills in automatically (like the auto-incrementing `id` or `createdAt`). Same cutter, two related shapes, both generated from the one definition.",
      ],
    },
    {
      kind: "code",
      filename: "lib/db/src/schema/users.ts",
      language: "typescript",
      intro:
        "Here's a real, complete table — the `users` table — so you can see the whole shape of a Drizzle definition at once.",
      code: `import { pgTable, text, serial, timestamp, integer, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  clerkId: text("clerk_id").notNull().unique(),
  email: text("email"),
  name: text("name"),
  walletBalanceCents: integer("wallet_balance_cents").notNull().default(0),
  // … more columns …
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});`,
      lines: [
        {
          lines: "1",
          label: "import { pgTable, text, serial, … }",
          explanation:
            "Every column type is a named import from `drizzle-orm/pg-core` (the PostgreSQL flavour). `pgTable` is the table builder; `text`, `serial`, `integer`, `boolean`, `timestamp`, `jsonb` are column builders that map 1:1 to real Postgres column types.",
        },
        {
          lines: "5",
          label: 'pgTable("users", { … })',
          explanation:
            'The first argument `\"users\"` is the **actual table name** in Postgres. The second argument is an object of columns. The whole thing is `export const usersTable` — a plain TypeScript value you can import anywhere.',
        },
        {
          lines: "6",
          label: 'id: serial("id").primaryKey()',
          explanation:
            "`serial` is an auto-incrementing integer — Postgres assigns the next number on each insert. `.primaryKey()` marks it as the row's unique identifier. Note the **two names**: `id` is the JavaScript property; `\"id\"` is the SQL column name. They usually match, but not always (see the next line).",
        },
        {
          lines: "7",
          label: 'clerkId: text("clerk_id").notNull().unique()',
          explanation:
            "Here the JS name (`clerkId`, camelCase) differs from the SQL name (`\"clerk_id\"`, snake_case) — a common convention. The chain `.notNull().unique()` adds a NOT NULL and a UNIQUE constraint. (We'll see why this column is special in the next chapter.)",
        },
        {
          lines: "8-9",
          label: 'email / name: text("…")',
          explanation:
            "Plain nullable text columns — no `.notNull()`, so they're allowed to be empty. Drizzle reflects this in the type: these come out as `string | null`.",
        },
        {
          lines: "10",
          label: "walletBalanceCents: integer(…).notNull().default(0)",
          explanation:
            "Money is stored as **integer cents**, never floats (floating-point math drops fractions of a rupee). `.notNull().default(0)` means: required, but if you don't supply it on insert, Postgres fills in 0.",
        },
        {
          lines: "12",
          label: "createdAt: timestamp(…).notNull().defaultNow()",
          explanation:
            "`timestamp` with `{ withTimezone: true }` stores a timezone-aware instant. `.defaultNow()` tells Postgres to stamp the current time at insert — so you never set it manually.",
        },
        {
          lines: "13",
          label: ".$onUpdate(() => new Date())",
          explanation:
            "An `updatedAt` that **auto-refreshes**: every time Drizzle UPDATEs this row, it runs this function and writes a fresh timestamp. Free 'last modified' tracking with zero query code.",
        },
      ],
    },
    {
      kind: "code",
      filename: "lib/db/src/schema/users.ts",
      language: "typescript",
      intro:
        "Now the magic at the bottom of (almost) every schema file: turning that one table into reusable types and an insert validator — no duplication.",
      code: `export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
export type WalletTransaction = typeof walletTransactionsTable.$inferSelect;`,
      lines: [
        {
          lines: "1",
          label: "createInsertSchema(usersTable).omit({ … })",
          explanation:
            "`drizzle-zod` reads the table and builds a **Zod schema** for validating incoming data. `.omit({ id, createdAt, updatedAt })` strips the fields the database fills in itself — callers shouldn't (and can't) set them. This is how routes validate request bodies before inserting.",
        },
        {
          lines: "2",
          label: "type InsertUser = z.infer<typeof insertUserSchema>",
          explanation:
            "`z.infer` extracts a TypeScript type **from** the Zod schema. So `InsertUser` is exactly the shape you're allowed to insert — the validator and the type can never disagree.",
        },
        {
          lines: "3",
          label: "type User = typeof usersTable.$inferSelect",
          explanation:
            "`$inferSelect` is Drizzle's built-in: the type of a **row you read back**, with every column present and correctly nullable. `User` is now used across the entire backend — and it was generated, not hand-written.",
        },
        {
          lines: "4",
          label: "$inferSelect on a second table",
          explanation:
            "One file can declare several tables. Each gets its own `$inferSelect` type. Here `WalletTransaction` is derived from `walletTransactionsTable` the same way.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "insight",
      title: "$inferInsert is the sibling of $inferSelect",
      body: [
        "Drizzle also exposes `typeof someTable.$inferInsert` — the type for **inserting** a row, where columns with defaults or auto-values are optional. SnapServe usually prefers the `createInsertSchema(...).omit(...)` + `z.infer` route because it gives both a **runtime validator** (Zod) and a **compile-time type** in one shot. Same idea, more safety.",
        "Rule of thumb: `$inferSelect` = what comes **out** of a `SELECT`; `$inferInsert` = what you're allowed to put **in** an `INSERT`.",
      ],
    },
    {
      kind: "code",
      filename: "lib/db/src/schema/index.ts",
      language: "typescript",
      intro:
        "With ~50 tables split across many files, how does the rest of the app import them all? A **barrel file** — `schema/index.ts` re-exports everything from one place.",
      code: `export * from "./users";
export * from "./knowledge";
export * from "./knowledge-base";
export * from "./agents";
export * from "./calls";
export * from "./providers";
// … ~40 more …
export * from "./callerProfiles";
export * from "./callerFacts";
export * from "./callerCallArchive";
export * from "./crm-connections";`,
      lines: [
        {
          lines: "1-13",
          label: 'export * from "./users" (and friends)',
          explanation:
            "Each line re-exports **everything** a schema file defines — its table, its types, its insert schema. The result: any file can `import { usersTable, type User } from \"@workspace/db\"` and reach all 50 tables through this one barrel.",
        },
        {
          lines: "1-13",
          label: "why a barrel matters here",
          explanation:
            "Drizzle's query client is created **once** with the full schema object (`drizzle(pool, { schema })`). The barrel is what makes that single `schema` import contain every table, so relations and queries across files all work together.",
        },
      ],
    },
    {
      kind: "code",
      filename: "lib/db/src/index.ts",
      language: "typescript",
      intro:
        "And here's where the schema becomes a live, queryable database connection — the `db` object the rest of SnapServe imports.",
      code: `import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 50,                          // allow up to 50 concurrent DB connections
  // …
});
export const db = drizzle(pool, { schema });`,
      lines: [
        {
          lines: "3",
          label: 'import * as schema from "./schema"',
          explanation:
            "Pulls in the entire barrel as one `schema` namespace object — all 50 tables and their relations in a single import.",
        },
        {
          lines: "7-10",
          label: "new Pool({ … })",
          explanation:
            "A **connection pool** keeps a set of reusable Postgres connections open (`max: 50`) instead of opening a fresh one per query — far faster under load.",
        },
        {
          lines: "12",
          label: "export const db = drizzle(pool, { schema })",
          explanation:
            "This is the one object the whole app imports. Passing `{ schema }` is what gives `db` full knowledge of every table — so `db.select().from(usersTable)` is fully type-checked end to end.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "tip",
      title: "JS name vs SQL name — read both",
      body: [
        "Every column has two identities: the **camelCase property** you use in TypeScript (`walletBalanceCents`) and the **snake_case string** that's the real Postgres column (`\"wallet_balance_cents\"`). When you read schema files, train your eye to see both — a query error mentioning `wallet_balance_cents` is the same field as `walletBalanceCents` in your code.",
      ],
    },
    {
      kind: "connections",
      title: "How it connects",
      intro:
        "The schema is the foundation the entire backend sits on. Click any box to jump to its chapter.",
      nodes: [
        { id: "schema", label: "schema/*.ts", sublabel: "~50 pgTable definitions — THIS CHAPTER", current: true },
        { id: "barrel", label: "schema/index.ts", sublabel: "re-exports everything", current: true },
        { id: "db", label: "db client", sublabel: "drizzle(pool, { schema })", current: true },
        { id: "users", label: "users & agents", sublabel: "core tables", chapterSlug: "users-and-agents" },
        { id: "calls", label: "calls & providers", sublabel: "call records + keys", chapterSlug: "calls-and-providers" },
        { id: "memory", label: "caller memory", sublabel: "phone-keyed tables", chapterSlug: "caller-memory-tables" },
        { id: "migrations", label: "migrations", sublabel: "shipping schema changes", chapterSlug: "migrations" },
        { id: "routes", label: "route handlers", sublabel: "validate + query", chapterSlug: "routes-anatomy" },
      ],
      edges: [
        { from: "schema", to: "barrel", label: "export *" },
        { from: "barrel", to: "db", label: "{ schema }" },
        { from: "schema", to: "users", label: "defines" },
        { from: "schema", to: "calls", label: "defines" },
        { from: "schema", to: "memory", label: "defines" },
        { from: "schema", to: "migrations", label: "diffed to SQL" },
        { from: "db", to: "routes", label: "typed queries" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "In `text(\"clerk_id\")` declared as `clerkId`, what are the two names?",
          choices: [
            "Two different columns.",
            "`clerkId` is the JavaScript property; `\"clerk_id\"` is the real Postgres column name.",
            "`clerkId` is the type; `\"clerk_id\"` is the value.",
            "They must always be identical.",
          ],
          correctIndex: 1,
          explanation:
            "Drizzle lets the camelCase JS property differ from the snake_case SQL column name. Same column, two identities — that's why query errors mention the snake_case form.",
        },
        {
          prompt: "What does `typeof usersTable.$inferSelect` give you?",
          choices: [
            "A function that runs a SELECT.",
            "The TypeScript type of a row read back from the table, generated from the definition.",
            "A Zod validation schema.",
            "The number of rows in the table.",
          ],
          correctIndex: 1,
          explanation:
            "`$inferSelect` derives the row's read type directly from the `pgTable` definition — no hand-written interface to drift out of date.",
        },
        {
          prompt: "Why does `schema/index.ts` use `export * from \"./users\"` for every table file?",
          choices: [
            "To run the tables.",
            "It's a barrel that re-exports all ~50 tables/types from one place, so the db client (and any importer) gets them in a single import.",
            "To delete old tables.",
            "Because Postgres requires it.",
          ],
          correctIndex: 1,
          explanation:
            "The barrel collapses 50 files into one import surface. `drizzle(pool, { schema })` then knows every table at once, making cross-file queries and relations type-safe.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "SnapServe's ~50 tables are defined as TypeScript with Drizzle's `pgTable(...)`, not raw SQL.",
        "Each column has a camelCase JS name and a snake_case SQL name; chains like `.notNull().default(0)` map to real constraints.",
        "`$inferSelect` derives a row's read type for free; `createInsertSchema(...).omit(...)` + `z.infer` gives a validator and an insert type together.",
        "Money is stored as integer cents, and `createdAt`/`updatedAt` are auto-managed (`defaultNow`, `$onUpdate`).",
        "`schema/index.ts` is a barrel that re-exports everything; `db = drizzle(pool, { schema })` is the one client the whole app imports.",
      ],
    },
  ],
};
