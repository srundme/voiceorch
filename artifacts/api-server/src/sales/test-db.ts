import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import * as schema from "@workspace/db/schema";
import type { SalesDb } from "./db.js";

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../lib/db/drizzle");
const MIGRATION_FILES = ["0127_sales_pipeline.sql", "0128_sales_pipeline_2.sql", "0129_sales_pipeline_3.sql"];

const RESETTABLE_TABLES = [
  "sales_touchpoints",
  "sales_audit",
  "sales_imports",
  "sales_webhook_events",
  "sales_expenses",
  "sales_payment_adjustments",
  "sales_payments",
  "sales_subscriptions",
  "sales_proposals",
  "sales_pilot_snapshots",
  "sales_pilots",
  "sales_tasks",
  "sales_activities",
  "sales_stage_history",
  "sales_opportunities",
  "sales_contacts",
  "sales_companies",
  "sales_settings",
  "sales_sessions",
  "sales_invites",
  "sales_users",
];

export interface SalesTestDb {
  db: SalesDb;
  driver: "pglite" | "postgres";
  exec(sqlText: string): Promise<void>;
  reset(): Promise<void>;
  close(): Promise<void>;
}

export function salesMigrationStatements(): string[] {
  return MIGRATION_FILES.flatMap((file) =>
    readFileSync(resolve(MIGRATIONS_DIR, file), "utf8")
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

function withReset(base: Omit<SalesTestDb, "reset">): SalesTestDb {
  return {
    ...base,
    reset: () => base.exec(`TRUNCATE ${RESETTABLE_TABLES.join(", ")} RESTART IDENTITY CASCADE`),
  };
}

async function createPostgresDb(url: string): Promise<SalesTestDb> {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const end = (client: unknown) => (client as { end(): Promise<void> }).end();
  const schemaName = `sales_test_${process.pid}_${Date.now()}`;
  const admin = drizzle({ connection: { connectionString: url, max: 1 } });
  await admin.execute(sql.raw(`CREATE SCHEMA "${schemaName}"`));
  await end(admin.$client);
  const db = drizzle({
    connection: { connectionString: url, max: 4, options: `-c search_path=${schemaName} -c timezone=UTC` },
    schema,
  });
  for (const statement of salesMigrationStatements()) await db.execute(sql.raw(statement));
  return withReset({
    db: db as unknown as SalesDb,
    driver: "postgres",
    exec: async (sqlText) => {
      await db.execute(sql.raw(sqlText));
    },
    close: async () => {
      await db.execute(sql.raw(`DROP SCHEMA "${schemaName}" CASCADE`));
      await end(db.$client);
    },
  });
}

async function createPgliteDb(): Promise<SalesTestDb> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const client = new PGlite();
  await client.exec("SET TIME ZONE 'UTC'");
  for (const statement of salesMigrationStatements()) await client.exec(statement);
  return withReset({
    db: drizzle(client, { schema }) as unknown as SalesDb,
    driver: "pglite",
    exec: async (sqlText) => {
      await client.exec(sqlText);
    },
    close: () => client.close(),
  });
}

export async function tryCreateSalesTestDb(): Promise<SalesTestDb | null> {
  const url = process.env["SALES_TEST_DATABASE_URL"];
  try {
    return url ? await createPostgresDb(url) : await createPgliteDb();
  } catch (err) {
    console.warn(
      `[sales tests] skipping DB-backed tests: could not start ${url ? "SALES_TEST_DATABASE_URL postgres" : "PGlite"} (${err instanceof Error ? err.message : String(err)})`,
    );
    return null;
  }
}
