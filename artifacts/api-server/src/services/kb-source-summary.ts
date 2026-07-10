/**
 * Krutrim auto-summary generation for knowledge sources.
 *
 * Why: Krutrim's baked-KB cap stays at 4,000 chars (see replit.md — a probe
 * script, scripts/src/probe-krutrim-caching.ts, found NO implicit prompt-prefix
 * caching on Krutrim Cloud: identical repeated 8K-char system prompts showed
 * no `cached_tokens`/`prompt_tokens_details` signal and no reliable TTFT drop
 * across 6 back-to-back attempts on gpt-oss-20b and gemma-4-E4B-it — so,
 * unlike Gemini, a bigger baked prefix is NOT free on Krutrim). Instead, every
 * knowledge source attached to a Krutrim-provider agent gets a compressed,
 * information-dense pinned summary entry generated once (and regenerated on
 * content change) via a managed LLM, so the 4K budget still carries broad KB
 * coverage (mirrors the hand-curated Galaxy KB summary, but automatic).
 *
 * Design invariants:
 * - NEVER runs on the call path — this is a background sweep only, kicked
 *   from server startup (like the KB embed maintenance loop) and safe to run
 *   repeatedly.
 * - `knowledge_sources.krutrim_summary_hash` is the single staleness signal:
 *   a sha256 of all entry contents (sorted by id, excluding the summary entry
 *   itself). NULL or mismatched hash ⇒ (re)generate.
 *   Only recompute after a source reaches a terminal ready/partial status —
 *   never mid-ingest.
 * - The generated entry is upserted by a fixed title marker (like the Galaxy
 *   seed script) with pinned=true, so it sorts first in every full-dump
 *   injection path and survives the 4K char-cap truncation ahead of
 *   insertion-order entries.
 * - Scoped strictly to sources attached to at least one Krutrim-provider
 *   agent — other providers' baked-KB behavior is completely unchanged.
 */
import { createHash } from "node:crypto";
import {
  db,
  knowledgeEntriesTable,
  knowledgeSourcesTable,
  agentKnowledgeSourcesTable,
  agentsTable,
  platformSettingsTable,
} from "@workspace/db";
import { and, eq, ne, sql } from "drizzle-orm";
import OpenAI from "openai";
import { logger } from "../lib/logger.js";

export const KRUTRIM_AUTO_SUMMARY_TITLE = "Krutrim Auto-Summary (pinned)";

const SUMMARY_MAX_CHARS = 3500; // leaves headroom inside the 4000-char Krutrim baked cap
const SOURCE_CONTENT_FETCH_CAP = 40_000; // cap raw content fed to the summarizer prompt
const SUMMARY_MODEL = "gpt-oss-120b"; // higher-quality Krutrim model — background-only, latency doesn't matter here
const SWEEP_INTERVAL_MS = 10 * 60_000; // mirrors startKbEmbedMaintenance's cadence

let sweeping = false;
let intervalHandle: NodeJS.Timeout | null = null;

/* ── Krutrim key resolution (managed key → env fallback) ─────────────────── */

async function getKrutrimKey(): Promise<string | null> {
  try {
    const [row] = await db
      .select({ value: platformSettingsTable.value })
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, "managed_krutrim_key"));
    const v = (row?.value ?? "").trim();
    if (v) return v;
  } catch { /* fall through to env */ }
  return (process.env["KRUTRIM_CLOUD_API_KEY"] ?? "").trim() || null;
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */

function hashContents(contents: string[]): string {
  const h = createHash("sha256");
  for (const c of contents) h.update(c).update("\u0000");
  return h.digest("hex");
}

/** Source IDs attached to at least one Krutrim-provider agent. */
async function findKrutrimSourceIds(): Promise<number[]> {
  const rows = await db
    .selectDistinct({ sourceId: agentKnowledgeSourcesTable.sourceId })
    .from(agentKnowledgeSourcesTable)
    .innerJoin(agentsTable, eq(agentsTable.id, agentKnowledgeSourcesTable.agentId))
    .where(sql`lower(${agentsTable.llmProvider}) = 'krutrim'`);
  return rows.map((r) => r.sourceId);
}

async function generateSummary(sourceName: string, rawContent: string): Promise<string | null> {
  const key = await getKrutrimKey();
  if (!key) {
    logger.warn("Krutrim auto-summary: no managed/env Krutrim key available — skipping generation");
    return null;
  }
  const client = new OpenAI({ apiKey: key, baseURL: "https://cloud.olakrutrim.com/v1" });
  const prompt = `You are compressing a knowledge base into a dense factual summary for a voice AI agent's system prompt.

Source name: ${sourceName}

Source content:
"""
${rawContent}
"""

Produce a compact, information-dense summary (plain text, no markdown headers) covering every distinct topic, product, policy, number, and procedure in the content above. Prioritize concrete facts (names, prices, numbers, contact details, rules) over prose. Target ${SUMMARY_MAX_CHARS} characters or fewer. Do not add commentary, disclaimers, or a preamble — output ONLY the summary text.`;

  try {
    const completion = await client.chat.completions.create(
      {
        model: SUMMARY_MODEL,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 2000,
        temperature: 0.2,
      },
      { timeout: 60_000 },
    );
    const text = completion.choices[0]?.message?.content?.trim();
    if (!text) return null;
    return text.length > SUMMARY_MAX_CHARS ? text.slice(0, SUMMARY_MAX_CHARS) : text;
  } catch (err) {
    logger.warn({ err: String(err), sourceName }, "Krutrim auto-summary generation call failed");
    return null;
  }
}

/**
 * Regenerate the pinned auto-summary for a single source if its content hash
 * has changed since the last generation (or none exists yet).
 */
async function maybeRegenerateForSource(sourceId: number): Promise<void> {
  const [source] = await db
    .select({
      id: knowledgeSourcesTable.id,
      name: knowledgeSourcesTable.name,
      status: knowledgeSourcesTable.status,
      krutrimSummaryHash: knowledgeSourcesTable.krutrimSummaryHash,
    })
    .from(knowledgeSourcesTable)
    .where(eq(knowledgeSourcesTable.id, sourceId));
  if (!source) return;
  if (source.status !== "ready" && source.status !== "partial") return; // only terminal states

  // Every real entry EXCLUDING the auto-summary entry itself (avoid the
  // summary hashing/including its own prior output).
  const entries = await db
    .select({ id: knowledgeEntriesTable.id, content: knowledgeEntriesTable.content })
    .from(knowledgeEntriesTable)
    .where(and(
      eq(knowledgeEntriesTable.sourceId, sourceId),
      ne(knowledgeEntriesTable.title, KRUTRIM_AUTO_SUMMARY_TITLE),
    ))
    .orderBy(knowledgeEntriesTable.id);

  if (entries.length === 0) {
    // All real entries were deleted — clear any stale pinned summary + hash
    // so a Krutrim agent never keeps serving facts from deleted content.
    if (source.krutrimSummaryHash !== null) {
      await db.delete(knowledgeEntriesTable)
        .where(and(
          eq(knowledgeEntriesTable.sourceId, sourceId),
          eq(knowledgeEntriesTable.title, KRUTRIM_AUTO_SUMMARY_TITLE),
        ));
      await db.update(knowledgeSourcesTable)
        .set({ krutrimSummaryHash: null })
        .where(eq(knowledgeSourcesTable.id, sourceId));
      logger.info({ sourceId, sourceName: source.name }, "Krutrim auto-summary cleared (source has no real entries left)");
    }
    return;
  }

  const currentHash = hashContents(entries.map((e) => e.content));
  if (currentHash === source.krutrimSummaryHash) return; // up to date

  const rawContent = entries.map((e) => e.content).join("\n\n").slice(0, SOURCE_CONTENT_FETCH_CAP);
  const summary = await generateSummary(source.name, rawContent);
  if (!summary) return; // leave hash unset — retried next sweep

  const existingRows = await db
    .select({ id: knowledgeEntriesTable.id })
    .from(knowledgeEntriesTable)
    .where(and(
      eq(knowledgeEntriesTable.sourceId, sourceId),
      eq(knowledgeEntriesTable.title, KRUTRIM_AUTO_SUMMARY_TITLE),
    ));

  if (existingRows[0]) {
    await db.update(knowledgeEntriesTable)
      .set({ content: summary, pinned: true, embedding: null, embeddingModel: null, embeddedAt: null })
      .where(eq(knowledgeEntriesTable.id, existingRows[0].id));
  } else {
    const [ownerRow] = await db
      .select({ userId: knowledgeSourcesTable.userId })
      .from(knowledgeSourcesTable)
      .where(eq(knowledgeSourcesTable.id, sourceId));
    await db.insert(knowledgeEntriesTable).values({
      sourceId,
      userId: ownerRow?.userId ?? "",
      title: KRUTRIM_AUTO_SUMMARY_TITLE,
      content: summary,
      pinned: true,
    });
    await db.update(knowledgeSourcesTable)
      .set({ entryCount: sql`${knowledgeSourcesTable.entryCount} + 1` })
      .where(eq(knowledgeSourcesTable.id, sourceId));
  }

  await db.update(knowledgeSourcesTable)
    .set({ krutrimSummaryHash: currentHash })
    .where(eq(knowledgeSourcesTable.id, sourceId));

  logger.info({ sourceId, sourceName: source.name, summaryChars: summary.length }, "Krutrim auto-summary regenerated");
}

/**
 * One sweep pass: find every knowledge source attached to a Krutrim agent and
 * regenerate its pinned summary if stale. Serialized (skips overlap) and
 * fully isolated per-source — one failure never blocks the rest.
 */
export async function sweepKrutrimSourceSummaries(): Promise<void> {
  if (sweeping) return;
  sweeping = true;
  try {
    const sourceIds = await findKrutrimSourceIds();
    for (const sourceId of sourceIds) {
      try {
        await maybeRegenerateForSource(sourceId);
      } catch (err) {
        logger.warn({ err: String(err), sourceId }, "Krutrim auto-summary sweep failed for source");
      }
    }
  } catch (err) {
    logger.warn({ err: String(err) }, "Krutrim auto-summary sweep failed");
  } finally {
    sweeping = false;
  }
}

/** Fire-and-forget kick — safe to call from any ingestion completion path. */
export function kickKrutrimSummaryWorker(): void {
  void sweepKrutrimSourceSummaries();
}

/** Called once at server startup: initial kick + periodic re-sweep. */
export function startKrutrimSummaryMaintenance(): void {
  kickKrutrimSummaryWorker();
  if (intervalHandle) clearInterval(intervalHandle);
  intervalHandle = setInterval(() => kickKrutrimSummaryWorker(), SWEEP_INTERVAL_MS);
  intervalHandle.unref?.();
}
