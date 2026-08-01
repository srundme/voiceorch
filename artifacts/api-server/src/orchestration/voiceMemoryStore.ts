/**
 * Voice Memory — persist / match ECAPA embeddings per agent.
 * Phone-keyed caller memory stays primary; voice only LINKS phones to a personKey
 * and can suggest an alternate memory phone when the same voice dials a new number.
 */

import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db, callerVoiceprintsTable, callerProfilesTable, canonicalizeCallerKey } from "@workspace/db";
import { logger } from "../lib/logger.js";

/** Hard match for cross-number same-person (stricter). */
export const VOICE_MATCH_THRESHOLD = Number(process.env["VOICE_MEMORY_MATCH_THRESHOLD"] ?? 0.82);
/** Soft mid-call handoff alert (more sensitive). */
export const VOICE_HANDOFF_THRESHOLD = Number(process.env["VOICE_MEMORY_HANDOFF_THRESHOLD"] ?? 0.72);
/**
 * Soft floor for NAME-CORROBORATED cross-number linking. 8kHz telephony audio
 * through a 16kHz-trained embedder drags same-person cross-device scores far
 * below the hard bar (observed 0.42-0.46 for a confirmed same speaker), so a
 * voice that is at least "somewhat similar" PLUS the same stated caller name
 * is accepted as the same person.
 */
export const VOICE_SOFT_MATCH_THRESHOLD = Number(process.env["VOICE_MEMORY_SOFT_MATCH_THRESHOLD"] ?? 0.40);

/**
 * Adaptive score normalization (AS-norm / S-norm). Instead of judging the raw
 * cosine on an absolute bar, judge it RELATIVE to how this voice scores
 * against a cohort of OTHER callers of the same agent (impostors). On 8kHz
 * telephony where all raw scores are compressed downward, a raw 0.45 that
 * sits several standard deviations above the impostor crowd is strong
 * evidence of a true match.
 */
/** Minimum number of different-person cohort prints required to trust normalization. */
export const VOICE_ASNORM_MIN_COHORT = Number(process.env["VOICE_MEMORY_ASNORM_MIN_COHORT"] ?? 8);
/** Normalized-score acceptance bar, in std-dev units above the impostor mean. */
export const VOICE_ASNORM_THRESHOLD = Number(process.env["VOICE_MEMORY_ASNORM_THRESHOLD"] ?? 4.0);
/** Top-K cohort scores used for the adaptive statistics (per side). */
const VOICE_ASNORM_TOP_K = Number(process.env["VOICE_MEMORY_ASNORM_TOP_K"] ?? 50);
/** Std floor — tiny cohorts can produce degenerate (near-zero) std. */
const ASNORM_STD_FLOOR = 0.02;

/** Mean/std of the top-K highest values. */
function topKStats(scores: number[], k: number): { mean: number; std: number; n: number } | null {
  if (scores.length === 0) return null;
  const top = [...scores].sort((a, b) => b - a).slice(0, Math.max(1, k));
  const mean = top.reduce((s, v) => s + v, 0) / top.length;
  const variance = top.reduce((s, v) => s + (v - mean) * (v - mean), 0) / top.length;
  return { mean, std: Math.sqrt(variance), n: top.length };
}

/** Normalize a caller name for corroboration compare (case/space/punct-insensitive). */
function normalizeName(name: string | null | undefined): string | null {
  if (!name) return null;
  const n = name.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
  return n.length >= 2 ? n : null;
}

function cosine(a: number[], b: number[]): number {
  if (!a?.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na <= 0 || nb <= 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface VoiceMatchResult {
  personKey: string;
  matchedPhone: string;
  score: number;
  samePhone: boolean;
}

export interface VoiceMatchOutcome {
  match: VoiceMatchResult | null;
  /** Best candidate that scored BELOW the match bar (diagnostics + name-corroborated linking). */
  nearMiss: {
    score: number;
    phoneNumber: string;
    personKey: string;
    margin: number | null;
    /** AS-norm score in std-dev units above the impostor cohort mean (null = cohort too small). */
    normScore: number | null;
    /** True when the normalized score cleared VOICE_ASNORM_THRESHOLD. */
    asnormAccept: boolean;
  } | null;
}

/** Find best voice match for this agent (excluding optional phone). */
export async function findBestVoiceMatch(opts: {
  agentId: number;
  embedding: number[];
  excludePhone?: string | null;
}): Promise<VoiceMatchOutcome> {
  const { agentId, embedding, excludePhone } = opts;
  try {
    const rows = await db
      .select({
        personKey:   callerVoiceprintsTable.personKey,
        phoneNumber: callerVoiceprintsTable.phoneNumber,
        embedding:   callerVoiceprintsTable.embedding,
      })
      .from(callerVoiceprintsTable)
      .where(
        excludePhone
          ? and(
              eq(callerVoiceprintsTable.agentId, agentId),
              ne(callerVoiceprintsTable.phoneNumber, excludePhone),
            )
          : eq(callerVoiceprintsTable.agentId, agentId),
      )
      .limit(200);

    // Track the best candidate even below the match bar — a silent `continue`
    // made sub-threshold near-misses invisible (calls 5029-5031: "not
    // recognised" with no score anywhere in the logs).
    const scored: { row: (typeof rows)[number]; score: number }[] = [];
    let best: VoiceMatchResult | null = null;
    let secondScore: number | null = null;
    for (const row of rows) {
      const emb = row.embedding as number[];
      const score = cosine(embedding, emb);
      scored.push({ row, score });
      if (!best || score > best.score) {
        if (best && best.personKey !== row.personKey) secondScore = best.score;
        best = {
          personKey: row.personKey,
          matchedPhone: row.phoneNumber,
          score,
          samePhone: false,
        };
      } else if (row.personKey !== best.personKey && (secondScore == null || score > secondScore)) {
        secondScore = score;
      }
    }
    // margin = separation of the best candidate from the next-best DIFFERENT
    // person — high margin means "clearly closer to this person than anyone
    // else", useful for tuning and for future relative-decision logic.
    const margin = best && secondScore != null ? best.score - secondScore : null;
    if (best && best.score < VOICE_MATCH_THRESHOLD) {
      // ---- AS-norm (S-norm): judge the raw score relative to the impostor cohort. ----
      // Cohort = prints belonging to persons OTHER than the best candidate.
      let normScore: number | null = null;
      let asnormAccept = false;
      const bestPersonKey = best.personKey;
      const cohort = scored.filter((s) => s.row.personKey !== bestPersonKey);
      if (cohort.length >= VOICE_ASNORM_MIN_COHORT) {
        // z-side: fresh (test) embedding vs cohort — scores already computed.
        const zStats = topKStats(cohort.map((c) => c.score), VOICE_ASNORM_TOP_K);
        // t-side: the CANDIDATE's enrolled embedding vs the same cohort.
        const bestEmb = scored.find((s) => s.row.phoneNumber === best!.matchedPhone)?.row.embedding as number[] | undefined;
        const tScores = bestEmb ? cohort.map((c) => cosine(bestEmb, c.row.embedding as number[])) : [];
        const tStats = topKStats(tScores, VOICE_ASNORM_TOP_K);
        if (zStats && tStats) {
          const zStd = Math.max(zStats.std, ASNORM_STD_FLOOR);
          const tStd = Math.max(tStats.std, ASNORM_STD_FLOOR);
          normScore = 0.5 * ((best.score - zStats.mean) / zStd + (best.score - tStats.mean) / tStd);
          // Relative acceptance still requires a minimal absolute floor —
          // a voice that towers over strangers but is barely similar at all
          // (raw < soft floor) is not trusted.
          asnormAccept = normScore >= VOICE_ASNORM_THRESHOLD && best.score >= VOICE_SOFT_MATCH_THRESHOLD;
        }
      }
      logger.info(
        {
          agentId, bestScore: best.score, bestPhone: best.matchedPhone, margin,
          threshold: VOICE_MATCH_THRESHOLD, cohortSize: cohort.length, normScore, asnormAccept,
        },
        "Voice memory: best cross-number candidate below match threshold",
      );
      return {
        match: null,
        nearMiss: {
          score: best.score, phoneNumber: best.matchedPhone, personKey: best.personKey,
          margin, normScore, asnormAccept,
        },
      };
    }
    return { match: best, nearMiss: null };
  } catch (err) {
    logger.warn({ err, agentId }, "Voice memory: findBestVoiceMatch failed");
    return { match: null, nearMiss: null };
  }
}

/**
 * Upsert this phone's voiceprint. If embedding matches another phone's print,
 * reuse that personKey (cross-number identity). Returns the personKey used.
 */
export async function upsertCallerVoiceprint(opts: {
  agentId: number;
  phoneNumber: string;
  embedding: number[];
  displayName?: string | null;
  score?: number | null;
}): Promise<{
  personKey: string;
  linkedFromPhone: string | null;
  score: number | null;
  nearMiss: { score: number; phoneNumber: string } | null;
}> {
  const phoneNumber = canonicalizeCallerKey(opts.phoneNumber) ?? opts.phoneNumber;
  const { agentId, embedding, displayName } = opts;

  const outcome = await findBestVoiceMatch({ agentId, embedding, excludePhone: phoneNumber });
  let cross = outcome.match;
  const nearMiss = outcome.nearMiss;

  // Fetch this phone's existing voiceprint row up-front — the soft-link and
  // personKey decisions below both depend on it.
  let existingPersonKey: string | null = null;
  try {
    const [existing] = await db
      .select({ personKey: callerVoiceprintsTable.personKey })
      .from(callerVoiceprintsTable)
      .where(and(
        eq(callerVoiceprintsTable.agentId, agentId),
        eq(callerVoiceprintsTable.phoneNumber, phoneNumber),
      ))
      .limit(1);
    existingPersonKey = existing?.personKey ?? null;
  } catch { /* non-fatal */ }

  // Name-corroborated soft link: telephony scores for the SAME person across
  // devices routinely land well below the hard bar (16k-trained embedder on
  // 8k audio). If the best candidate is at least somewhat similar AND both
  // phones' caller profiles carry the same stated name, accept the link.
  // Guards against wrong merges (common names): requires a clear margin over
  // the next-best DIFFERENT person, a meaningful name, and NEVER re-assigns a
  // phone that already belongs to a DIFFERENT person cluster on soft evidence
  // alone — only a hard-threshold match may do that.
  const softLinkAllowed =
    !existingPersonKey || (nearMiss ? existingPersonKey === nearMiss.personKey : false);

  // AS-norm relative link: the fresh voice scored far above the impostor
  // cohort (several std-devs) even though the raw score sits below the hard
  // bar. Same cluster-safety rule as all soft evidence: never re-assigns a
  // phone already in a DIFFERENT person cluster.
  if (!cross && nearMiss && softLinkAllowed && nearMiss.asnormAccept) {
    cross = { personKey: nearMiss.personKey, matchedPhone: nearMiss.phoneNumber, score: nearMiss.score, samePhone: false };
    logger.info(
      { agentId, phoneNumber, matchedPhone: nearMiss.phoneNumber, score: nearMiss.score, normScore: nearMiss.normScore },
      "Voice memory: AS-norm cross-number link (voice far above impostor cohort)",
    );
  }

  if (
    !cross && nearMiss && softLinkAllowed
    && nearMiss.score >= VOICE_SOFT_MATCH_THRESHOLD
    && (nearMiss.margin == null || nearMiss.margin >= 0.10)
  ) {
    try {
      const phones = [phoneNumber, nearMiss.phoneNumber];
      const profiles = await db
        .select({ phoneNumber: callerProfilesTable.phoneNumber, name: callerProfilesTable.name })
        .from(callerProfilesTable)
        .where(and(
          eq(callerProfilesTable.agentId, agentId),
          inArray(callerProfilesTable.phoneNumber, phones),
        ));
      const myName = normalizeName(profiles.find((p) => p.phoneNumber === phoneNumber)?.name);
      const theirName = normalizeName(profiles.find((p) => p.phoneNumber === nearMiss.phoneNumber)?.name);
      if (myName && theirName && myName === theirName && myName.length >= 3) {
        cross = { personKey: nearMiss.personKey, matchedPhone: nearMiss.phoneNumber, score: nearMiss.score, samePhone: false };
        logger.info(
          { agentId, phoneNumber, matchedPhone: nearMiss.phoneNumber, score: nearMiss.score, name: myName },
          "Voice memory: name-corroborated cross-number link (voice similar + same caller name)",
        );
      }
    } catch (err) {
      logger.warn({ err, agentId }, "Voice memory: name corroboration lookup failed");
    }
  }

  let personKey = cross?.personKey ?? randomUUID();
  let linkedFromPhone = cross?.matchedPhone ?? null;
  const score = cross?.score ?? opts.score ?? null;

  try {
    if (existingPersonKey) {
      // Adopt the matched cluster's personKey only on a hard-threshold match,
      // or on a soft match that doesn't move the phone between clusters
      // (softLinkAllowed guaranteed that above). Otherwise keep the existing key.
      personKey = cross ? cross.personKey : existingPersonKey;
    }
    // Sticky link: if this phone's personKey is ALREADY shared with another
    // phone (linked on a previous call), honor that link even when today's
    // fresh sample scores below the match bar — cross-device/line variation
    // makes raw scores unreliable, but an established link is ground truth.
    if (!linkedFromPhone) {
      const siblings = await listPhonesForPerson({ agentId, personKey, excludePhone: phoneNumber });
      if (siblings.length > 0) {
        linkedFromPhone = siblings[0];
        logger.info(
          { agentId, phoneNumber, linkedFromPhone },
          "Voice memory: phone already linked to another number via shared personKey — honoring stored link",
        );
      }
    }
  } catch { /* non-fatal */ }

  const now = new Date();
  try {
    await db
      .insert(callerVoiceprintsTable)
      .values({
        agentId,
        personKey,
        phoneNumber,
        embedding,
        displayName: displayName ?? null,
        matchCount: 1,
        lastScore: score,
        lastSeenAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [callerVoiceprintsTable.agentId, callerVoiceprintsTable.phoneNumber],
        set: {
          personKey,
          embedding,
          ...(displayName != null ? { displayName } : {}),
          lastScore: score,
          lastSeenAt: now,
          updatedAt: now,
          matchCount: sql`${callerVoiceprintsTable.matchCount} + 1`,
        },
      });
  } catch (err) {
    logger.warn({ err, agentId, phoneNumber }, "Voice memory: upsert failed — retrying simple update");
    try {
      await db
        .update(callerVoiceprintsTable)
        .set({
          personKey,
          embedding,
          displayName: displayName ?? null,
          lastScore: score,
          lastSeenAt: now,
          updatedAt: now,
        })
        .where(and(
          eq(callerVoiceprintsTable.agentId, agentId),
          eq(callerVoiceprintsTable.phoneNumber, phoneNumber),
        ));
    } catch (err2) {
      logger.warn({ err2, agentId, phoneNumber }, "Voice memory: upsert retry failed");
    }
  }

  logger.info(
    {
      agentId,
      phoneNumber,
      personKeyHash: createHash("sha256").update(personKey).digest("hex").slice(0, 12),
      linkedFromPhone: linkedFromPhone ? "yes" : "no",
      score,
    },
    "Voice memory: voiceprint upserted",
  );

  return { personKey, linkedFromPhone, score, nearMiss };
}

/** Other phones sharing this personKey (for memory redirect). */
export async function listPhonesForPerson(opts: {
  agentId: number;
  personKey: string;
  excludePhone?: string | null;
}): Promise<string[]> {
  const rows = await db
    .select({ phoneNumber: callerVoiceprintsTable.phoneNumber })
    .from(callerVoiceprintsTable)
    .where(and(
      eq(callerVoiceprintsTable.agentId, opts.agentId),
      eq(callerVoiceprintsTable.personKey, opts.personKey),
    ));
  return rows
    .map((r) => r.phoneNumber)
    .filter((p) => p && p !== opts.excludePhone);
}
