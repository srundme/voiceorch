/**
 * KB embedding service — multilingual semantic vectors for knowledge_entries.
 *
 * Model: Jina Embeddings v3 @ 768 dims (free-tier friendly, strong multilingual /
 * Indic support). Sarvam has no embeddings API; Gemini and OpenAI are not required.
 *
 * Vectors are L2-normalized before storage/search so cosine ops stay stable.
 *
 * Design invariants:
 * - `vectorReady` capability latch: probed once at startup. When the DB lacks
 *   the pgvector extension / embedding column, EVERY function here no-ops and
 *   KB retrieval stays FTS-only.
 * - embedding=NULL is the single "needs embedding" signal.
 * - The worker's UPDATE is guarded on `embedding IS NULL AND content = <embedded
 *   content>` so a concurrent content edit can never be overwritten by a stale
 *   vector.
 * - `embedBlock` circuit breaker pauses the worker on permanent provider failures.
 */
import { db, knowledgeEntriesTable, platformSettingsTable } from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";

export const KB_EMBEDDING_MODEL = "jina-embeddings-v3";
export const KB_EMBEDDING_DIMS = 768;

const EMBED_QUERY_TIMEOUT_MS = Number(process.env["KB_EMBED_QUERY_TIMEOUT_MS"] ?? 1500);
const EMBED_BATCH_TIMEOUT_MS = 30_000;
const EMBED_BATCH_SIZE = 32;
const EMBED_BATCH_GAP_MS = 2_000;
const EMBED_RATE_LIMIT_WAIT_MS = 65_000;
const EMBED_RATE_LIMIT_RETRIES = 5;
const EMBED_DOC_MAX_CHARS = 6000;
const QUERY_CACHE_MAX = 300;
const JINA_EMBED_URL = "https://api.jina.ai/v1/embeddings";

/* ── Capability latch ────────────────────────────────────────────────────── */

let vectorReady = false;

export function isKbVectorReady(): boolean {
  return vectorReady;
}

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

const EMBED_BLOCK_RETRY_MS = Number(process.env["KB_EMBED_BLOCK_RETRY_MS"] ?? 30 * 60_000);
const EMBED_BLOCK_FAILURE_THRESHOLD = 3;

export interface KbEmbedBlock {
  reason: string;
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
    if (err.status === 402) return "Embedding billing disabled";
  }
  const msg = String(err).toLowerCase();
  if (msg.includes("incorrect api key") || msg.includes("invalid_api_key") || msg.includes("unauthorized")) {
    return "Embedding API key rejected";
  }
  if (msg.includes("insufficient_quota") || msg.includes("billing")) return "Embedding quota / billing issue";
  return null;
}

/* ── Jina key resolution (managed key → env fallback) ────────────────────── */

let cachedKey: { value: string | null; at: number } | null = null;

export async function getJinaEmbedKey(): Promise<string | null> {
  if (cachedKey && Date.now() - cachedKey.at < 5 * 60_000) return cachedKey.value;
  let key: string | null = null;
  try {
    const [row] = await db
      .select({ value: platformSettingsTable.value })
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, "managed_jina_key"));
    key = (row?.value ?? "").trim() || null;
  } catch { /* fall through to env */ }
  if (!key) key = (process.env["JINA_API_KEY"] ?? "").trim() || null;
  cachedKey = { value: key, at: Date.now() };
  return key;
}

/** @deprecated Gemini embeddings removed. */
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

type EmbedTask = "retrieval.query" | "retrieval.passage";

/**
 * Batch-embed texts via Jina Embeddings v3 (768-d).
 * Returns null when no key is configured; throws on API/network errors.
 */
async function callBatchEmbed(
  texts: string[],
  task: EmbedTask,
  timeoutMs: number,
): Promise<number[][] | null> {
  const key = await getJinaEmbedKey();
  if (!key) return null;

  const resp = await fetch(JINA_EMBED_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: KB_EMBEDDING_MODEL,
      task,
      dimensions: KB_EMBEDDING_DIMS,
      input: texts,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!resp.ok) {
    const detail = (await resp.text().catch(() => "")).slice(0, 300);
    throw new KbEmbedHttpError(resp.status, detail);
  }

  const json = (await resp.json()) as {
    data?: Array<{ index?: number; embedding?: number[] }>;
  };
  const rows = json.data;
  if (!Array.isArray(rows) || rows.length !== texts.length) {
    throw new Error(`Jina embed returned ${rows?.length ?? 0} embeddings for ${texts.length} inputs`);
  }

  const byIndex = new Map<number, number[]>();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const idx = typeof row.index === "number" ? row.index : i;
    if (!Array.isArray(row.embedding) || row.embedding.length !== KB_EMBEDDING_DIMS) {
      throw new Error(`Jina embed returned ${row.embedding?.length ?? 0} dims (expected ${KB_EMBEDDING_DIMS})`);
    }
    byIndex.set(idx, renormalize(row.embedding));
  }

  return texts.map((_, i) => {
    const v = byIndex.get(i);
    if (!v) throw new Error(`Jina embed missing index ${i}`);
    return v;
  });
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
    const vecs = await callBatchEmbed([text], "retrieval.query", EMBED_QUERY_TIMEOUT_MS);
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

/* ── Central embed worker ────────────────────────────────────────────────── */

function buildEmbedText(row: { title: string | null; content: string; keywords: string | null }): string {
  const parts: string[] = [];
  if (row.title) parts.push(row.title);
  parts.push(row.content);
  if (row.keywords) parts.push(`Keywords: ${row.keywords}`);
  return parts.join("\n").slice(0, EMBED_DOC_MAX_CHARS);
}

let workerRunning = false;
let workerRerun = false;

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
    const vecs = await embedBatchWithRateLimitRetry(texts);
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
    await new Promise((r) => setTimeout(r, EMBED_BATCH_GAP_MS));
  }
}

/** Trial keys are limited per minute: a 429 means slow down, not stop for 30 minutes. */
async function embedBatchWithRateLimitRetry(texts: string[]): Promise<number[][] | null> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await callBatchEmbed(texts, "retrieval.passage", EMBED_BATCH_TIMEOUT_MS);
    } catch (err) {
      if (!(err instanceof KbEmbedHttpError) || err.status !== 429 || attempt >= EMBED_RATE_LIMIT_RETRIES) throw err;
      logger.warn({ attempt, detail: err.detail }, "KB embed worker rate-limited — waiting before retry");
      await new Promise((r) => setTimeout(r, EMBED_RATE_LIMIT_WAIT_MS));
    }
  }
}
