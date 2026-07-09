/**
 * KB embedding service — multilingual semantic vectors for knowledge_entries.
 *
 * Model: gemini-embedding-001 with outputDimensionality=768 (MRL truncation).
 * Truncated MRL vectors are NOT unit-norm, so every vector is re-normalized
 * before storage/search (cosine ops assume comparable norms).
 *
 * Design invariants:
 * - `vectorReady` capability latch: probed once at startup. When the DB lacks
 *   the pgvector extension / embedding column (e.g. self-hosted
 *   postgres:16-alpine where migration 0045 soft-failed), EVERY function here
 *   no-ops and KB retrieval stays FTS-only — the absolute fallback guarantee.
 * - embedding=NULL is the single "needs embedding" signal. All content write
 *   paths reset embedding to NULL; ONE central worker (kickKbEmbedWorker)
 *   back-fills NULL rows. No per-path embedding hooks.
 * - The worker's UPDATE is guarded on `embedding IS NULL AND content = <embedded
 *   content>` so a concurrent content edit can never be overwritten by a stale
 *   vector.
 */
import { db, knowledgeEntriesTable, platformSettingsTable } from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";

export const KB_EMBEDDING_MODEL = "gemini-embedding-001";
export const KB_EMBEDDING_DIMS = 768;

const EMBED_QUERY_TIMEOUT_MS = Number(process.env["KB_EMBED_QUERY_TIMEOUT_MS"] ?? 1500);
const EMBED_BATCH_TIMEOUT_MS = 30_000;
const EMBED_BATCH_SIZE = 32;
/** gemini-embedding-001 input cap is 2048 tokens — stay comfortably under it. */
const EMBED_DOC_MAX_CHARS = 6000;
const QUERY_CACHE_MAX = 300;

/* ── Capability latch ────────────────────────────────────────────────────── */

let vectorReady = false;

export function isKbVectorReady(): boolean {
  return vectorReady;
}

/**
 * Probe whether the embedding column actually exists (pgvector available AND
 * migration applied). Called once at startup after migrations run.
 */
export async function probeKbVectorSupport(): Promise<boolean> {
  try {
    const r = await db.execute(sql`
      SELECT 1 AS ok FROM information_schema.columns
      WHERE table_name = 'knowledge_entries' AND column_name = 'embedding'
    `);
    vectorReady = ((r as { rows?: unknown[] }).rows?.length ?? 0) > 0;
  } catch (err) {
    vectorReady = false;
    logger.warn({ err }, "KB vector capability probe failed — vector retrieval disabled");
  }
  logger.info({ vectorReady }, "KB vector capability probe complete");
  return vectorReady;
}

/* ── Gemini key resolution (managed key → env fallback) ─────────────────── */

let cachedKey: { value: string | null; at: number } | null = null;

export async function getGeminiKey(): Promise<string | null> {
  if (cachedKey && Date.now() - cachedKey.at < 5 * 60_000) return cachedKey.value;
  let key: string | null = null;
  try {
    const [row] = await db
      .select({ value: platformSettingsTable.value })
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, "managed_gemini_key"));
    key = (row?.value ?? "").trim() || null;
  } catch { /* fall through to env */ }
  if (!key) key = (process.env["GEMINI_API_KEY"] ?? "").trim() || null;
  cachedKey = { value: key, at: Date.now() };
  return key;
}

/* ── Embedding calls ─────────────────────────────────────────────────────── */

function renormalize(values: number[]): number[] {
  let sumSq = 0;
  for (const v of values) sumSq += v * v;
  const norm = Math.sqrt(sumSq);
  if (!Number.isFinite(norm) || norm === 0) return values;
  return values.map((v) => v / norm);
}

type EmbedTaskType = "RETRIEVAL_QUERY" | "RETRIEVAL_DOCUMENT";

/**
 * Batch-embed texts via gemini-embedding-001. Returns null when no key is
 * configured; throws on API/network errors (caller decides fallback).
 */
async function callBatchEmbed(
  texts: string[],
  taskType: EmbedTaskType,
  timeoutMs: number,
): Promise<number[][] | null> {
  const key = await getGeminiKey();
  if (!key) return null;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${KB_EMBEDDING_MODEL}:batchEmbedContents`;
  const body = {
    requests: texts.map((t) => ({
      model: `models/${KB_EMBEDDING_MODEL}`,
      content: { parts: [{ text: t }] },
      taskType,
      outputDimensionality: KB_EMBEDDING_DIMS,
    })),
  };
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!resp.ok) {
    const detail = (await resp.text().catch(() => "")).slice(0, 300);
    throw new Error(`Gemini embed HTTP ${resp.status}: ${detail}`);
  }
  const json = (await resp.json()) as { embeddings?: Array<{ values?: number[] }> };
  const embs = json.embeddings;
  if (!Array.isArray(embs) || embs.length !== texts.length) {
    throw new Error(`Gemini embed returned ${embs?.length ?? 0} embeddings for ${texts.length} inputs`);
  }
  return embs.map((e) => {
    const v = e.values;
    if (!Array.isArray(v) || v.length !== KB_EMBEDDING_DIMS) {
      throw new Error(`Gemini embed returned ${v?.length ?? 0} dims (expected ${KB_EMBEDDING_DIMS})`);
    }
    return renormalize(v);
  });
}

/* ── Query embedding (per-turn hot path — cached, time-budgeted, non-fatal) ── */

const queryCache = new Map<string, number[]>();

/**
 * Embed a retrieval query. Never throws — returns null on ANY failure
 * (no key, timeout, API error, latch off) so the caller falls back to FTS.
 */
export async function embedKbQuery(query: string): Promise<number[] | null> {
  if (!vectorReady) return null;
  const text = query.trim().slice(0, 2000);
  if (!text) return null;
  const cacheKey = text.toLowerCase();
  const hit = queryCache.get(cacheKey);
  if (hit) {
    // refresh LRU position
    queryCache.delete(cacheKey);
    queryCache.set(cacheKey, hit);
    return hit;
  }
  try {
    const vecs = await callBatchEmbed([text], "RETRIEVAL_QUERY", EMBED_QUERY_TIMEOUT_MS);
    const vec = vecs?.[0];
    if (!vec) return null;
    queryCache.set(cacheKey, vec);
    if (queryCache.size > QUERY_CACHE_MAX) {
      const oldest = queryCache.keys().next().value;
      if (oldest !== undefined) queryCache.delete(oldest);
    }
    return vec;
  } catch (err) {
    logger.warn({ err: String(err) }, "KB query embedding failed — falling back to FTS");
    return null;
  }
}

/* ── Central embed worker (back-fills embedding IS NULL rows) ────────────── */

function buildEmbedText(row: { title: string | null; content: string; keywords: string | null }): string {
  const parts: string[] = [];
  if (row.title) parts.push(row.title);
  parts.push(row.content);
  if (row.keywords) parts.push(`Keywords: ${row.keywords}`);
  return parts.join("\n").slice(0, EMBED_DOC_MAX_CHARS);
}

let workerRunning = false;
let workerRerun = false;

/**
 * Kick the singleton embed worker. Safe to call from any write path —
 * serialized (one in-flight run), re-runs once more if kicked mid-run,
 * no-ops when the vector latch is off. Errors stop the current run (next
 * kick or the periodic re-kick retries); they never propagate to callers.
 */
export function kickKbEmbedWorker(): void {
  if (!vectorReady) return;
  if (workerRunning) {
    workerRerun = true;
    return;
  }
  workerRunning = true;
  void (async () => {
    try {
      do {
        workerRerun = false;
        await embedMissingEntries();
      } while (workerRerun);
    } catch (err) {
      logger.warn({ err: String(err) }, "KB embed worker run failed — will retry on next kick");
    } finally {
      workerRunning = false;
    }
  })();
}

/* ── Startup maintenance (probe + periodic re-kick + stale-source sweep) ── */

/**
 * Called once at server startup AFTER migrations run:
 * - probes the pgvector capability latch, then kicks the embed worker to
 *   back-fill any rows left unembedded (e.g. pre-existing KBs, crashed runs);
 * - re-kicks every 10 min so transient Gemini outages self-heal;
 * - sweeps knowledge_sources stuck in a non-terminal status (e.g. an async
 *   PDF ingest orphaned by a server restart) to "failed" after 15 min.
 */
export function startKbEmbedMaintenance(): void {
  void probeKbVectorSupport().then((ready) => {
    if (ready) kickKbEmbedWorker();
  });
  const rekick = setInterval(() => {
    if (vectorReady) kickKbEmbedWorker();
  }, 10 * 60_000);
  rekick.unref();

  const sweep = setInterval(() => void sweepStaleKbSources(), 15 * 60_000);
  sweep.unref();
  void sweepStaleKbSources();
}

async function sweepStaleKbSources(): Promise<void> {
  try {
    const r = await db.execute(sql`
      UPDATE knowledge_sources
      SET status = 'failed', updated_at = NOW()
      WHERE status IN ('processing', 'crawling', 'validating')
        AND updated_at < NOW() - INTERVAL '15 minutes'
      RETURNING id
    `);
    const n = (r as { rows?: unknown[] }).rows?.length ?? 0;
    if (n > 0) logger.warn({ count: n }, "KB stale-source sweep: marked stuck sources failed");
  } catch (err) {
    logger.warn({ err: String(err) }, "KB stale-source sweep failed");
  }
}

async function embedMissingEntries(): Promise<void> {
  for (;;) {
    const rows = await db
      .select({
        id: knowledgeEntriesTable.id,
        title: knowledgeEntriesTable.title,
        content: knowledgeEntriesTable.content,
        keywords: knowledgeEntriesTable.keywords,
      })
      .from(knowledgeEntriesTable)
      .where(isNull(knowledgeEntriesTable.embedding))
      .orderBy(knowledgeEntriesTable.id)
      .limit(EMBED_BATCH_SIZE);
    if (!rows.length) return;

    const texts = rows.map((r) => buildEmbedText(r));
    const vecs = await callBatchEmbed(texts, "RETRIEVAL_DOCUMENT", EMBED_BATCH_TIMEOUT_MS);
    if (!vecs) {
      logger.warn("KB embed worker: no Gemini key configured — entries stay unembedded (FTS-only)");
      return;
    }

    const now = new Date();
    let updated = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      // Guard against a concurrent content edit: only fill the vector if the
      // row is still unembedded AND the content is still what we embedded.
      const res = await db
        .update(knowledgeEntriesTable)
        .set({ embedding: vecs[i]!, embeddingModel: KB_EMBEDDING_MODEL, embeddedAt: now })
        .where(and(
          eq(knowledgeEntriesTable.id, row.id),
          isNull(knowledgeEntriesTable.embedding),
          eq(knowledgeEntriesTable.content, row.content),
        ))
        .returning({ id: knowledgeEntriesTable.id });
      if (res.length) updated++;
    }
    logger.info({ batch: rows.length, updated }, "KB embed worker: batch embedded");

    if (rows.length < EMBED_BATCH_SIZE) return;
    await new Promise((r) => setTimeout(r, 250)); // gentle pacing between batches
  }
}
