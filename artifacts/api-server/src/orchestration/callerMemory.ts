/**
 * Graphiti-style three-layer caller memory — never forgets
 * ─────────────────────────────────────────────────────────────────
 *
 * L0 — caller_facts      (atomic fact nodes)
 *       Conflict resolution: superseded_by edges (old fact → new fact)
 *       Provenance:          fact_sources edges  (fact → source sentences)
 *       "Current" facts: WHERE superseded_by_id IS NULL
 *
 * L1 — caller_call_archive  (episode nodes)
 *       Synthesis:   insight_facts edges (episode → facts extracted from it)
 *       One row per call, never deleted.
 *
 * L2 — caller_sentences  (sentence nodes)
 *       Sequential utterances within an episode, ordered by sequence_num.
 *       NEXT edges = sequence_num ordering within episode_id.
 *
 * Integration (both session.ts and webcall.ts):
 *   Call start  → loadCallerContext()  + injectEnhancedMemory()
 *   Mid-call    → latchCallerName()    (real-time name detection)
 *              → latchCallerFact()     (real-time pattern-based facts)
 *   Call end    → updateCallerProfile() (archives + LLM extraction + supersession)
 */

import {
  db,
  callerProfilesTable,
  scheduledCallbacksTable,
  callerFactsTable,
  callerCallArchiveTable,
  callerSentencesTable,
  callerFactSentenceLinksTable,
  callerEpisodeFactLinksTable,
  canonicalizeCallerKey,
  isRealPhoneNumber,
  humanPhone,
  resolveCallerKey,
  type CallDirection,
} from "@workspace/db";

// Re-export the shared caller-identity helpers so existing importers
// (session.ts, etc.) keep working through callerMemory's public surface.
export { canonicalizeCallerKey, isRealPhoneNumber, humanPhone, resolveCallerKey };
export type { CallDirection };
import { and, eq, ne, desc, isNull, inArray, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import type { ConversationTurn } from "./types.js";
import type { createLLMAdapter } from "./adapters/llm/index.js";
import { logger } from "../lib/logger.js";

// ── Types ────────────────────────────────────────────────────────────────────

type LLMAdapter = ReturnType<typeof createLLMAdapter>;

export interface CallerProfile {
  id: number;
  agentId: number;
  phoneNumber: string;
  name: string | null;
  summary: string | null;
  callCount: number;
  lastCalledAt: Date | null;
  lastCallDropped: boolean;
  lastCallDroppedAt: Date | null;
  predictedIntent: string | null;
  riskScore: number | null;
  sentimentTrend: string | null;
  /** BCP-47 code of the language the caller was speaking when the last call ended.
   *  When languageAutoDetect is ON, the next call starts in this language. */
  preferredLanguage: string | null;
}

export interface CallerFact {
  id: number;
  key: string;
  value: string;
  confidence: number;
  sourceCallId: number | null;
  /** L2 sentence IDs this fact was sourced from (fact_sources provenance) */
  sourceSentenceIds: number[];
  /** Non-null if this fact has been superseded (points to the newer fact's id) */
  supersededById: number | null;
  createdAt: Date;
}

export interface CallerCallRecord {
  id: number;
  callId: number | null;
  summary: string | null;
  durationSeconds: number | null;
  sentiment: string | null;
  createdAt: Date;
}

export interface CallerContext {
  profile: CallerProfile | null;
  facts: CallerFact[];         // only current (non-superseded) facts
  recentCalls: CallerCallRecord[];  // last 5 archived calls
  /** Tail (last few utterances) of the prior conversation when it ended abruptly
   *  (dropped within the dropped-call window). null when there is nothing to resume. */
  abruptEndTail?: Array<{ speaker: "agent" | "caller"; text: string }> | null;
  /** True when this caller's stored memory was written under a DIFFERENT agent
   *  persona than the one currently configured (the agent was repurposed). When
   *  set, injectEnhancedMemory suppresses ALL domain-bearing memory so a stale
   *  persona's intent/facts/episodes can't bleed into the new one. */
  personaChanged?: boolean;
}

// Reserved caller_fact key holding a fingerprint of the agent persona that last
// wrote this caller's memory. Lets us detect persona/domain whiplash when an
// agent is repurposed (e.g. real-estate → insurance) so stale intent/facts are
// not reused. Never shown to the LLM — filtered out of the facts list on load.
export const PERSONA_HASH_FACT_KEY = "__agent_persona_hash";

/**
 * Stable fingerprint of an agent's persona. Derived from the system prompt only
 * (the persona definition that changes when an agent is repurposed) — NOT from
 * compliance toggles, dates, or call-specific data, which would cause false
 * invalidation. Returns "" for an empty prompt (treated as "no fingerprint").
 */
export function computePersonaHash(systemPrompt: string | null | undefined): string {
  const src = (systemPrompt ?? "").trim();
  if (!src) return "";
  return createHash("sha1").update(src).digest("hex").slice(0, 16);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function daysSinceLabel(d: Date | null): string | null {
  if (!d) return null;
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7)  return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} week${Math.floor(days / 7) > 1 ? "s" : ""} ago`;
  if (days < 365) return `${Math.floor(days / 30)} month${Math.floor(days / 30) > 1 ? "s" : ""} ago`;
  return `${Math.floor(days / 365)} year${Math.floor(days / 365) > 1 ? "s" : ""} ago`;
}

// ── Abrupt-end / dropped-call detection ──────────────────────────────────────

/** A prior call counts as "abruptly ended" if it was flagged dropped and that
 *  drop happened within this window. Used to decide whether to resume the thread. */
const DROPPED_CALL_WINDOW_MS = 60 * 60 * 1000;

/** How many trailing utterances of the prior conversation to keep for resuming. */
const ABRUPT_END_TAIL_SIZE = 6;

export function isAbruptEnd(profile: CallerProfile | null): boolean {
  return (
    profile?.lastCallDropped === true &&
    profile.lastCallDroppedAt != null &&
    Date.now() - profile.lastCallDroppedAt.getTime() < DROPPED_CALL_WINDOW_MS
  );
}

/** Fetch the last `limit` utterances of an archived episode (L2), in chronological order. */
async function loadEpisodeTail(
  episodeId: number,
  limit: number,
): Promise<Array<{ speaker: "agent" | "caller"; text: string }>> {
  const rows = await db
    .select({
      speaker:     callerSentencesTable.speaker,
      text:        callerSentencesTable.text,
      sequenceNum: callerSentencesTable.sequenceNum,
    })
    .from(callerSentencesTable)
    .where(eq(callerSentencesTable.episodeId, episodeId))
    .orderBy(desc(callerSentencesTable.sequenceNum))
    .limit(limit);
  return rows
    .reverse()
    .map(r => ({ speaker: r.speaker as "agent" | "caller", text: r.text }));
}

/**
 * Decide whether an abrupt-end conversation tail is worth resuming.
 *
 * The "resume, do not restart" behaviour suppresses the agent's scripted opening
 * (brand/persona intro) and tells the model to pick the prior conversation back
 * up. That is only safe when the prior tail is a real, coherent exchange. If the
 * previous call was itself broken — the agent looping the same line, or the
 * caller side being STT garbage — resuming it drops the model straight back into
 * the broken state and the scripted intro never happens, and the new call tends
 * to drop too, feeding the next call (a self-perpetuating loop). In that case it is
 * treated as an unresumable drop: caller memory cold-starts (name only) so the
 * scripted opening is restored, rather than resuming the broken thread.
 */
function isResumableTail(
  tail: Array<{ speaker: "agent" | "caller"; text: string }> | null,
): boolean {
  if (!tail || tail.length === 0) return false;

  const normalize = (s: string) =>
    s.toLowerCase().replace(/[\s।॥,.!?…\-–—]+/g, " ").trim();

  // Looping prior call: the agent repeated the same — or a near-identical — line.
  // Resuming such a call drops the model straight back into the loop, so start
  // fresh instead. We fail safe toward "not resumable": a false positive just
  // means the agent gives its normal scripted opening, which is the desired
  // behaviour anyway.
  const agentLines = tail
    .filter(t => t.speaker === "agent")
    .map(t => normalize(t.text))
    .filter(t => t.length > 0);
  if (agentLines.length >= 2) {
    if (new Set(agentLines).size < agentLines.length) return false; // exact repeat
    for (let i = 0; i < agentLines.length; i++) {
      for (let j = i + 1; j < agentLines.length; j++) {
        const a = agentLines[i]!;
        const b = agentLines[j]!;
        const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
        // near-duplicate: one line contains the other, or they share a long prefix
        if (shorter.length >= 16 && longer.includes(shorter)) return false;
        let k = 0;
        while (k < shorter.length && a[k] === b[k]) k++;
        if (k >= 20) return false;
      }
    }
  }

  // A resume only makes sense if the caller actually contributed something
  // substantive to continue from. Reject all-agent tails and tails whose caller
  // turns are all empty or a single repeated token (typical STT garbage, e.g.
  // "मैं मैं मैं") — there is no real thread to pick back up.
  const callerLines = tail
    .filter(t => t.speaker === "caller")
    .map(t => normalize(t.text))
    .filter(t => t.length > 0);
  const hasSubstantiveCaller = callerLines.some(
    line => new Set(line.split(" ").filter(Boolean)).size >= 2,
  );
  if (!hasSubstantiveCaller) return false;

  return true;
}

// ── Layer 1 compat: load just the profile row ─────────────────────────────────

export async function loadCallerProfile(
  agentId: number,
  phoneNumber: string,
): Promise<CallerProfile | null> {
  // Defense-in-depth: never trust the caller to be already canonical.
  phoneNumber = canonicalizeCallerKey(phoneNumber) ?? phoneNumber;
  const [row] = await db
    .select()
    .from(callerProfilesTable)
    .where(and(eq(callerProfilesTable.agentId, agentId), eq(callerProfilesTable.phoneNumber, phoneNumber)));
  return row ?? null;
}

// ── L0+L1+L2: load full context ───────────────────────────────────────────────

export async function loadCallerContext(
  agentId: number,
  phoneNumber: string,
  currentPersonaHash?: string,
): Promise<CallerContext> {
  // Defense-in-depth: read with the SAME canonical key the write path uses, so a
  // non-canonical caller string can never silently miss stored memory.
  phoneNumber = canonicalizeCallerKey(phoneNumber) ?? phoneNumber;
  const [profile, currentFacts, recentCalls] = await Promise.all([
    // L1 profile
    loadCallerProfile(agentId, phoneNumber),

    // L0 — only CURRENT facts (WHERE superseded_by_id IS NULL)
    db
      .select()
      .from(callerFactsTable)
      .where(and(
        eq(callerFactsTable.agentId, agentId),
        eq(callerFactsTable.phoneNumber, phoneNumber),
        isNull(callerFactsTable.supersededById),
      ))
      .orderBy(desc(callerFactsTable.createdAt)),

    // L1 episodes — last 5
    db
      .select({
        id:              callerCallArchiveTable.id,
        callId:          callerCallArchiveTable.callId,
        summary:         callerCallArchiveTable.summary,
        durationSeconds: callerCallArchiveTable.durationSeconds,
        sentiment:       callerCallArchiveTable.sentiment,
        createdAt:       callerCallArchiveTable.createdAt,
      })
      .from(callerCallArchiveTable)
      .where(and(
        eq(callerCallArchiveTable.agentId,     agentId),
        eq(callerCallArchiveTable.phoneNumber, phoneNumber),
      ))
      .orderBy(desc(callerCallArchiveTable.createdAt))
      .limit(5),
  ]);

  const normalizedProfile: CallerProfile | null = profile ? {
    ...profile,
    predictedIntent:   (profile as any).predictedIntent   ?? null,
    riskScore:         (profile as any).riskScore         ?? null,
    sentimentTrend:    (profile as any).sentimentTrend    ?? null,
    preferredLanguage: (profile as any).preferredLanguage ?? null,
  } : null;

  // ── Resume support: when the previous call ended abruptly (dropped within the
  //    window), load the tail of that last episode so the agent can pick the
  //    thread back up instead of restarting. Best-effort — never blocks memory. ──
  let abruptEndTail: Array<{ speaker: "agent" | "caller"; text: string }> | null = null;
  if (isAbruptEnd(normalizedProfile) && recentCalls.length > 0) {
    try {
      const tail = await loadEpisodeTail(recentCalls[0]!.id, ABRUPT_END_TAIL_SIZE);
      if (tail.length > 0) abruptEndTail = tail;
    } catch (tailErr) {
      logger.warn({ agentId, phoneNumber, tailErr }, "Failed to load abrupt-end conversation tail — continuing without resume context");
    }
  }

  // ── Persona-change detection ───────────────────────────────────────────────
  // The reserved marker fact records the persona that last wrote this caller's
  // memory. If it exists and differs from the current agent persona, the agent
  // was repurposed — flag it so domain memory is suppressed for this call.
  // Absence = first persona ever seen = no mismatch (nothing stale to suppress).
  const storedPersonaHash = currentFacts.find(r => r.key === PERSONA_HASH_FACT_KEY)?.value ?? null;
  const personaChanged =
    !!currentPersonaHash && !!storedPersonaHash && storedPersonaHash !== currentPersonaHash;
  if (personaChanged) {
    logger.warn(
      { agentId, phoneNumber, storedPersonaHash, currentPersonaHash },
      "Caller memory: agent persona changed since last contact — suppressing stale domain memory for this call",
    );
  }

  // Retrieval diagnostic: make memory hit/miss observable in the logs so a future
  // "the agent doesn't remember me" report is immediately diagnosable. The write
  // side already logs; this covers the read side keyed on the canonical identity.
  logger.info(
    {
      agentId,
      phoneNumber,
      hit: !!normalizedProfile,
      callCount: normalizedProfile?.callCount ?? 0,
      factCount: currentFacts.filter(r => r.key !== PERSONA_HASH_FACT_KEY).length,
      archiveCount: recentCalls.length,
    },
    "Caller memory retrieval",
  );

  return {
    profile: normalizedProfile,
    facts: currentFacts
      .filter(r => r.key !== PERSONA_HASH_FACT_KEY)
      .map(r => ({
        id:                r.id,
        key:               r.key,
        value:             r.value,
        confidence:        r.confidence,
        sourceCallId:      r.sourceCallId,
        sourceSentenceIds: [],  // fetched via junction table in detail endpoints only
        supersededById:    r.supersededById,
        createdAt:         r.createdAt,
      })),
    personaChanged,
    recentCalls: recentCalls.map(r => ({
      id:              r.id,
      callId:          r.callId,
      summary:         r.summary,
      durationSeconds: r.durationSeconds,
      sentiment:       r.sentiment ?? null,
      createdAt:       r.createdAt,
    })),
    abruptEndTail,
  };
}

// ── Layer 1 compat: inject old-style memory block ─────────────────────────────

export function injectCallerMemory(systemPrompt: string, profile: CallerProfile): string {
  const ctx: CallerContext = { profile, facts: [], recentCalls: [] };
  return injectEnhancedMemory(systemPrompt, ctx);
}

// ── Enhanced memory injection (all layers) ────────────────────────────────────

const SENTIMENT_EMOJI: Record<string, string> = {
  positive:  "😊",
  neutral:   "😐",
  negative:  "😞",
  frustrated:"😤",
  resolved:  "✅",
};

const TREND_LABEL: Record<string, string> = {
  improving:       "📈 improving",
  declining:       "📉 declining",
  stable_positive: "✅ consistently positive",
  stable_negative: "⚠️ consistently negative",
  mixed:           "↕ mixed",
};

const STALE_DAYS = 90;  // facts older than this get a stale marker

export function injectEnhancedMemory(
  systemPrompt: string,
  ctx: CallerContext,
): string {
  const { profile, facts, recentCalls } = ctx;
  // Persona whiplash guard: when the agent was repurposed since this caller's
  // memory was written, suppress ALL domain-bearing memory (predicted intent,
  // facts, summary, episodes, sentiment/risk, resume thread, and the
  // returning-caller instruction) and treat the call as cold. Only the caller's
  // name and the name-priority safety rule survive.
  const personaChanged = ctx.personaChanged ?? false;

  const lines: string[] = ["=== CALLER MEMORY — NEVER FORGETS ==="];

  const namePart   = profile?.name ?? facts.find(f => f.key === "name")?.value ?? "unknown";
  const callCount  = profile?.callCount ?? 0;
  const lastLabel  = daysSinceLabel(profile?.lastCalledAt ?? null);

  const headerParts: string[] = [`Name: ${namePart}`];

  const isRecentDrop = !personaChanged && isAbruptEnd(profile);
  // Only treat the drop as resumable when the prior tail is a coherent exchange.
  // A looping/garbage prior call must NOT suppress the scripted opening, or the
  // agent re-enters the broken thread and never re-introduces itself (doom loop).
  const abruptEndTail = ctx.abruptEndTail ?? null;
  const resumeDrop = isRecentDrop && isResumableTail(abruptEndTail);

  // A dropped call we've decided NOT to resume is treated as a cold start, just
  // like a persona change: the profile/summary/episodes were written by the
  // broken call and are contaminated, so we suppress all domain-bearing memory
  // and let the agent give its normal scripted opening instead of the
  // "don't re-introduce yourself" returning-caller behaviour. Only the caller's
  // name (and the name-priority safety rule) survive.
  const unresumableDrop = isRecentDrop && !resumeDrop;
  const suppressDomain = personaChanged || unresumableDrop;

  if (!suppressDomain) {
    headerParts.push(`Calls: ${callCount}`);
    if (lastLabel) headerParts.push(`Last: ${lastLabel}`);
  }
  if (resumeDrop) headerParts.push("⚠️ LAST CALL DROPPED");
  lines.push(headerParts.join("  |  "));

  // ── Predicted intent (if available) ───────────────────────────────────────
  if (!suppressDomain && profile?.predictedIntent) {
    lines.push("");
    lines.push(`🎯 PREDICTED REASON FOR THIS CALL: ${profile.predictedIntent}`);
  }

  // ── Risk signal ───────────────────────────────────────────────────────────
  const risk = profile?.riskScore ?? 0;
  if (!suppressDomain && risk >= 0.7) {
    lines.push(`🚨 HIGH RISK CALLER (score: ${(risk * 100).toFixed(0)}%) — approach with extra patience, proactively address pain points`);
  } else if (!suppressDomain && risk >= 0.4) {
    lines.push(`⚠️ ELEVATED RISK (score: ${(risk * 100).toFixed(0)}%) — caller may be frustrated, handle with care`);
  }

  // ── Sentiment arc ─────────────────────────────────────────────────────────
  const sentimentsWithData = suppressDomain ? [] : recentCalls.filter(c => c.sentiment);
  if (sentimentsWithData.length >= 2) {
    const trend = profile?.sentimentTrend;
    const arc = sentimentsWithData
      .slice(0, 5)
      .reverse()
      .map(c => SENTIMENT_EMOJI[c.sentiment!] ?? "•")
      .join(" → ");
    const trendLabel = trend ? ` (${TREND_LABEL[trend] ?? trend})` : "";
    lines.push(`📊 SENTIMENT ARC: ${arc}${trendLabel}`);
  }

  // ── L0: current (non-superseded) structured facts ─────────────────────────
  const now = Date.now();
  const displayFacts = suppressDomain ? [] : facts.filter(f => {
    if (f.key === "name") return false;
    if (f.confidence < 0.5) return false;
    // Always suppress language_pref — agents have a fixed configured language;
    // stored preferences must not override it.
    if (f.key === "language_pref") return false;
    return true;
  });
  if (displayFacts.length > 0) {
    lines.push("");
    lines.push("KNOWN FACTS:");
    for (const f of displayFacts) {
      const ageDays = Math.floor((now - f.createdAt.getTime()) / 86_400_000);
      const staleTag = ageDays > STALE_DAYS ? "  ⚠️ may be outdated" : "";
      const ageLabel = daysSinceLabel(f.createdAt);
      lines.push(`• ${f.key}: ${f.value}${ageLabel ? `  [${ageLabel}]` : ""}${staleTag}`);
    }
  } else if (!suppressDomain && profile?.summary) {
    lines.push("");
    lines.push(`Prior context: ${profile.summary}`);
  }

  // ── L1: recent episode summaries with sentiment ───────────────────────────
  const callsWithSummary = suppressDomain ? [] : recentCalls.filter(c => c.summary);
  if (callsWithSummary.length > 0) {
    lines.push("");
    lines.push("RECENT EPISODES:");
    for (const c of callsWithSummary) {
      const label = daysSinceLabel(c.createdAt) ?? "—";
      const sentEmoji = c.sentiment ? (SENTIMENT_EMOJI[c.sentiment] ?? "") + " " : "";
      lines.push(`[${label}] ${sentEmoji}${c.summary!.trim()}`);
    }
  }

  // ── Resume thread: tail of the abruptly-ended prior conversation (L2) ──────
  const hasResumeTail = resumeDrop && !!abruptEndTail && abruptEndTail.length > 0;
  if (hasResumeTail) {
    lines.push("");
    lines.push("LAST EXCHANGES BEFORE THE CALL DROPPED (resume from here):");
    for (const t of abruptEndTail!) {
      const who = t.speaker === "caller" ? "Caller" : "You";
      lines.push(`${who}: ${t.text.trim()}`);
    }
  }

  // ── Behavioural instruction ───────────────────────────────────────────────
  // These directives are HIGH PRIORITY and must override any "introduce
  // yourself" / scripted-intro behaviour in the agent's base prompt below.
  lines.push("");
  // Identity contamination guard: the stored name may be from a previous caller
  // who used the same phone number. If this caller states their own name at any
  // point during the call, that self-stated name is authoritative and overrides
  // whatever is stored in memory above. Never keep calling the caller by the
  // stored name after they have told you a different name.
  lines.push(
    "⚠️ NAME PRIORITY RULE: If the caller states their own name at any point during this call " +
    "(e.g. \"My name is Gopi\", \"I'm Ravi\", \"This is Priya\"), immediately switch to that name " +
    "and use it exclusively for the rest of the call. The caller's self-stated name takes absolute " +
    "priority over the stored name shown above, which may belong to a previous caller on the same number.",
  );
  if (resumeDrop) {
    lines.push(
      "⚠️ IMPORTANT — RESUME, DO NOT RESTART: Your previous call with this caller ended abruptly (it dropped). " +
      "Do NOT re-introduce yourself or your company and do NOT start the conversation over. " +
      "Briefly acknowledge the interruption (e.g. \"Sorry, it looks like we got cut off\"), then " +
      (hasResumeTail
        ? "pick the conversation back up exactly where the exchanges above left off."
        : "continue naturally from the prior context above."),
    );
  } else if (!suppressDomain && callCount >= 1) {
    const riskInstruction = risk >= 0.7
      ? " Caller has shown frustration recently — proactively address concerns before they escalate."
      : risk >= 0.4
        ? " Handle with care — caller may be frustrated."
        : "";
    const intentInstruction = profile?.predictedIntent
      ? ` They are likely calling about: ${profile.predictedIntent} — address this proactively if appropriate.`
      : "";
    const namePhrase = namePart !== "unknown" ? ` by name (${namePart})` : " by name if known";
    lines.push(
      `⚠️ IMPORTANT — THIS IS A RETURNING CALLER YOU ALREADY KNOW (call #${callCount + 1}). ` +
      `Do NOT introduce yourself or your company as if meeting for the first time, and do NOT speak a generic first-time intro. ` +
      `Open by greeting them${namePhrase} and naturally reference what you already know about them from the memory above. ` +
      `Continue the relationship rather than starting cold.${riskInstruction}${intentInstruction}`,
    );
  }

  lines.push("=====================================");

  return `${lines.join("\n")}\n\n${systemPrompt}`;
}

// ── Graph helper: supersede or insert a fact (L0 conflict resolution) ─────────

/**
 * Insert a new fact node, superseding any existing current fact with the same key.
 *
 * - If the key doesn't exist: plain insert (no supersession).
 * - If the key exists with the SAME value: no-op (returns existing id).
 * - If the key exists with a DIFFERENT value: insert new node, draw
 *   superseded_by edge from old → new.
 *
 * Returns the id of the current (live) fact row.
 */
async function supersedeFact(opts: {
  agentId: number;
  phoneNumber: string;
  key: string;
  value: string;
  confidence: number;
  sourceCallId: number;
  sourceSentenceIds?: number[];
}): Promise<number | null> {
  const { agentId, phoneNumber, key, value, confidence, sourceCallId, sourceSentenceIds = [] } = opts;

  try {
    // Find current (non-superseded) fact with this key
    const [existing] = await db
      .select({ id: callerFactsTable.id, value: callerFactsTable.value })
      .from(callerFactsTable)
      .where(and(
        eq(callerFactsTable.agentId, agentId),
        eq(callerFactsTable.phoneNumber, phoneNumber),
        eq(callerFactsTable.key, key),
        isNull(callerFactsTable.supersededById),
      ))
      .orderBy(desc(callerFactsTable.createdAt))
      .limit(1);

    // Same value → no-op
    if (existing && existing.value === value) return existing.id;

    // Insert new fact node
    const [newRow] = await db
      .insert(callerFactsTable)
      .values({
        agentId,
        phoneNumber,
        key,
        value:        value.slice(0, 512),
        confidence:   Math.min(1, Math.max(0, confidence)),
        sourceCallId,
      })
      .returning({ id: callerFactsTable.id });

    if (!newRow) return null;

    // Draw superseded_by edge: old → new
    if (existing) {
      await db
        .update(callerFactsTable)
        .set({ supersededById: newRow.id })
        .where(eq(callerFactsTable.id, existing.id));
    }

    // Write fact_sources edges (L0 → L2) via junction table
    if (sourceSentenceIds.length > 0) {
      await db.insert(callerFactSentenceLinksTable).values(
        sourceSentenceIds.map(sid => ({ factId: newRow.id, sentenceId: sid })),
      );
    }

    return newRow.id;
  } catch (err) {
    logger.warn({ err, agentId, phoneNumber, key }, "supersedeFact DB error");
    return null;
  }
}

// ── Archive a completed call as an episode (L1) + store sentences (L2) ────────

export async function archiveCall(opts: {
  agentId: number;
  phoneNumber: string;
  callId: number | null;
  transcript: string;
  summary: string | null;
  durationSeconds: number | null;
  factsExtracted?: boolean;
  sentiment?: string | null;
  sentences?: Array<{ speaker: "agent" | "caller"; text: string }>;
}): Promise<{ archiveId: number | null; sentenceIds: number[] }> {
  try {
    const [row] = await db
      .insert(callerCallArchiveTable)
      .values({
        agentId:         opts.agentId,
        phoneNumber:     opts.phoneNumber,
        callId:          opts.callId,
        transcript:      opts.transcript,
        summary:         opts.summary,
        durationSeconds: opts.durationSeconds,
        factsExtracted:  opts.factsExtracted ?? false,
        sentiment:       opts.sentiment ?? null,
      })
      .returning({ id: callerCallArchiveTable.id });

    const archiveId = row?.id ?? null;
    let sentenceIds: number[] = [];

    // Insert L2 sentence nodes with NEXT-edge ordering
    if (archiveId && opts.sentences && opts.sentences.length > 0) {
      const inserted = await db
        .insert(callerSentencesTable)
        .values(opts.sentences.map((s, i) => ({
          episodeId:   archiveId,
          sequenceNum: i + 1,
          speaker:     s.speaker,
          text:        s.text.slice(0, 4000),
        })))
        .returning({ id: callerSentencesTable.id });
      sentenceIds = inserted.map(r => r.id);
    }

    return { archiveId, sentenceIds };
  } catch (err) {
    logger.warn({ err, agentId: opts.agentId, phoneNumber: opts.phoneNumber }, "archiveCall DB write failed");
    return { archiveId: null, sentenceIds: [] };
  }
}

// ── Extract and save structured facts via LLM ─────────────────────────────────

interface ExtractedLLMResult {
  name?: string | null;
  summary?: string | null;
  sentiment?: string | null;
  facts?: Array<{ key: string; value: string; confidence: number }>;
}

async function runLLMExtraction(opts: {
  llm: LLMAdapter;
  transcript: string;
  priorContext: string;
  priorFacts: CallerFact[];
}): Promise<ExtractedLLMResult> {
  const { llm, transcript, priorContext, priorFacts } = opts;

  const priorFactsStr = priorFacts.length > 0
    ? `\nPreviously known facts:\n${priorFacts.map(f => `  ${f.key}: ${f.value}`).join("\n")}\n`
    : "";

  let raw = "";
  await llm.chat(
    [{
      role: "user",
      content:
        `${priorContext}${priorFactsStr}` +
        `Analyze this call transcript and extract:\n` +
        `1. A concise 1-3 sentence summary of what was discussed (merge with any prior context above)\n` +
        `2. The caller's emotional sentiment for THIS call\n` +
        `3. Key facts about the caller — ONLY things they explicitly stated\n\n` +
        `Return ONLY valid JSON with exactly these fields:\n` +
        `{\n` +
        `  "name": "caller's first name if stated, otherwise null",\n` +
        `  "summary": "1-3 sentence summary",\n` +
        `  "sentiment": "one of: positive | neutral | negative | frustrated | resolved",\n` +
        `  "facts": [\n` +
        `    { "key": "snake_case_key", "value": "the value", "confidence": 0.0-1.0 }\n` +
        `  ]\n` +
        `}\n\n` +
        `Sentiment guide:\n` +
        `- positive: caller was happy, satisfied, or grateful\n` +
        `- neutral: routine call, no strong emotion\n` +
        `- negative: caller was unhappy or expressed dissatisfaction\n` +
        `- frustrated: caller was noticeably irritated or escalating\n` +
        `- resolved: caller was frustrated but issue was resolved by end of call\n\n` +
        `For fact keys: use concise snake_case strings that describe what was explicitly stated.\n` +
        `Name the key after the actual topic discussed — do NOT impose domain-specific labels.\n` +
        `Good examples: name, age, gender, location, occupation, budget_range, language_pref,\n` +
        `timeline, property_type, interested_in, vehicle_type, company_name, email,\n` +
        `preferred_contact_method, concerns, follow_up_needed.\n` +
        `Avoid forcing insurance labels (policy_interest, existing_policies, medications)\n` +
        `unless the caller explicitly discussed insurance or health.\n\n` +
        `Rules:\n` +
        `- Only include facts the caller EXPLICITLY stated — never infer or assume\n` +
        `- confidence: 0.9+ = directly stated, 0.7-0.9 = clearly implied, below 0.7 = skip\n` +
        `- Return empty array for facts if nothing was clearly stated\n` +
        `- Be concise with values (e.g. "4" not "a family of four people")\n\n` +
        `Transcript:\n${transcript.slice(0, 8000)}`,
    }],
    "You extract caller profile information from voice call transcripts. Return only a JSON object with 'name' (string|null), 'summary' (string), 'sentiment' (string), and 'facts' (array of {key,value,confidence}). Be conservative and factual.",
    () => {},
    (full) => { raw = full; },
  );

  const jsonStr = raw
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/```(?:json)?\s*/g, "")
    .replace(/\s*```\s*/g, "")
    .trim();

  return JSON.parse(jsonStr) as ExtractedLLMResult;
}

// ── Predict caller's next intent + risk score (async, post-archive) ───────────

async function predictCallerIntent(opts: {
  agentId: number;
  phoneNumber: string;
  llm: LLMAdapter;
  callCount: number;
}): Promise<void> {
  const { agentId, phoneNumber, llm, callCount } = opts;

  // Only predict after 2+ calls (not enough signal on first call)
  if (callCount < 2) return;

  try {
    // Load last 5 episodes for pattern analysis
    const episodes = await db
      .select({
        summary:   callerCallArchiveTable.summary,
        sentiment: callerCallArchiveTable.sentiment,
        createdAt: callerCallArchiveTable.createdAt,
      })
      .from(callerCallArchiveTable)
      .where(and(
        eq(callerCallArchiveTable.agentId,     agentId),
        eq(callerCallArchiveTable.phoneNumber, phoneNumber),
      ))
      .orderBy(desc(callerCallArchiveTable.createdAt))
      .limit(5);

    if (episodes.length < 2) return;

    const episodeLines = episodes
      .map((e, i) => {
        const label = daysSinceLabel(e.createdAt) ?? "—";
        const sent = e.sentiment ? ` [${e.sentiment}]` : "";
        return `Call ${i + 1} (${label})${sent}: ${e.summary ?? "No summary"}`;
      })
      .join("\n");

    // Compute sentiment trend
    const sentiments = episodes.map(e => e.sentiment).filter(Boolean) as string[];
    const sentimentTrend = computeSentimentTrend(sentiments);

    // Risk score heuristic (elevated call frequency + negative sentiment)
    const negativeCount = sentiments.filter(s => s === "frustrated" || s === "negative").length;
    const rawRisk = Math.min(1.0, (negativeCount / Math.max(sentiments.length, 1)) * 1.2);

    let raw = "";
    await llm.chat(
      [{
        role: "user",
        content:
          `Based on this caller's history, predict their likely intent for their NEXT call.\n\n` +
          `Call history (most recent first):\n${episodeLines}\n\n` +
          `Return ONLY valid JSON:\n` +
          `{\n` +
          `  "predictedIntent": "1 short sentence describing the most likely reason for their next call",\n` +
          `  "riskScore": 0.0\n` +
          `}\n\n` +
          `riskScore guide: 0.0 = no risk, 1.0 = high churn/escalation risk.\n` +
          `Consider: negative sentiment trend, unresolved issues, high call frequency as risk signals.\n` +
          `Return ONLY the JSON object, no other text.`,
      }],
      "You are a customer behaviour analyst. Predict caller intent and risk from call history. Return only a JSON object.",
      () => {},
      (full) => { raw = full; },
    );

    const jsonStr = raw
      .replace(/<think>[\s\S]*?<\/think>/g, "")
      .replace(/```(?:json)?\s*/g, "")
      .replace(/\s*```\s*/g, "")
      .trim();

    const parsed = JSON.parse(jsonStr) as { predictedIntent?: string; riskScore?: number };
    const predictedIntent = parsed.predictedIntent?.slice(0, 256) ?? null;
    const riskScore = typeof parsed.riskScore === "number"
      ? Math.min(1, Math.max(0, (parsed.riskScore + rawRisk) / 2))
      : rawRisk;

    await db
      .update(callerProfilesTable)
      .set({ predictedIntent, riskScore, sentimentTrend, updatedAt: new Date() })
      .where(and(
        eq(callerProfilesTable.agentId,     agentId),
        eq(callerProfilesTable.phoneNumber, phoneNumber),
      ));

    logger.info({ agentId, phoneNumber, predictedIntent, riskScore, sentimentTrend }, "Caller intent + risk predicted");
  } catch (err) {
    logger.warn({ err, agentId, phoneNumber }, "predictCallerIntent failed (non-fatal)");
  }
}

// ── Sentiment trend computation ───────────────────────────────────────────────

function computeSentimentTrend(sentiments: string[]): string {
  if (sentiments.length === 0) return "unknown";

  const score = (s: string) => {
    if (s === "positive" || s === "resolved") return 1;
    if (s === "neutral") return 0;
    if (s === "negative") return -1;
    if (s === "frustrated") return -2;
    return 0;
  };

  const scores = sentiments.map(score);
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;

  if (scores.length >= 2) {
    const recent = scores.slice(0, Math.min(3, scores.length));
    const older  = scores.slice(Math.min(3, scores.length));
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const olderAvg  = older.length > 0 ? older.reduce((a, b) => a + b, 0) / older.length : recentAvg;

    if (recentAvg > olderAvg + 0.3)  return "improving";
    if (recentAvg < olderAvg - 0.3)  return "declining";
  }

  if (avg >= 0.7)  return "stable_positive";
  if (avg <= -0.7) return "stable_negative";
  return "mixed";
}

// ── updateCallerProfile — enhanced with graph edges ───────────────────────────

export async function updateCallerProfile(opts: {
  agentId: number;
  phoneNumber: string;
  history: ConversationTurn[];
  llm: LLMAdapter;
  existing: CallerProfile | null;
  callId: number;
  wasDropped?: boolean;
  durationSeconds?: number;
  /**
   * Name that was latched mid-call via real-time name detection (latchCallerName).
   * When non-null and the LLM extraction produces a conflicting name, this takes
   * priority — the caller's self-stated name is more reliable than LLM inference
   * from a transcript where the agent may have already used the wrong (stored) name.
   */
  callerNameInCall?: string | null;
  /** Current agent persona fingerprint (computePersonaHash). Written to the
   *  reserved marker fact at call end so future calls can detect a persona swap;
   *  when a swap is detected here, the caller's pre-swap memory is retired. */
  personaHash?: string;
  /**
   * BCP-47 language code of the language the caller was speaking when the call ended
   * (pipeline.getCurrentLang()). Stored as preferred_language so the next call can
   * start in this language when languageAutoDetect is ON.
   * Ignored when null/empty (don't overwrite an existing preference with nothing).
   */
  finalLanguage?: string | null;
}): Promise<void> {
  const { agentId, history, llm, existing, callId, wasDropped = false, durationSeconds, callerNameInCall, personaHash, finalLanguage } = opts;
  // Defense-in-depth: write under the SAME canonical key the read path uses.
  const phoneNumber = canonicalizeCallerKey(opts.phoneNumber) ?? opts.phoneNumber;

  if (history.length < 1) return;

  const now      = new Date();
  const newCount = (existing?.callCount ?? 0) + 1;
  const transcript = history.map(t => `${t.role === "user" ? "Caller" : "Agent"}: ${t.content}`).join("\n");

  // ── Phase 1: counter update (always runs, same as before) ─────────────────
  // Persist the caller's preferred language (last language spoken this call)
  // when provided and non-empty, so the next call can start in that language.
  const preferredLangUpdate = finalLanguage ? { preferredLanguage: finalLanguage } : {};
  await db
    .insert(callerProfilesTable)
    .values({
      agentId, phoneNumber,
      name:              existing?.name    ?? null,
      summary:           existing?.summary ?? null,
      callCount:         newCount,
      lastCalledAt:      now,
      lastCallDropped:   wasDropped,
      lastCallDroppedAt: wasDropped ? now : null,
      ...preferredLangUpdate,
    })
    .onConflictDoUpdate({
      target: [callerProfilesTable.agentId, callerProfilesTable.phoneNumber],
      set: {
        callCount:         newCount,
        lastCalledAt:      now,
        lastCallDropped:   wasDropped,
        lastCallDroppedAt: wasDropped ? now : null,
        updatedAt:         now,
        ...preferredLangUpdate,
      },
    });

  logger.info({ agentId, phoneNumber, callId, callCount: newCount, wasDropped }, "Caller profile counter updated");

  if (history.length < 2) return;

  // ── Phase 2: archive episode (L1) + sentences (L2) ────────────────────────
  const parsedSentences = history.map(t => ({
    speaker: (t.role === "user" ? "caller" : "agent") as "caller" | "agent",
    text:    t.content,
  }));

  const { archiveId, sentenceIds } = await archiveCall({
    agentId, phoneNumber, callId,
    transcript,
    summary:         null,
    durationSeconds: durationSeconds ?? null,
    factsExtracted:  false,
    sentiment:       null,  // filled in Phase 3 after LLM extraction
    sentences:       parsedSentences,
  });

  // ── Phase 3: LLM extraction (best-effort) ─────────────────────────────────
  // Mutable: the persona-swap block below clears it so the new persona's first
  // extraction never sees the retired domain's summary (would re-pollute memory).
  let priorContext = existing?.summary
    ? `Prior context from previous calls: ${existing.summary}\n\n`
    : "";

  // Load current (non-superseded) facts for LLM context
  let priorFacts: CallerFact[] = [];
  let storedPersonaMarker: string | null = null;
  try {
    const rows = await db
      .select()
      .from(callerFactsTable)
      .where(and(
        eq(callerFactsTable.agentId, agentId),
        eq(callerFactsTable.phoneNumber, phoneNumber),
        isNull(callerFactsTable.supersededById),
      ))
      .orderBy(desc(callerFactsTable.createdAt));
    storedPersonaMarker = rows.find(r => r.key === PERSONA_HASH_FACT_KEY)?.value ?? null;
    priorFacts = rows.filter(r => r.key !== PERSONA_HASH_FACT_KEY).map(r => ({
      id:                r.id,
      key:               r.key,
      value:             r.value,
      confidence:        r.confidence,
      sourceCallId:      r.sourceCallId,
      sourceSentenceIds: [],  // not needed for LLM prompt injection
      supersededById:    r.supersededById,
      createdAt:         r.createdAt,
    }));
  } catch { /* non-fatal */ }

  // ── Persona whiplash: permanently retire stale memory after an agent swap ───
  // loadCallerContext only HIDES stale domain memory for the live call. If the
  // persona changed since this caller's memory was written, retire it for good
  // here (before extraction) so it can neither contaminate this call's fact
  // extraction nor resurface on later calls once the marker matches again.
  const personaSwapped =
    !!personaHash && !!storedPersonaMarker && storedPersonaMarker !== personaHash;
  if (personaSwapped) {
    try {
      const markerId = await supersedeFact({
        agentId, phoneNumber,
        key: PERSONA_HASH_FACT_KEY, value: personaHash!, confidence: 1, sourceCallId: callId,
      });
      if (markerId) {
        await db.update(callerFactsTable)
          .set({ supersededById: markerId })
          .where(and(
            eq(callerFactsTable.agentId, agentId),
            eq(callerFactsTable.phoneNumber, phoneNumber),
            isNull(callerFactsTable.supersededById),
            ne(callerFactsTable.key, PERSONA_HASH_FACT_KEY),
          ));
      }
      await db.update(callerProfilesTable)
        .set({ predictedIntent: null, summary: null, riskScore: null, sentimentTrend: null, updatedAt: now })
        .where(and(
          eq(callerProfilesTable.agentId, agentId),
          eq(callerProfilesTable.phoneNumber, phoneNumber),
        ));
      // Retire pre-swap episodes (keep THIS call's archive) so old-domain
      // summaries and sentiment can't resurface via RECENT EPISODES later.
      await db.update(callerCallArchiveTable)
        .set({ summary: null, sentiment: null })
        .where(and(
          eq(callerCallArchiveTable.agentId, agentId),
          eq(callerCallArchiveTable.phoneNumber, phoneNumber),
          // Keep THIS call's archive row intact when we know its id.
          archiveId != null ? ne(callerCallArchiveTable.id, archiveId) : undefined,
        ));
      priorFacts = [];     // extraction must start cold for the new persona
      priorContext = "";   // and must NOT inherit the retired domain's summary
      logger.info({ agentId, phoneNumber, callId }, "Caller memory: retired stale persona memory after agent repurpose");
    } catch (swapErr) {
      logger.warn({ agentId, phoneNumber, callId, swapErr }, "Caller memory: persona invalidation failed — continuing");
    }
  }

  const MAX_ATTEMPTS = 3;
  const BACKOFF_BASE_MS = 1000;
  let extracted: ExtractedLLMResult = {};
  let llmSucceeded = false;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      extracted = await runLLMExtraction({ llm, transcript, priorContext, priorFacts });
      llmSucceeded = true;
      break;
    } catch (llmErr) {
      logger.warn({ agentId, phoneNumber, callId, attempt, llmErr }, "Caller memory LLM extraction failed — will retry");
      if (attempt < MAX_ATTEMPTS) {
        await new Promise<void>(r => setTimeout(r, BACKOFF_BASE_MS * (2 ** (attempt - 1))));
      }
    }
  }

  if (!llmSucceeded) {
    logger.error({ agentId, phoneNumber, callId }, "Caller memory LLM extraction failed after all retries");
    return;
  }

  // ── Phase 3a: save L0 facts with supersession + fact_sources provenance ───
  // Promote the top-level `name` field into the facts array so it gets
  // stored in caller_facts and shows up in the UI Facts count.
  const nameFact = extracted.name?.trim()
    ? [{ key: "name", value: extracted.name.trim(), confidence: 0.95 }]
    : [];

  const validFacts = [...nameFact, ...(extracted.facts ?? [])].filter(
    f => f.key && f.value && typeof f.confidence === "number" && f.confidence >= 0.7,
  );

  const newFactIds: number[] = [];
  for (const f of validFacts) {
    const normKey = f.key.toLowerCase().replace(/\s+/g, "_").slice(0, 64);
    const factId = await supersedeFact({
      agentId,
      phoneNumber,
      key:               normKey,
      value:             String(f.value),
      confidence:        f.confidence,
      sourceCallId:      callId,
      sourceSentenceIds: sentenceIds,  // fact_sources: all sentences in this episode
    });
    if (factId !== null) newFactIds.push(factId);
  }

  if (newFactIds.length > 0) {
    logger.info({ agentId, phoneNumber, callId, factCount: newFactIds.length }, "Caller facts saved (with supersession)");
  }

  // ── Phase 3b: update episode summary + sentiment + insight_facts edges ───
  if (archiveId) {
    try {
      await db
        .update(callerCallArchiveTable)
        .set({
          summary:        extracted.summary ?? null,
          sentiment:      extracted.sentiment ?? null,
          factsExtracted: newFactIds.length > 0,
        })
        .where(eq(callerCallArchiveTable.id, archiveId));

      // Insert insight_facts edges via junction table
      if (newFactIds.length > 0) {
        await db.insert(callerEpisodeFactLinksTable).values(
          newFactIds.map(fid => ({ episodeId: archiveId, factId: fid })),
        );
      }
    } catch { /* non-fatal */ }
  }

  // ── Phase 3c: update profile summary (L1 backward compat) ────────────────
  // Identity contamination guard: if a name was latched during this call (via
  // latchCallerName — the caller explicitly stated "my name is X") and the LLM
  // extraction disagrees, trust the latched name. The transcript may have the
  // agent using an incorrect stored name from a previous caller, which the LLM
  // could then pick up and re-confirm. The self-stated name is the ground truth.
  if (
    callerNameInCall &&
    extracted.name &&
    extracted.name.toLowerCase() !== callerNameInCall.toLowerCase()
  ) {
    logger.warn(
      { agentId, phoneNumber, callId, latchedName: callerNameInCall, extractedName: extracted.name },
      "Caller memory: LLM-extracted name conflicts with mid-call latched name — keeping latched name to prevent identity contamination",
    );
    extracted.name = callerNameInCall;
  }
  const newName    = extracted.name    || existing?.name    || null;
  const newSummary = extracted.summary || (personaSwapped ? null : existing?.summary) || null;

  try {
    await db
      .update(callerProfilesTable)
      .set({ name: newName, summary: newSummary, updatedAt: now })
      .where(and(
        eq(callerProfilesTable.agentId,     agentId),
        eq(callerProfilesTable.phoneNumber, phoneNumber),
      ));
    logger.info({ agentId, phoneNumber, callId }, "Caller profile summary updated via LLM");
  } catch (dbErr) {
    logger.warn({ agentId, phoneNumber, callId, dbErr }, "Caller profile summary DB write failed");
  }

  // ── Phase 4: async intent prediction + risk scoring (fire-and-forget) ────
  // Skipped right after a persona swap: the just-retired episodes would otherwise
  // re-derive a stale-domain intent and re-pollute the freshly-cleared profile.
  if (!personaSwapped) {
    predictCallerIntent({ agentId, phoneNumber, llm, callCount: newCount }).catch(
      (err) => logger.warn({ err, agentId, phoneNumber }, "predictCallerIntent fire-and-forget failed"),
    );
  }

  // Refresh the persona fingerprint marker for same-persona / first-ever calls
  // (the swap path above already wrote the new marker).
  if (personaHash && !personaSwapped) {
    try {
      await supersedeFact({
        agentId, phoneNumber,
        key: PERSONA_HASH_FACT_KEY, value: personaHash, confidence: 1, sourceCallId: callId,
      });
    } catch (markerErr) {
      logger.warn({ agentId, phoneNumber, callId, markerErr }, "Caller memory: persona marker write failed");
    }
  }
}

// ── Real-time name latch (unchanged) ──────────────────────────────────────────

// \p{L} matches any Unicode letter (Latin, Tamil, Devanagari, Telugu, etc.)
// \p{M} matches combining marks (vowel signs in Indic scripts)
const NAME_PATTERNS: RegExp[] = [
  /\bmy name is ([\p{L}\p{M}][\p{L}\p{M}]*(?: [\p{L}\p{M}][\p{L}\p{M}]*)?)\b/iu,
  /\bi(?:'m| am) ([\p{L}\p{M}][\p{L}\p{M}]*(?: [\p{L}\p{M}][\p{L}\p{M}]*)?)\b/iu,
  /\bthis is ([\p{L}\p{M}][\p{L}\p{M}]*(?: [\p{L}\p{M}][\p{L}\p{M}]*)?)(?:\s+(?:speaking|calling|here))?\b/iu,
  /\bcall me ([\p{L}\p{M}][\p{L}\p{M}]*(?: [\p{L}\p{M}][\p{L}\p{M}]*)?)\b/iu,
  /\bname(?:'s| is) ([\p{L}\p{M}][\p{L}\p{M}]*(?: [\p{L}\p{M}][\p{L}\p{M}]*)?)\b/iu,
  // Tamil: "என் பேர் <name>" / "என்னோட பேர் <name>"
  /என்(?:னோட)?\s*பேர்\s+([\p{L}\p{M}][\p{L}\p{M}]*(?:\s[\p{L}\p{M}][\p{L}\p{M}]*)?)/u,
  // Hindi: "मेरा नाम <name>" / "मैं <name> हूँ"
  /मेरा\s*नाम\s+([\p{L}\p{M}][\p{L}\p{M}]*(?:\s[\p{L}\p{M}][\p{L}\p{M}]*)?)/u,
];

const NAME_STOPWORDS = new Set([
  "sure", "sorry", "good", "fine", "here", "happy", "okay", "just",
  "calling", "speaking", "back", "checking", "looking", "trying",
  "not", "also", "right", "ready", "interested",
]);

export async function latchCallerName(opts: {
  agentId: number;
  phoneNumber: string;
  transcript: string;
  existingName: string | null;
  callId: number;
}): Promise<string | null> {
  const { agentId, transcript, existingName, callId } = opts;
  const phoneNumber = canonicalizeCallerKey(opts.phoneNumber) ?? opts.phoneNumber;

  let detected: string | null = null;
  for (const pattern of NAME_PATTERNS) {
    const match = transcript.match(pattern);
    const candidate = match?.[1]?.trim();
    if (candidate && !NAME_STOPWORDS.has(candidate.toLowerCase())) {
      detected = candidate;
      break;
    }
  }

  if (!detected) return null;
  if (detected.toLowerCase() === existingName?.toLowerCase()) return null;

  try {
    await db
      .update(callerProfilesTable)
      .set({ name: detected, updatedAt: new Date() })
      .where(and(
        eq(callerProfilesTable.agentId,     agentId),
        eq(callerProfilesTable.phoneNumber, phoneNumber),
      ));
    logger.info({ callId, agentId, phoneNumber, detectedName: detected }, "Caller name latched in real-time");
    return detected;
  } catch (err) {
    logger.warn({ callId, agentId, phoneNumber, err }, "Real-time caller name latch DB write failed");
    return null;
  }
}

// ── Real-time fact latch — uses supersession graph ────────────────────────────

interface FactPattern {
  key: string;
  patterns: RegExp[];
  extract: (match: RegExpMatchArray) => string;
  confidence: number;
}

const FACT_PATTERNS: FactPattern[] = [
  {
    key: "age",
    patterns: [
      /\bi(?:'m| am) (\d{1,3}) years? old\b/i,
      /\bmy age is (\d{1,3})\b/i,
      /\b(\d{1,3}) years? old\b/i,
    ],
    extract: m => m[1]!,
    confidence: 0.9,
  },
  {
    key: "family_size",
    patterns: [
      /\bfamily of (\d+)\b/i,
      /\b(\d+) (?:family )?members?\b/i,
      /\b(\d+) (?:kids?|children|sons?|daughters?)\b/i,
    ],
    extract: m => m[1]!,
    confidence: 0.85,
  },
  {
    key: "children_count",
    patterns: [
      /\b(\d+) (?:kids?|children)\b/i,
      /\bi have (\d+) (?:kids?|children|sons?|daughters?)\b/i,
    ],
    extract: m => m[1]!,
    confidence: 0.85,
  },
  {
    key: "location",
    patterns: [
      /\bi(?:'m| am) (?:from|in|based in|calling from) ([A-Z][a-zA-Z\s]{2,30}?)(?:\.|,|$)/,
      /\bi live in ([A-Z][a-zA-Z\s]{2,30}?)(?:\.|,|$)/,
    ],
    extract: m => m[1]!.trim(),
    confidence: 0.85,
  },
  {
    key: "occupation",
    patterns: [
      /\bi(?:'m| am) a(?:n)? ([a-zA-Z\s]{3,40}?) (?:by profession|by trade|working as)\b/i,
      /\bi work as (?:a(?:n)? )?([a-zA-Z\s]{3,40}?)\b(?:\.|,|$)/i,
    ],
    extract: m => m[1]!.trim(),
    confidence: 0.8,
  },
  {
    key: "budget_range",
    patterns: [
      /\bbudget (?:of |is |around )?(?:₹|rs\.?|inr)?\s?(\d[\d,]*)\b/i,
      /\bcan (?:spend|afford|pay) (?:up to |around |about )?(?:₹|rs\.?|inr)?\s?(\d[\d,]*)\b/i,
      /\b(?:₹|rs\.?|inr)\s?(\d[\d,]+)\s*(?:per year|monthly|p\.?a\.?|\/year|\/month)?\b/i,
    ],
    extract: m => m[1]!.replace(/,/g, ""),
    confidence: 0.85,
  },
];

/**
 * Pattern-based fact detection on every user utterance.
 * Uses supersedeFact so changing facts are properly tracked in the graph.
 * Returns an updated map of (key → value) for the current call session.
 */
export async function latchCallerFact(opts: {
  agentId: number;
  phoneNumber: string;
  transcript: string;
  callId: number;
  existingFacts: Map<string, string>;
}): Promise<Map<string, string>> {
  const { agentId, transcript, callId, existingFacts } = opts;
  const phoneNumber = canonicalizeCallerKey(opts.phoneNumber) ?? opts.phoneNumber;
  const updated = new Map(existingFacts);

  for (const fp of FACT_PATTERNS) {
    // Within-call dedup: skip if already detected this call
    if (updated.has(fp.key)) continue;

    for (const pattern of fp.patterns) {
      const match = transcript.match(pattern);
      if (!match) continue;

      let value: string;
      try { value = fp.extract(match).trim(); } catch { continue; }
      if (!value || value.length > 200) continue;

      // Use supersedeFact — handles insert vs supersession automatically
      const factId = await supersedeFact({
        agentId, phoneNumber,
        key:          fp.key,
        value,
        confidence:   fp.confidence,
        sourceCallId: callId,
        sourceSentenceIds: [],  // sentences not yet stored at this point
      });

      if (factId !== null) {
        updated.set(fp.key, value);
        logger.info({ callId, agentId, phoneNumber, key: fp.key, value }, "Caller fact latched in real-time");
      }
      break;
    }
  }

  return updated;
}

// ── Detect callback requests ──────────────────────────────────────────────────

export async function detectCallbackRequest(opts: {
  agentId: number;
  toNumber: string;
  userId?: string | null;
  history: ConversationTurn[];
  llm: LLMAdapter;
  callId: number;
  campaignLeadId?: number | null;
}): Promise<void> {
  const { agentId, toNumber, userId, history, llm, callId, campaignLeadId } = opts;

  if (history.length < 2) return;

  const transcript = history.map(t => `${t.role === "user" ? "Caller" : "Agent"}: ${t.content}`).join("\n");

  let raw = "";
  await llm.chat(
    [{
      role: "user",
      content:
        `Analyze this call transcript and determine if the caller explicitly requested a callback after a specific delay.\n` +
        `Return ONLY valid JSON with these fields:\n` +
        `- "callbackRequested": true if caller said something like "call me back", "call me in X minutes", "call me after X mins", otherwise false\n` +
        `- "delayMinutes": the number of minutes until callback (integer), or null if not applicable\n\n` +
        `Transcript:\n${transcript.slice(0, 4000)}`,
    }],
    "You detect callback scheduling requests in voice call transcripts. Return only a JSON object with 'callbackRequested' (boolean) and 'delayMinutes' (integer|null). Be conservative — only return true if the caller explicitly asked to be called back after a specific duration.",
    () => {},
    (full) => { raw = full; },
  );

  let extracted: { callbackRequested?: boolean; delayMinutes?: number | null } = {};
  try {
    const jsonStr = raw
      .replace(/<think>[\s\S]*?<\/think>/g, "")
      .replace(/```(?:json)?\s*/g, "")
      .replace(/\s*```\s*/g, "")
      .trim();
    extracted = JSON.parse(jsonStr) as typeof extracted;
  } catch {
    logger.warn({ callId, agentId }, "detectCallbackRequest JSON parse failed");
    return;
  }

  if (!extracted.callbackRequested || !extracted.delayMinutes || extracted.delayMinutes < 1) return;

  const scheduledAt = new Date(Date.now() + extracted.delayMinutes * 60_000);

  try {
    await db.insert(scheduledCallbacksTable).values({
      agentId,
      userId:              userId ?? null,
      toNumber:            toNumber,
      scheduledAt,
      createdFromCallId:   callId ?? null,
      campaignLeadId:      campaignLeadId ?? null,
    });
    logger.info({ callId, agentId, toNumber, delayMinutes: extracted.delayMinutes, scheduledAt }, "Callback scheduled");
  } catch (err) {
    logger.warn({ callId, agentId, toNumber, err }, "Callback schedule DB write failed");
  }
}
