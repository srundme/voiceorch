/**
 * Forget a caller on one agent: facts, episodes, profile memory, voiceprint.
 * The caller_profiles row stays so the identity key is not recreated mid-call.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  callerProfilesTable,
  callerFactsTable,
  callerCallArchiveTable,
  callerSentencesTable,
  callerFactSentenceLinksTable,
  callerEpisodeFactLinksTable,
  callerVoiceprintsTable,
  pendingCallerFactsTable,
  canonicalizeCallerKey,
} from "@workspace/db";
import { logger } from "../lib/logger.js";
import { lastTenDigits } from "../lib/intake-call-context.js";

function lastTenEq(column: unknown, tail: string) {
  return sql`right(regexp_replace(coalesce(${column as never}, ''), '[^0-9]', '', 'g'), 10) = ${tail}`;
}

async function memoryKeysForPhone(agentId: number, phone: string): Promise<string[]> {
  const keys = new Set<string>();
  const canonical = canonicalizeCallerKey(phone);
  if (canonical) keys.add(canonical);
  const tail = lastTenDigits(phone);
  if (!tail) return [...keys];

  const [profiles, facts, archive, prints, pending] = await Promise.all([
    db.select({ phoneNumber: callerProfilesTable.phoneNumber })
      .from(callerProfilesTable)
      .where(and(eq(callerProfilesTable.agentId, agentId), lastTenEq(callerProfilesTable.phoneNumber, tail))),
    db.select({ phoneNumber: callerFactsTable.phoneNumber })
      .from(callerFactsTable)
      .where(and(eq(callerFactsTable.agentId, agentId), lastTenEq(callerFactsTable.phoneNumber, tail))),
    db.select({ phoneNumber: callerCallArchiveTable.phoneNumber })
      .from(callerCallArchiveTable)
      .where(and(eq(callerCallArchiveTable.agentId, agentId), lastTenEq(callerCallArchiveTable.phoneNumber, tail))),
    db.select({ phoneNumber: callerVoiceprintsTable.phoneNumber })
      .from(callerVoiceprintsTable)
      .where(and(eq(callerVoiceprintsTable.agentId, agentId), lastTenEq(callerVoiceprintsTable.phoneNumber, tail))),
    db.select({ phoneNumber: pendingCallerFactsTable.phoneNumber })
      .from(pendingCallerFactsTable)
      .where(and(eq(pendingCallerFactsTable.agentId, agentId), lastTenEq(pendingCallerFactsTable.phoneNumber, tail))),
  ]);
  for (const row of [...profiles, ...facts, ...archive, ...prints, ...pending]) {
    if (row.phoneNumber) keys.add(row.phoneNumber);
  }
  return [...keys];
}

async function wipeOneKey(agentId: number, phoneNumber: string, clerkId?: string | null): Promise<void> {
  await db.update(callerFactsTable)
    .set({ supersededById: null })
    .where(and(eq(callerFactsTable.agentId, agentId), eq(callerFactsTable.phoneNumber, phoneNumber)));

  const [episodeRows, factRows] = await Promise.all([
    db.select({ id: callerCallArchiveTable.id })
      .from(callerCallArchiveTable)
      .where(and(eq(callerCallArchiveTable.agentId, agentId), eq(callerCallArchiveTable.phoneNumber, phoneNumber))),
    db.select({ id: callerFactsTable.id })
      .from(callerFactsTable)
      .where(and(eq(callerFactsTable.agentId, agentId), eq(callerFactsTable.phoneNumber, phoneNumber))),
  ]);
  const episodeIds = episodeRows.map((e) => e.id);
  const factIds = factRows.map((f) => f.id);

  if (factIds.length > 0) {
    await db.delete(callerFactSentenceLinksTable).where(inArray(callerFactSentenceLinksTable.factId, factIds));
    await db.delete(callerEpisodeFactLinksTable).where(inArray(callerEpisodeFactLinksTable.factId, factIds));
  }
  if (episodeIds.length > 0) {
    await db.delete(callerEpisodeFactLinksTable).where(inArray(callerEpisodeFactLinksTable.episodeId, episodeIds));
    await db.delete(callerSentencesTable).where(inArray(callerSentencesTable.episodeId, episodeIds));
  }

  await db.delete(pendingCallerFactsTable)
    .where(and(eq(pendingCallerFactsTable.agentId, agentId), eq(pendingCallerFactsTable.phoneNumber, phoneNumber)));
  await db.delete(callerFactsTable)
    .where(and(eq(callerFactsTable.agentId, agentId), eq(callerFactsTable.phoneNumber, phoneNumber)));
  await db.delete(callerCallArchiveTable)
    .where(and(eq(callerCallArchiveTable.agentId, agentId), eq(callerCallArchiveTable.phoneNumber, phoneNumber)));

  await db.update(callerProfilesTable)
    .set({
      summary: null,
      name: null,
      callCount: 0,
      predictedIntent: null,
      sentimentTrend: null,
      riskScore: null,
      lastCallDropped: false,
      lastCallDroppedAt: null,
      preferredLanguage: null,
      updatedAt: new Date(),
    })
    .where(and(eq(callerProfilesTable.agentId, agentId), eq(callerProfilesTable.phoneNumber, phoneNumber)));

  try {
    const { resolveSquadMemoryOwnerAgentId } = await import("../services/squad-teamwork.js");
    const ownerAgentId = clerkId
      ? await resolveSquadMemoryOwnerAgentId(agentId, clerkId)
      : agentId;
    await db.delete(callerVoiceprintsTable)
      .where(and(
        inArray(callerVoiceprintsTable.agentId, [...new Set([agentId, ownerAgentId])]),
        eq(callerVoiceprintsTable.phoneNumber, phoneNumber),
      ));
  } catch (err) {
    logger.warn({ err, agentId, phoneNumber }, "Caller memory delete: voiceprint cleanup failed");
  }
}

export async function wipeCallerMemoryForPhone(opts: {
  agentId: number;
  phone: string;
  clerkId?: string | null;
}): Promise<{ keys: string[] }> {
  const keys = await memoryKeysForPhone(opts.agentId, opts.phone);
  for (const key of keys) {
    await wipeOneKey(opts.agentId, key, opts.clerkId);
  }
  return { keys };
}
