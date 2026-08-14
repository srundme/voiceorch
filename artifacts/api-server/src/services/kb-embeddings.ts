/**
 * KB embedding service — multilingual semantic vectors for knowledge_entries.
 *
 * Model: OpenAI text-embedding-3-small with dimensions=768.
 * (Sarvam has no embeddings API; Gemini embeddings were removed.)
 * Vectors are L2-normalized before storage/search so cosine ops stay stable.
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
 * - `embedBlock` circuit breaker: a provider failure that cannot resolve itself
 *   (missing key, revoked key, disabled billing, exhausted quota) would
 *   otherwise leave entries unembedded forever while the UI spins on
 *   "Indexing…". When one is detected the worker stops, the KB serves FTS-only,
 *   and the reason is exposed to the dashboard. The breaker half-opens after
 *   EMBED_BLOCK_RETRY_MS so a fixed key/billing issue self-heals.
 */
import OpenAI from "openai";
import { db, knowledgeEntriesTable, platformSettingsTable } from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";

export const KB_EMBEDDING_MODEL = "text-embedding-3-small";
export const KB_EMBEDDING_DIMS = 768;

const EMBED_QUERY_TIMEOUT_MS = Number(process.env["KB_EMBED_QUERY_TIMEOUT_MS"] ?? 1500);
const EMBED_BATCH_TIMEOUT_MS = 30_000;
const EMBED_BATCH_SIZE = 32;
/** text-embedding-3-small supports 8191 tokens — stay comfortably under it. */
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

/* ── Embed circuit breaker ───────────────────────────────────────────────── */

/** How long the breaker stays open before one retry is allowed through. */
const EMBED_BLOCK_RETRY_MS = Number(process.env["KB_EMBED_BLOCK_RETRY_MS"] ?? 30 * 60_000);
/** Consecutive non-fatal worker failures before the breaker opens. */
const EMBED_BLOCK_FAILURE_THRESHOLD = 3;

export interface KbEmbedBlock {
  /** Short, user-facing reason shown in the dashboard. */
  reason: string;
  /** Provider detail for operators (truncated). */
  detail: string | null;
  at: number;
}

let embedBlock: KbEmbedBlock | null = null;
let consecutiveFailures = 0;

class KbEmbedHttpError extends Error {
  status: number;
  detail: string;
  constructor(status: number, detail: string) {
    super(`embed_http_${status}`);
    this.status = status;
    this.detail = detail;
  }
}

function openEmbedBlock(reason: string, detail?: string): void {
  const already = embedBlock?.reason === reason;
  embedBlock = { reason, detail: detail?.slice(0, 300) ?? null, at: Date.now() };
  consecutiveFailures = 0;
  if (!already) logger.error({ reason, detail }, "KB embedding paused — knowledge base is serving keyword search only");
}

function clearEmbedBlock(): void {
  if (embedBlock) logger.info({ prevReason: embedBlock.reason }, "KB embedding recovered");
  embedBlock = null;
  consecutiveFailures = 0;
}

/** Null when embedding is healthy. Non-null means the KB is FTS-only. */
export function getKbEmbedBlock(): KbEmbedBlock | null {
  return embedBlock;
}

function embedBlocked(): boolean {
  if (!embedBlock) return false;
  if (Date.now() - embedBlock.at >= EMBED_BLOCK_RETRY_MS) {
    logger.info({ reason: embedBlock.reason }, "KB embedding breaker half-open — retrying provider");
    embedBlock = null;
    consecutiveFailures = 0;
    return false;
  }
  return true;
}

function fatalReason(err: unknown): string | null {
  if (err instanceof KbEmbedHttpError) {
    if (err.status === 401 || err.status === 403) return "Embedding API key rejected";
    if (err.status === 429) return "Embedding quota exhausted";
    if (err.status === 402) return "Embedding billing disabled";
  }
  const msg = String(err).toLowerCase();
  if (msg.includes("incorrect api key") || msg.includes("invalid_api_key")) return "Embedding API key rejected";
  if (msg.includes("insufficient_quota") || msg.includes("billing")) return "Embedding quota / billing issue";
  return null;
}

/* ── OpenAI key resolution (managed key → env fallback) ─────────────────── */

let cachedKey: { value: string | null; at: number } | null = null;

export async function getOpenAiEmbedKey(): Promise<string | null> {
  if (cachedKey && Date.now() - cachedKey.at < 5 * 60_000) return cachedKey.value;
  let key: string | null = null;
  try {
    const [row] = await db
      .select({ value: platformSettingsTable.value })
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, "managed_openai_key"));
    key = (row?.value ?? "").trim() || null;
  } catch { /* fall through to env */ }
  if (!key) key = (process.env["OPENAI_API_KEY"] ?? "").trim() || null;
  cachedKey = { value: key, at: Date.now() };
  return key;
}

/** @deprecated Gemini embeddings removed — kept as alias for any leftover imports. */
export async function getGeminiKey(): Promise<string | null> {
  return null;
}

/* ── Embedding calls ─────────────────────────────────────────────────────── */

function renormalize(values: number[]): number[] {
  let sumSq = 0;
  for (const v of values) sumSq += v * v;
  const norm = Math.sqrt(sumSq);
  if (!Number.isFinite(norm) || norm === 0) return values;
  return values.map((v) => v / norm);
}

/**
 * Batch-embed texts via OpenAI text-embedding-3-small (768-d).
 * Returns null when no key is configured; throws on API/network errors.
 */
async function callBatchEmbed(
  texts: string[],
  timeoutMs: number,
): Promise<number[][] | null> {
  const key = await getOpenAiEmbedKey();
  if (!key) return null;

  const client = new OpenAI({ apiKey: key, timeout: timeoutMs });
  try {
    const resp = await client.embeddings.create({
      model: KB_EMBEDDING_MODEL,
      input: texts,
      dimensions: KB_EMBEDDING_DIMS,
    });
    const byIndex = new Map(resp.data.map((d) => [d.index, d.embedding]));
    if (byIndex.size !== texts.length) {
      throw new Error(`OpenAI embed returned ${byIndex.size} embeddings for ${texts.length} inputs`);
    }
    return texts.map((_, i) => {
      const v = byIndex.get(i);
      if (!Array.isArray(v) || v.length !== KB_EMBEDDING_DIMS) {
        throw new Error(`OpenAI embed returned ${v?.length ?? 0} dims (expected ${KB_EMBEDDING_DIMS})`);
      }
      return renormalize(v);
    });
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (typeof status === "number") {
      throw new KbEmbedHttpError(status, String((err as Error).message ?? err).slice(0, 300));
    }
    throw err;
  }
}

/* ── Query embedding (per-turn hot path — cached, time-budgeted, non-fatal) ── */

const queryCache = new Map<string, number[]>();

const EMBED_LATENCY_WINDOW = 200;
const EMBED_STATS_LOG_EVERY = 25;
const embedLatencies: number[] = [];
let embedCount = 0;

function recordEmbedLatency(ms: number, ok: boolean): void {
  embedLatencies.push(ms);
  if (embedLatencies.length > EMBED_LATENCY_WINDOW) embedLatencies.shift();
  embedCount++;
  logger.debug({ evt: "kb_query_embed", latencyMs: ms, ok }, "KB query embed");
  if (embedCount % EMBED_STATS_LOG_EVERY === 0) {
    const sorted = [...embedLatencies].sort((a, b) => a - b);
    const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
    logger.info(
      { evt: "kb_embed_latency_stats", n: sorted.length, totalEmbeds: embedCount, p50: pct(50), p90: pct(90), p99: pct(99), max: sorted[sorted.length - 1] },
      "KB query-embed latency stats (rolling window)",
    );
  }
}

/**
 * Embed a retrieval query. Never throws — returns null on ANY failure
 * (no key, timeout, API error, latch off) so the caller falls back to FTS.
 */
export async function embedKbQuery(query: string): Promise<number[] | null> {
  if (!vectorReady) return null;
  if (embedBlocked()) return null;
  const text = query.trim().slice(0, 2000);
  if (!text) return null;
  const cacheKey = text.toLowerCase();
  const hit = queryCache.get(cacheKey);
  if (hit) {
    queryCache.delete(cacheKey);
    queryCache.set(cacheKey, hit);
    return hit;
  }

  const t0 = Date.now();
  try {
    const vecs = await callBatchEmbed([text], EMBED_QUERY_TIMEOUT_MS);
    const ms = Date.now() - t0;
    if (!vecs?.[0]) {
      recordEmbedLatency(ms, false);
      return null;
    }
    recordEmbedLatency(ms, true);
    clearEmbedBlock();
    queryCache.set(cacheKey, vecs[0]);
    if (queryCache.size > QUERY_CACHE_MAX) {
      const oldest = queryCache.keys().next().value;
      if (oldest !== undefined) queryCache.delete(oldest);
    }
    return vecs[0];
  } catch (err) {
    recordEmbedLatency(Date.now() - t0, false);
    const fatal = fatalReason(err);
    if (fatal) openEmbedBlock(fatal, err instanceof KbEmbedHttpError ? err.detail : undefined);
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
  if (embedBlocked()) return;
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
      const fatal = fatalReason(err);
      if (fatal) {
        openEmbedBlock(fatal, err instanceof KbEmbedHttpError ? err.detail : undefined);
      } else if (++consecutiveFailures >= EMBED_BLOCK_FAILURE_THRESHOLD) {
        openEmbedBlock("Embedding provider unreachable", String(err));
      } else {
        logger.warn({ err: String(err), consecutiveFailures }, "KB embed worker run failed — will retry on next kick");
      }
    } finally {
      workerRunning = false;
    }
  })();
}

/**
 * Drop vectors from a previous embedding model (e.g. gemini-embedding-001)
 * so the worker re-embeds them with the current model. Mixed spaces would
 * poison cosine search.
 */
async function invalidateStaleEmbeddings(): Promise<void> {
  try {
    const r = await db.execute(sql`
      UPDATE knowledge_entries
      SET embedding = NULL, embedding_model = NULL, embedded_at = NULL
      WHERE embedding IS NOT NULL
        AND (embedding_model IS DISTINCT FROM ${KB_EMBEDDING_MODEL})
      RETURNING id
    `);
    const n = (r as { rows?: unknown[] }).rows?.length ?? 0;
    if (n > 0) {
      logger.info({ count: n, model: KB_EMBEDDING_MODEL }, "KB: invalidated stale embeddings for model switch");
    }
  } catch (err) {
    logger.warn({ err: String(err) }, "KB stale-embedding invalidation failed");
  }
}

/* ── Startup maintenance (probe + periodic re-kick + stale-source sweep) ── */

/**
 * Called once at server startup AFTER migrations run:
 * - probes the pgvector capability latch, invalidates foreign-model vectors,
 *   then kicks the embed worker to back-fill;
 * - re-kicks every 10 min so transient provider outages self-heal;
 * - sweeps knowledge_sources stuck in a non-terminal status to "failed" after 15 min.
 */
export function startKbEmbedMaintenance(): void {
  void probeKbVectorSupport().then(async (ready) => {
    if (!ready) return;
    await invalidateStaleEmbeddings();
    kickKbEmbedWorker();
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
    const vecs = await callBatchEmbed(texts, EMBED_BATCH_TIMEOUT_MS);
    if (!vecs) {
      openEmbedBlock("No embedding API key configured");
      return;
    }
    clearEmbedBlock();

    const now = new Date();
    let updated = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
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
    await new Promise((r) => setTimeout(r, 250));
  }
}
