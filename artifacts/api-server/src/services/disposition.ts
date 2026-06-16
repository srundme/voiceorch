import { db, agentDispositionsTable, callDispositionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import {
  buildSchema,
  buildPrompt,
  rulePrefilter,
  validate,
  type DispositionConfig,
  type CallEvent,
  type DispositionResult,
} from "../lib/disposition/index.js";
import { getDispositionLLM } from "./disposition-llm.js";

// ── Config cache (60-second TTL) ─────────────────────────────────────────────

interface CacheEntry {
  cfg: DispositionConfig;
  expiresAt: number;
}

const configCache = new Map<number, CacheEntry>();
const CACHE_TTL_MS = 60_000;

async function loadConfig(agentId: number): Promise<DispositionConfig | null> {
  const cached = configCache.get(agentId);
  if (cached && Date.now() < cached.expiresAt) return cached.cfg;

  const [row] = await db
    .select()
    .from(agentDispositionsTable)
    .where(eq(agentDispositionsTable.agentId, agentId));

  if (!row) return null;

  const cfg: DispositionConfig = {
    agentId,
    taxonomy:     (row.taxonomy as Record<string, string[]>),
    domainFields: (row.domainFields as DispositionConfig["domainFields"]) ?? [],
    rules:        (row.rules as DispositionConfig["rules"]) ?? [],
  };

  configCache.set(agentId, { cfg, expiresAt: Date.now() + CACHE_TTL_MS });
  return cfg;
}

/** Evict the cache for an agent (called after PUT /disposition/config/:agentId) */
export function evictDispositionCache(agentId: number): void {
  configCache.delete(agentId);
}

// ── Main service function ─────────────────────────────────────────────────────

export interface DisposeCallInput {
  agentId: number;
  callId:  number;
  transcript?: string | null;
  callEvents?: CallEvent[];
}

export async function disposeCall(input: DisposeCallInput): Promise<DispositionResult | null> {
  const { agentId, callId, transcript, callEvents = [] } = input;

  const cfg = await loadConfig(agentId);
  if (!cfg) {
    logger.debug({ agentId }, "disposition: no config for agent, skipping");
    return null;
  }

  let result: DispositionResult;

  // 1. Deterministic prefilter
  const prefilter = rulePrefilter(callEvents, cfg.rules);
  if (prefilter) {
    result = validate(cfg, {
      primary:    prefilter.primary,
      sub:        prefilter.sub,
      confidence: prefilter.confidence,
      evidence:   `[rule: ${prefilter.rule}]`,
      summary:    `Matched platform rule: ${prefilter.rule}`,
    }, callEvents);
  } else {
    // 2. LLM extract
    const llm = await getDispositionLLM();
    if (!llm || !transcript?.trim()) {
      const fallbackResult: DispositionResult = {
        primary: "NOT_CONNECTED",
        sub: "no_answer",
        confidence: 0,
        evidence: "",
        summary: "No transcript or LLM unavailable",
        flags: ["no_llm_available"],
        needsReview: true,
        error: "LLM unavailable or transcript empty",
      };
      await persistResult(agentId, callId, transcript, callEvents, fallbackResult);
      return fallbackResult;
    }

    const systemPrompt = buildPrompt(cfg);
    const schema       = buildSchema(cfg);

    let rawOut: Record<string, unknown>;
    try {
      rawOut = await llm.extract(systemPrompt, schema, transcript);
    } catch (err) {
      logger.error({ agentId, callId, err }, "disposition: LLM extract failed");
      const errResult: DispositionResult = {
        primary: "NOT_CONNECTED",
        sub: "no_answer",
        confidence: 0,
        evidence: "",
        summary: "LLM extraction failed",
        flags: ["llm_error"],
        needsReview: true,
        error: String(err),
      };
      await persistResult(agentId, callId, transcript, callEvents, errResult);
      return errResult;
    }

    result = validate(cfg, rawOut, callEvents);
  }

  await persistResult(agentId, callId, transcript, callEvents, result);
  return result;
}

async function persistResult(
  agentId:    number,
  callId:     number,
  transcript: string | null | undefined,
  callEvents: CallEvent[],
  result:     DispositionResult,
): Promise<void> {
  try {
    await db.insert(callDispositionsTable).values({
      agentId,
      callId,
      transcript:  transcript ?? null,
      callEvents:  callEvents as Record<string, unknown>[],
      result:      result as unknown as Record<string, unknown>,
      needsReview: result.needsReview,
    });
  } catch (err) {
    logger.error({ agentId, callId, err }, "disposition: failed to persist result");
  }
}
