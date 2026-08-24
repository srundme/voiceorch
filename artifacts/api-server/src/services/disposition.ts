import { db, agentDispositionsTable, callDispositionsTable, callsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import {
  buildSchema,
  buildPrompt,
  rulePrefilter,
  validate,
  extractUnavailableFallback,
  type DispositionConfig,
  type CallEvent,
  type DispositionResult,
} from "../lib/disposition/index.js";
import { fillMissingPhoneFields } from "../lib/disposition/fill-phone-fields.js";
import { getDispositionLLMChain, isRetryableProviderError } from "./disposition-llm.js";

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
    outcomeGuides: (row.outcomeGuides as Record<string, string> | null) ?? {},
  };

  // Empty taxonomy + no domain fields ⇒ treat as unconfigured
  if (Object.keys(cfg.taxonomy).length === 0 && cfg.domainFields.length === 0) {
    return null;
  }

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
  /** When the call happened — anchors relative dates ("tomorrow") in the LLM prompt. */
  callStartedAt?: Date | null;
  /** Dialed / connected party number — used for "same number" WhatsApp fill. */
  calledNumber?: string | null;
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
    // 2. LLM extract — walk every configured provider so a call-time failure
    // on one (e.g. Gemini 403 billing) falls back to the next working key
    // instead of stamping a bogus NOT_CONNECTED on a connected call.
    const chain = await getDispositionLLMChain();
    if (chain.length === 0 || !transcript?.trim()) {
      const raw = extractUnavailableFallback(cfg, transcript, "no_llm");
      result = validate(cfg, raw, callEvents);
      result = {
        ...result,
        flags: [...(result.flags ?? []), "no_llm_available"],
        needsReview: true,
        error: "LLM unavailable or transcript empty",
      };
    } else {
      const systemPrompt = buildPrompt(cfg, input.callStartedAt ?? null, input.calledNumber ?? null);
      const schema       = buildSchema(cfg);

      let rawOut: Record<string, unknown> | null = null;
      let lastErr: unknown = null;
      for (let i = 0; i < chain.length; i++) {
        const { provider, client } = chain[i]!;
        try {
          rawOut = await Promise.race([
            client.extract(systemPrompt, schema, transcript),
            new Promise<never>((_, reject) => {
              setTimeout(() => reject(new Error("disposition extract timed out after 15000ms")), 15_000);
            }),
          ]);
          if (i > 0) logger.info({ agentId, callId, provider }, "disposition: succeeded on fallback provider");
          break;
        } catch (err) {
          lastErr = err;
          const retryable = isRetryableProviderError(err);
          logger.error({ agentId, callId, provider, retryable, err }, "disposition: LLM extract failed");
          if (!retryable) break;
        }
      }

      if (rawOut) {
        result = validate(cfg, rawOut, callEvents);
      } else {
        const raw = extractUnavailableFallback(cfg, transcript, "llm_error");
        result = validate(cfg, raw, callEvents);
        result = {
          ...result,
          flags: [...(result.flags ?? []), "llm_error"],
          needsReview: true,
          error: String(lastErr),
        };
      }
    }
  }

  // 3. Regex / same-number fill when LLM left phone fields empty (common on Live).
  result = fillMissingPhoneFields(cfg, result, transcript, input.calledNumber);

  // If we recovered phone fields from the transcript, drop the hard error so
  // flatDispositionFromTaxonomy + call UI still persist Collected data.
  if (result.error && hasDomainScalars(result)) {
    const { error: _drop, ...rest } = result;
    result = { ...rest, flags: [...(result.flags ?? []), "partial_from_transcript"] };
  }

  await persistResult(agentId, callId, transcript, callEvents, result);
  return result;
}

function hasDomainScalars(result: DispositionResult): boolean {
  if (!result.domainFields) return false;
  return Object.values(result.domainFields).some((v) => v != null && v !== "");
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

  // Flat display shape on calls.disposition_result for call log / detail.
  // Skip pure failure placeholders (NOT_CONNECTED + error + no domain data).
  const domainEntries: Record<string, string | number | boolean> = {};
  if (result.domainFields) {
    for (const [k, v] of Object.entries(result.domainFields)) {
      if (v == null || v === "") continue;
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        domainEntries[k] = v;
      }
    }
  }

  const hasOutcome = !result.error && !!result.primary && !!result.sub;
  const hasDomain = Object.keys(domainEntries).length > 0;
  if (!hasOutcome && !hasDomain) return;

  const flat: Record<string, string | number | boolean> = { ...domainEntries };
  if (hasOutcome) {
    flat[result.primary] = result.sub;
    flat["primary"] = result.primary;
    flat["sub"] = result.sub;
    if (typeof result.confidence === "number") flat["confidence"] = result.confidence;
    if (result.summary) flat["summary"] = result.summary;
  }

  try {
    await db
      .update(callsTable)
      .set({ dispositionResult: flat })
      .where(eq(callsTable.id, callId));
    logger.info(
      {
        agentId,
        callId,
        primary: result.primary,
        sub: result.sub,
        confidence: result.confidence,
        domainKeys: Object.keys(domainEntries),
      },
      "disposition: persisted taxonomy classification onto call",
    );
  } catch (err) {
    logger.error({ agentId, callId, err }, "disposition: failed to persist flat result onto call");
  }
}
