import { db, agentsTable } from "@workspace/db";
import { normalizeCallEngineAgentConfig } from "@workspace/db/call-engine-defaults";
import { eq } from "drizzle-orm";

export type MigrateCallEngineSummary = {
  scanned: number;
  updated: number;
  details: Array<{ id: number; name: string; reasons: string[] }>;
};

/**
 * Scan all agents and rewrite unsafe Call Engine JSON keys.
 * Idempotent — rows already at safe floors are skipped.
 */
export async function migrateCallEngineAgentConfigs(): Promise<MigrateCallEngineSummary> {
  const rows = await db
    .select({
      id: agentsTable.id,
      name: agentsTable.name,
      agentConfig: agentsTable.agentConfig,
    })
    .from(agentsTable);

  const details: MigrateCallEngineSummary["details"] = [];

  for (const row of rows) {
    const raw = (row.agentConfig ?? {}) as Record<string, unknown>;
    const { changed, config, reasons } = normalizeCallEngineAgentConfig(raw);
    if (!changed) continue;

    await db
      .update(agentsTable)
      .set({ agentConfig: config as typeof row.agentConfig, updatedAt: new Date() })
      .where(eq(agentsTable.id, row.id));

    details.push({ id: row.id, name: row.name, reasons });
  }

  return { scanned: rows.length, updated: details.length, details };
}
