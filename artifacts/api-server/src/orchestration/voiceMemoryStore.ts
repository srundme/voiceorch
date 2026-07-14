/**
 * Voice Memory — persist / match ECAPA embeddings per agent.
 * Phone-keyed caller memory stays primary; voice only LINKS phones to a personKey
 * and can suggest an alternate memory phone when the same voice dials a new number.
 */

import { createHash, randomUUID } from "node:crypto";
import { and, eq, ne, sql } from "drizzle-orm";
import { db, callerVoiceprintsTable, canonicalizeCallerKey } from "@workspace/db";
import { logger } from "../lib/logger.js";

/** Hard match for cross-number same-person (stricter). */
export const VOICE_MATCH_THRESHOLD = Number(process.env["VOICE_MEMORY_MATCH_THRESHOLD"] ?? 0.82);
/** Soft mid-call handoff alert (more sensitive). */
export const VOICE_HANDOFF_THRESHOLD = Number(process.env["VOICE_MEMORY_HANDOFF_THRESHOLD"] ?? 0.72);

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

/** Find best voice match for this agent (excluding optional phone). */
export async function findBestVoiceMatch(opts: {
  agentId: number;
  embedding: number[];
  excludePhone?: string | null;
}): Promise<VoiceMatchResult | null> {
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

    let best: VoiceMatchResult | null = null;
    for (const row of rows) {
      const emb = row.embedding as number[];
      const score = cosine(embedding, emb);
      if (score < VOICE_MATCH_THRESHOLD) continue;
      if (!best || score > best.score) {
        best = {
          personKey: row.personKey,
          matchedPhone: row.phoneNumber,
          score,
          samePhone: false,
        };
      }
    }
    return best;
  } catch (err) {
    logger.warn({ err, agentId }, "Voice memory: findBestVoiceMatch failed");
    return null;
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
}): Promise<{ personKey: string; linkedFromPhone: string | null; score: number | null }> {
  const phoneNumber = canonicalizeCallerKey(opts.phoneNumber) ?? opts.phoneNumber;
  const { agentId, embedding, displayName } = opts;

  const cross = await findBestVoiceMatch({ agentId, embedding, excludePhone: phoneNumber });
  let personKey = cross?.personKey ?? randomUUID();
  const linkedFromPhone = cross?.matchedPhone ?? null;
  const score = cross?.score ?? opts.score ?? null;

  try {
    const [existing] = await db
      .select({ personKey: callerVoiceprintsTable.personKey })
      .from(callerVoiceprintsTable)
      .where(and(
        eq(callerVoiceprintsTable.agentId, agentId),
        eq(callerVoiceprintsTable.phoneNumber, phoneNumber),
      ))
      .limit(1);
    if (existing?.personKey) {
      if (cross && cross.score >= VOICE_MATCH_THRESHOLD) {
        personKey = cross.personKey;
      } else {
        personKey = existing.personKey;
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

  return { personKey, linkedFromPhone, score };
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
