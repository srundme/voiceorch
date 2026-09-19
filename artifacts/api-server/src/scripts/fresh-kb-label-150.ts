/**
 * Fresh holdout 150 for frozen Phase 3C (Strategy B). Does not change builder code.
 * Excludes call IDs from the first labelled set.
 *
 *   DATABASE_URL=... ./node_modules/.bin/tsx src/scripts/fresh-kb-label-150.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { db, callsTable, agentsTable, knowledgeEntriesTable, knowledgeSourcesTable } from "@workspace/db";
import { decideKbRetrieval } from "../orchestration/kb-retrieval-gate.js";
import {
  harvestOfferingNamesFromText,
  kbHitSummary,
  recentKbTurns,
  runKbQueryBuilder,
  runKbQueryBuilderConservative,
  type KbActiveEntity,
} from "../orchestration/kb-query-builder.js";
import { getAttachedSourceIds, retrieveKbContextMultiEx, isPureNonLatinQuery, listKbOfferingTitles } from "../orchestration/kb-retrieval.js";

type Turn = { role: "user" | "assistant"; content: string };
type Row = {
  callId: number;
  agentId: number;
  turn: number;
  utterance: string;
  utteranceClass: string;
  gateDecision: string;
  gateReason: string;
  rawQuery: string;
  aQuery: string;
  bQuery: string;
  bLevel: number;
  bEntity: string | null;
  bTopic: string | null;
  queryStrategy: string;
  contextualized: boolean;
  context: string;
  rawTopHit: string | null;
  bTopHit: string | null;
  rawSnippet: string | null;
  bSnippet: string | null;
  labels: {
    shouldRetrieve: string;
    correctEntity: string;
    correctTopic: string;
    rawTopHitRelevant: string;
    builtTopHitRelevant: string;
    builtQueryContaminated: string;
  };
};

function parseTurns(raw: string | null | undefined): Turn[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((l) => {
        const role = String((l as { role?: string })?.role ?? "");
        const content = String((l as { content?: string })?.content ?? "").trim();
        if (!content) return null;
        if (role === "user" || role === "caller") return { role: "user" as const, content };
        if (role === "assistant" || role === "agent") return { role: "assistant" as const, content };
        return null;
      }).filter((x): x is Turn => x != null);
    }
  } catch { /* plain */ }
  const out: Turn[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const agent = line.match(/^Agent:\s*([\s\S]*)/i);
    if (agent?.[1]?.trim()) { out.push({ role: "assistant", content: agent[1].trim() }); continue; }
    const caller = line.match(/^Caller:\s*([\s\S]*)/i);
    if (caller?.[1]?.trim()) out.push({ role: "user", content: caller[1].trim() });
  }
  return out;
}

function windowAround(turns: Turn[], userTurn: number): string {
  let n = 0;
  const idx = turns.findIndex((t) => {
    if (t.role === "user") { n += 1; return n === userTurn; }
    return false;
  });
  if (idx < 0) return "";
  return turns.slice(Math.max(0, idx - 4), idx + 1).map((t) => {
    const role = t.role === "assistant" ? "Agent" : "Caller";
    return `${role}: ${t.content.replace(/\s+/g, " ").trim().slice(0, 220)}`;
  }).join("\n");
}

function hasIndic(text: string): boolean {
  return /[\u0900-\u0D7F]/.test(text);
}

function pickLabelSet(rows: Row[], limit: number): Row[] {
  const buckets: Record<string, Row[]> = {
    knowledge_ta: [], knowledge_en: [], language_control: [], acknowledgement: [],
    unclear_ta: [], unclear_en: [], other_skip: [],
  };
  for (const r of rows) {
    const ta = hasIndic(r.utterance);
    if (r.utteranceClass === "knowledge_query") buckets[ta ? "knowledge_ta" : "knowledge_en"]!.push(r);
    else if (r.utteranceClass === "language_control") buckets.language_control!.push(r);
    else if (r.utteranceClass === "acknowledgement") buckets.acknowledgement!.push(r);
    else if (r.utteranceClass === "unclear") buckets[ta ? "unclear_ta" : "unclear_en"]!.push(r);
    else if (r.gateDecision === "skip") buckets.other_skip!.push(r);
    else buckets[ta ? "knowledge_ta" : "knowledge_en"]!.push(r);
  }
  const quotas: Array<[keyof typeof buckets, number]> = [
    ["knowledge_ta", 50], ["knowledge_en", 30], ["unclear_ta", 20],
    ["language_control", 20], ["acknowledgement", 15], ["unclear_en", 10], ["other_skip", 5],
  ];
  const out: Row[] = [];
  const used = new Set<string>();
  const take = (list: Row[], n: number) => {
    for (const r of list) {
      if (out.length >= limit || n <= 0) break;
      const key = `${r.callId}:${r.turn}`;
      if (used.has(key)) continue;
      used.add(key);
      out.push(r);
      n -= 1;
    }
  };
  for (const [key, n] of quotas) take(buckets[key] ?? [], n);
  if (out.length < limit) {
    for (const r of rows) {
      if (out.length >= limit) break;
      const key = `${r.callId}:${r.turn}`;
      if (used.has(key)) continue;
      used.add(key);
      out.push(r);
    }
  }
  return out.slice(0, limit);
}

async function catalog(sourceIds: number[]): Promise<string[]> {
  const titles = await listKbOfferingTitles(sourceIds);
  const harvested = [...titles];
  if (!sourceIds.length) return harvested;
  const [entries, sources] = await Promise.all([
    db.select({ title: knowledgeEntriesTable.title, content: knowledgeEntriesTable.content })
      .from(knowledgeEntriesTable).where(inArray(knowledgeEntriesTable.sourceId, sourceIds)),
    db.select({ name: knowledgeSourcesTable.name })
      .from(knowledgeSourcesTable).where(inArray(knowledgeSourcesTable.id, sourceIds)),
  ]);
  for (const s of sources) if (s.name) harvested.push(s.name);
  for (const e of entries) {
    if (e.title) harvested.push(e.title);
    harvested.push(...harvestOfferingNamesFromText((e.content ?? "").slice(0, 4000)));
  }
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const n of harvested) {
    const t = n.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(t);
  }
  return unique;
}

async function main() {
  const frozen = readFileSync("/tmp/kb-query-labels.jsonl", "utf8")
    .split(/\n/).filter(Boolean).map((l) => JSON.parse(l) as { callId: number });
  const excludeCalls = new Set(frozen.map((r) => r.callId));
  const since = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);

  const calls = await db
    .select({
      id: callsTable.id,
      agentId: callsTable.agentId,
      transcript: callsTable.transcript,
      knowledgeBaseId: agentsTable.knowledgeBaseId,
    })
    .from(callsTable)
    .innerJoin(agentsTable, eq(callsTable.agentId, agentsTable.id))
    .where(and(
      isNotNull(callsTable.transcript),
      gte(callsTable.createdAt, since),
      sql`coalesce(${callsTable.durationSeconds}, 0) >= 30`,
      sql`length(${callsTable.transcript}) > 80`,
    ))
    .orderBy(desc(callsTable.id))
    .limit(220);

  const holdout = calls.filter((c) => !excludeCalls.has(c.id));
  const sourceCache = new Map<number, number[]>();
  const catalogCache = new Map<number, string[]>();
  const titleCache = new Map<number, string[]>();
  const all: Row[] = [];

  for (const call of holdout) {
    const turns = parseTurns(call.transcript);
    if (!turns.some((t) => t.role === "user")) continue;
    let sourceIds = sourceCache.get(call.agentId);
    if (!sourceIds) {
      sourceIds = await getAttachedSourceIds(call.agentId, call.knowledgeBaseId);
      sourceCache.set(call.agentId, sourceIds);
    }
    if (!sourceIds.length) continue;
    let offeringsB = catalogCache.get(call.agentId);
    if (!offeringsB) {
      offeringsB = await catalog(sourceIds);
      catalogCache.set(call.agentId, offeringsB);
    }
    let offeringsA = titleCache.get(call.agentId);
    if (!offeringsA) {
      offeringsA = await listKbOfferingTitles(sourceIds);
      titleCache.set(call.agentId, offeringsA);
    }

    let entityA: KbActiveEntity | null = null;
    let topicA: string | null = null;
    let entityB: KbActiveEntity | null = null;
    let topicB: string | null = null;
    let topicTurnB: number | null = null;
    const history: Turn[] = [];
    let userTurn = 0;

    for (const turn of turns) {
      history.push(turn);
      if (turn.role !== "user") continue;
      userTurn += 1;
      const gate = decideKbRetrieval(turn.content, { knownOfferings: offeringsB });
      const prev = recentKbTurns(history);
      const a = runKbQueryBuilder({
        utterance: turn.content,
        previousAgentTurn: prev.previousAgentTurn,
        previousCallerTurn: prev.previousCallerTurn,
        activeEntity: entityA,
        activeTopic: topicA,
        knownOfferings: offeringsA,
        turnIndex: userTurn,
        utteranceClass: gate.utteranceClass,
      });
      entityA = a.activeEntity;
      topicA = a.activeTopic;
      const b = runKbQueryBuilderConservative({
        utterance: turn.content,
        previousAgentTurn: prev.previousAgentTurn,
        previousCallerTurn: prev.previousCallerTurn,
        activeEntity: entityB,
        activeTopic: topicB,
        knownOfferings: offeringsB,
        turnIndex: userTurn,
        utteranceClass: gate.utteranceClass,
        entityEstablishedTurn: entityB?.establishedTurn,
        topicEstablishedTurn: topicTurnB,
      });
      entityB = b.activeEntity;
      topicB = b.activeTopic;
      if (b.topicCleared) topicTurnB = null;
      else if (b.activeTopic) topicTurnB = userTurn;

      all.push({
        callId: call.id,
        agentId: call.agentId,
        turn: userTurn,
        utterance: turn.content,
        utteranceClass: gate.utteranceClass,
        gateDecision: gate.decision,
        gateReason: gate.reason,
        rawQuery: turn.content,
        aQuery: a.searchQuery,
        bQuery: b.searchQuery,
        bLevel: b.queryLevel,
        bEntity: b.activeEntity?.name ?? null,
        bTopic: b.activeTopic,
        queryStrategy: b.queryStrategy,
        contextualized: b.contextualized,
        context: windowAround(turns, userTurn),
        rawTopHit: null,
        bTopHit: null,
        rawSnippet: null,
        bSnippet: null,
        labels: {
          shouldRetrieve: "",
          correctEntity: "",
          correctTopic: "",
          rawTopHitRelevant: "",
          builtTopHitRelevant: "",
          builtQueryContaminated: "",
        },
      });
    }
  }

  const picked = pickLabelSet(all, 150);
  const hitCache = new Map<string, { topHit: string | null; snippet: string | null }>();
  const sourceByCall = new Map(holdout.map((c) => [c.id, c]));

  async function search(sourceIds: number[], query: string) {
    const key = `${[...sourceIds].sort((a, b) => a - b).join(",")}|${query}`;
    const cached = hitCache.get(key);
    if (cached) return cached;
    const res = await retrieveKbContextMultiEx(sourceIds, query, undefined, {
      skipFts: isPureNonLatinQuery(query),
    });
    const sum = kbHitSummary(res);
    const out = { topHit: sum.topHit, snippet: sum.snippet };
    hitCache.set(key, out);
    return out;
  }

  for (const row of picked) {
    const call = sourceByCall.get(row.callId);
    if (!call) continue;
    const sourceIds = sourceCache.get(call.agentId) ?? [];
    if (!sourceIds.length) continue;
    const rawHit = await search(sourceIds, row.rawQuery);
    row.rawTopHit = rawHit.topHit;
    row.rawSnippet = rawHit.snippet;
    const same = row.bQuery.trim().toLowerCase() === row.rawQuery.trim().toLowerCase();
    const bHit = same ? rawHit : await search(sourceIds, row.bQuery);
    row.bTopHit = bHit.topHit;
    row.bSnippet = bHit.snippet;
  }

  writeFileSync("/tmp/kb-query-labels-fresh.jsonl", picked.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const lines: string[] = [];
  for (let i = 0; i < picked.length; i++) {
    const r = picked[i]!;
    lines.push("=".repeat(80));
    lines.push(`#${String(i).padStart(3, "0")} call=${r.callId} t${r.turn} agent=${r.agentId} cls=${r.utteranceClass} gate=${r.gateDecision}/${r.gateReason} lvl=${r.bLevel}`);
    lines.push(`UTT: ${r.utterance}`);
    lines.push(`A: ${r.aQuery === r.rawQuery ? "== RAW" : r.aQuery}`);
    lines.push(`B: ${r.bQuery === r.rawQuery ? "== RAW" : r.bQuery}  ent=${r.bEntity} top=${r.bTopic}`);
    lines.push(`RAWHIT: ${r.rawTopHit}`);
    if (r.rawSnippet) lines.push(`RAWSN: ${r.rawSnippet}`);
    if (r.bTopHit !== r.rawTopHit) {
      lines.push(`BHIT: ${r.bTopHit}`);
      if (r.bSnippet) lines.push(`BSN: ${r.bSnippet}`);
    }
    lines.push("CTX:");
    lines.push(r.context);
  }
  writeFileSync("/tmp/kb-label-fresh-readable.txt", lines.join("\n"));
  const cls = picked.reduce((acc: Record<string, number>, r) => {
    acc[r.utteranceClass] = (acc[r.utteranceClass] ?? 0) + 1;
    return acc;
  }, {});
  console.log(JSON.stringify({
    poolTurns: all.length,
    holdoutCalls: holdout.length,
    excludedCalls: excludeCalls.size,
    picked: picked.length,
    classes: cls,
    uniqueCalls: new Set(picked.map((r) => r.callId)).size,
    bSameRaw: picked.filter((r) => r.bQuery.trim().toLowerCase() === r.rawQuery.trim().toLowerCase()).length,
    rawHits: picked.filter((r) => r.rawTopHit).length,
    bHits: picked.filter((r) => r.bTopHit).length,
  }, null, 2));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
