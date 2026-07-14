/**
 * migrate-call-engine-config.ts
 *
 * One-shot (or dry-run) rewrite of unsafe Call Engine keys in agents.agent_config:
 *   energy < 800 → 1200
 *   endpointing < 100 → 300
 *   words 0 / "off" → 3
 *   voiceSeconds < 0.2 → derived from words (max(0.2, words×0.15))
 *
 * The api-server also runs this automatically on boot. Use this script when you
 * want a dry-run report without restarting the server.
 *
 * Usage:
 *   DATABASE_URL=<url> npm run migrate-call-engine-config --prefix scripts
 *   DATABASE_URL=<url> npm run migrate-call-engine-config --prefix scripts -- --dry-run
 */

import { db, pool, agentsTable } from "@workspace/db";
import { normalizeCallEngineAgentConfig } from "@workspace/db/call-engine-defaults";
import { eq } from "drizzle-orm";

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const rows = await db
    .select({
      id: agentsTable.id,
      name: agentsTable.name,
      agentConfig: agentsTable.agentConfig,
    })
    .from(agentsTable);

  let updated = 0;
  for (const row of rows) {
    const raw = (row.agentConfig ?? {}) as Record<string, unknown>;
    const { changed, config, reasons } = normalizeCallEngineAgentConfig(raw);
    if (!changed) continue;

    console.log(`#${row.id} ${row.name}: ${reasons.join("; ")}`);
    if (!dryRun) {
      await db
        .update(agentsTable)
        .set({ agentConfig: config as typeof row.agentConfig, updatedAt: new Date() })
        .where(eq(agentsTable.id, row.id));
    }
    updated++;
  }

  console.log(
    dryRun
      ? `Dry-run complete. ${updated}/${rows.length} agent(s) would be updated.`
      : `Migration complete. ${updated}/${rows.length} agent(s) updated.`,
  );
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error("Migration failed:", err);
    return pool.end().finally(() => process.exit(1));
  });
