/**
 * Backfill / re-classify disposition results for calls whose existing
 * `call_dispositions` row has an empty primary/sub (the classification ran but
 * the LLM output was not constrained to the taxonomy, so primary/sub came back
 * empty and `calls.disposition_result` stayed NULL → the UI showed "—").
 *
 * For each affected row that has a transcript and an agent with a configured
 * taxonomy, this re-runs the LLM classification (now schema-constrained), and
 * updates `call_dispositions.result`, `calls.disposition_result`, and the
 * matching campaign lead's business projection. Calls with genuinely no signal (no
 * transcript / no agent taxonomy / still-empty classification) are left as-is.
 *
 * Run:  pnpm --filter @workspace/api-server run backfill-dispositions
 * Env:  DATABASE_URL (required), plus a managed LLM key (managed_qwen_key /
 *       GROQ_API_KEY / managed_openai_key / managed_sarvam_key).
 */
import {
  db,
  agentDispositionsTable,
  callDispositionsTable,
  callsTable,
  campaignLeadsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  buildPrompt,
  buildSchema,
  validate,
  type DispositionConfig,
} from "../lib/disposition/index.js";
import { getDispositionLLM } from "../services/disposition-llm.js";
import { applyCampaignDispositionOutcome } from "../services/campaign-disposition-outcome.js";

function isEmpty(v: unknown): boolean {
  return v == null || (typeof v === "string" && v.trim() === "");
}

async function loadConfig(
  agentId: number,
  cache: Map<number, DispositionConfig | null>,
): Promise<DispositionConfig | null> {
  if (cache.has(agentId)) return cache.get(agentId) ?? null;
  const [row] = await db
    .select()
    .from(agentDispositionsTable)
    .where(eq(agentDispositionsTable.agentId, agentId));
  if (!row) {
    cache.set(agentId, null);
    return null;
  }
  const cfg: DispositionConfig = {
    agentId,
    taxonomy: row.taxonomy as Record<string, string[]>,
    domainFields: (row.domainFields as DispositionConfig["domainFields"]) ?? [],
    rules: (row.rules as DispositionConfig["rules"]) ?? [],
  };
  cache.set(agentId, cfg);
  return cfg;
}

async function main(): Promise<void> {
  const rows = await db.select().from(callDispositionsTable);

  const candidates = rows.filter((r) => {
    const result = (r.result ?? {}) as Record<string, unknown>;
    return isEmpty(result["primary"]) || isEmpty(result["sub"]);
  });

  console.log(
    `[backfill-dispositions] ${candidates.length} of ${rows.length} disposition rows have empty primary/sub`,
  );

  const cfgCache = new Map<number, DispositionConfig | null>();
  const llm = await getDispositionLLM();
  if (!llm) {
    console.error(
      "[backfill-dispositions] no managed LLM key available — cannot re-classify. Aborting.",
    );
    process.exit(1);
  }

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of candidates) {
    const agentId = row.agentId;
    const callId = row.callId;
    const transcript = row.transcript;

    if (agentId == null || callId == null || !transcript?.trim()) {
      skipped++;
      continue;
    }

    const cfg = await loadConfig(agentId, cfgCache);
    if (!cfg) {
      skipped++;
      continue;
    }

    try {
      const systemPrompt = buildPrompt(cfg, row.createdAt ?? null);
      const schema = buildSchema(cfg);
      const rawOut = await llm.extract(systemPrompt, schema, transcript);
      const callEvents = (row.callEvents ?? []) as Record<string, unknown>[];
      const result = validate(cfg, rawOut, callEvents as never);

      if (result.error || !result.primary || !result.sub) {
        skipped++;
        continue;
      }

      await db
        .update(callDispositionsTable)
        .set({
          result: result as unknown as Record<string, unknown>,
          needsReview: result.needsReview,
        })
        .where(eq(callDispositionsTable.id, row.id));

      const flat: Record<string, string | number | boolean> = {
        [result.primary]: result.sub,
        primary: result.primary,
        sub: result.sub,
      };
      if (typeof result.confidence === "number") flat["confidence"] = result.confidence;
      if (result.summary) flat["summary"] = result.summary;

      await db
        .update(callsTable)
        .set({ dispositionResult: flat })
        .where(eq(callsTable.id, callId));

      const [lead] = await db
        .select({ id: campaignLeadsTable.id })
        .from(campaignLeadsTable)
        .where(eq(campaignLeadsTable.callId, callId))
        .limit(1);
      const [call] = await db
        .select({ status: callsTable.status })
        .from(callsTable)
        .where(eq(callsTable.id, callId))
        .limit(1);
      if (lead) {
        await applyCampaignDispositionOutcome({
          campaignLeadId: lead.id,
          agentId,
          callId,
          dispositionResult: flat,
          callStatus: call?.status ?? "completed",
        });
      }

      updated++;
      console.log(
        `[backfill-dispositions] call ${callId}: ${result.primary} / ${result.sub} (conf ${result.confidence})`,
      );
    } catch (err) {
      failed++;
      console.error(`[backfill-dispositions] call ${callId} failed:`, err);
    }
  }

  console.log(
    `[backfill-dispositions] done — updated=${updated} skipped=${skipped} failed=${failed}`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("[backfill-dispositions] fatal:", err);
  process.exit(1);
});
