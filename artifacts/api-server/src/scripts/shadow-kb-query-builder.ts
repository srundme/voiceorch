/**
 * Offline Phase 3 shadow: replay stored call transcripts through the retrieval
 * gate + query builder, then dual-search raw vs built against the agent's KB.
 *
 * Live LLM path is untouched. Does not set KB_QUERY_BUILDER=on.
 *
 *   DATABASE_URL=... ./node_modules/.bin/tsx src/scripts/shadow-kb-query-builder.ts \
 *     [--limit 80] [--days 21] [--out /tmp/kb-query-shadow.json] [--no-search]
 *
 * Judge builtTopHitRelevant vs rawTopHitRelevant, not overlap. Flag stale-entity
 * contamination when a newly named offering still carries the previous job.
 */
import { writeFileSync } from "node:fs";
import { and, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { db, callsTable, agentsTable } from "@workspace/db";
import { decideKbRetrieval } from "../orchestration/kb-retrieval-gate.js";
import {
  entitiesConflict,
  extractEntityName,
  kbHitOverlap,
  kbHitSummary,
  recentKbTurns,
  runKbQueryBuilder,
  type KbActiveEntity,
} from "../orchestration/kb-query-builder.js";
import { getAttachedSourceIds, retrieveKbContextMultiEx, isPureNonLatinQuery, listKbOfferingTitles } from "../orchestration/kb-retrieval.js";

type Turn = { role: "user" | "assistant"; content: string };

type ShadowRow = {
  callId: number;
  agentId: number;
  turn: number;
  utterance: string;
  gateDecision: string;
  gateReason: string;
  utteranceClass: string;
  rawQuery: string;
  builtQuery: string;
  queryStrategy: string;
  contextualized: boolean;
  activeEntity: string | null;
  entitySource: string | null;
  entityConfidence: number | null;
  entityAgeTurns: number;
  entityChanged: boolean;
  activeTopic: string | null;
  topicSource: string | null;
  topicAgeTurns: number;
  topicCleared: boolean;
  candidateEntity: string | null;
  builderMs: number;
  rawTopHit: string | null;
  builtTopHit: string | null;
  rawSnippet: string | null;
  builtSnippet: string | null;
  rawSearchMs: number | null;
  builtSearchMs: number | null;
  overlap: string | null;
  rawRelevant: boolean | null;
  builtRelevant: boolean | null;
  staleEntityContamination: boolean;
  referentialLike: boolean;
};

function parseArgs(argv: string[]): {
  limit: number;
  days: number;
  out: string;
  search: boolean;
  labelOut: string | null;
  labelLimit: number;
} {
  let limit = 80;
  let days = 21;
  let out = "/tmp/kb-query-shadow.json";
  let search = true;
  let labelOut: string | null = null;
  let labelLimit = 150;
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--limit") limit = Number(argv[++i] ?? limit);
    else if (a === "--days") days = Number(argv[++i] ?? days);
    else if (a === "--out") out = argv[++i] ?? out;
    else if (a === "--no-search") search = false;
    else if (a === "--label-out") labelOut = argv[++i] ?? null;
    else if (a === "--label-limit") labelLimit = Number(argv[++i] ?? labelLimit);
  }
  return { limit, days, out, search, labelOut, labelLimit };
}

function parseTurns(raw: string | null | undefined): Turn[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map((l) => {
          const role = String((l as { role?: string })?.role ?? "");
          const content = String((l as { content?: string })?.content ?? "").trim();
          if (!content) return null;
          if (role === "user" || role === "caller") return { role: "user" as const, content };
          if (role === "assistant" || role === "agent") return { role: "assistant" as const, content };
          return null;
        })
        .filter((x): x is Turn => x != null);
    }
  } catch {
    /* plain */
  }
  const out: Turn[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const agent = line.match(/^Agent:\s*([\s\S]*)/i);
    if (agent?.[1]?.trim()) {
      out.push({ role: "assistant", content: agent[1].trim() });
      continue;
    }
    const caller = line.match(/^Caller:\s*([\s\S]*)/i);
    if (caller?.[1]?.trim()) out.push({ role: "user", content: caller[1].trim() });
  }
  return out;
}

const STOP = new Set([
  "the", "a", "an", "is", "are", "was", "were", "do", "does", "what", "which",
  "when", "where", "why", "who", "how", "about", "for", "and", "or", "to", "of",
  "in", "on", "at", "with", "from", "please", "tell", "me", "okay", "ok",
]);

function contentTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9\u00C0-\uFFFF]+/u)
    .filter((t) => t.length >= 4 && !STOP.has(t));
}

function looksRelevant(hay: string | null, query: string, extra: string[]): boolean {
  if (!hay) return false;
  const h = hay.toLowerCase();
  const needles = [...contentTokens(query), ...extra.map((x) => x.toLowerCase()).filter((x) => x.length >= 4)];
  const hits = new Set(needles.filter((n) => h.includes(n)));
  return hits.size >= Math.min(2, Math.max(1, needles.length));
}

function offeringFromUtterance(utterance: string): KbActiveEntity | null {
  const name = extractEntityName(utterance);
  const m = utterance.match(/\bfor\s+(?:the\s+)?([A-Za-z][A-Za-z0-9&.-]{2,})/i);
  const fromFor = m?.[1] && !STOP.has(m[1].toLowerCase()) ? m[1] : null;
  const picked = fromFor || name;
  if (!picked) return null;
  return { type: "unknown", name: picked };
}

function staleContamination(
  builtQuery: string,
  utterance: string,
  stickyBefore: KbActiveEntity | null,
): boolean {
  if (!stickyBefore?.name) return false;
  const named = offeringFromUtterance(utterance);
  if (!named || !entitiesConflict(named, stickyBefore)) return false;
  const u = utterance.toLowerCase();
  const q = builtQuery.toLowerCase();
  return stickyBefore.name
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 4)
    .some((t) => q.includes(t) && !u.includes(t));
}

function clip(s: string, n = 160): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= n ? t : `${t.slice(0, n)}…`;
}

function hasIndic(text: string): boolean {
  return /[\u0900-\u0D7F]/.test(text);
}

function pickLabelSet(rows: ShadowRow[], limit: number): ShadowRow[] {
  const buckets: Record<string, ShadowRow[]> = {
    knowledge_ta: [],
    knowledge_en: [],
    language_control: [],
    acknowledgement: [],
    unclear_ta: [],
    unclear_en: [],
    other_skip: [],
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
    ["knowledge_ta", 50],
    ["knowledge_en", 30],
    ["unclear_ta", 20],
    ["language_control", 20],
    ["acknowledgement", 15],
    ["unclear_en", 10],
    ["other_skip", 5],
  ];
  const out: ShadowRow[] = [];
  const used = new Set<string>();
  const take = (list: ShadowRow[], n: number) => {
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

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required to replay real calls.");
    process.exit(2);
  }
  const opts = parseArgs(process.argv);
  const since = new Date(Date.now() - opts.days * 24 * 60 * 60 * 1000);

  const calls = await db
    .select({
      id: callsTable.id,
      agentId: callsTable.agentId,
      transcript: callsTable.transcript,
      durationSeconds: callsTable.durationSeconds,
      createdAt: callsTable.createdAt,
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
    .limit(opts.limit);

  const sourceCache = new Map<number, number[]>();
  const offeringCache = new Map<number, string[]>();
  const rows: ShadowRow[] = [];
  let searched = 0;

  for (const call of calls) {
    const turns = parseTurns(call.transcript);
    if (!turns.some((t) => t.role === "user")) continue;

    let sourceIds = sourceCache.get(call.agentId);
    if (!sourceIds) {
      sourceIds = await getAttachedSourceIds(call.agentId, call.knowledgeBaseId);
      sourceCache.set(call.agentId, sourceIds);
    }
    if (!sourceIds.length) continue;

    let offerings = offeringCache.get(call.agentId);
    if (!offerings) {
      offerings = await listKbOfferingTitles(sourceIds);
      offeringCache.set(call.agentId, offerings);
    }

    let activeEntity: KbActiveEntity | null = null;
    let activeTopic: string | null = null;
    const history: Turn[] = [];
    let userTurn = 0;

    for (const turn of turns) {
      history.push(turn);
      if (turn.role !== "user") continue;
      userTurn += 1;
      const gate = decideKbRetrieval(turn.content, { knownOfferings: offerings });
      const stickyBefore = activeEntity;
      const prev = recentKbTurns(history);
      const built = runKbQueryBuilder({
        utterance: turn.content,
        previousAgentTurn: prev.previousAgentTurn,
        previousCallerTurn: prev.previousCallerTurn,
        activeEntity,
        activeTopic,
        knownOfferings: offerings,
        turnIndex: userTurn,
        utteranceClass: gate.utteranceClass,
      });
      activeEntity = built.activeEntity;
      activeTopic = built.activeTopic;

      const retrieve = gate.decision === "retrieve";
      let rawTopHit: string | null = null;
      let builtTopHit: string | null = null;
      let rawSnippet: string | null = null;
      let builtSnippet: string | null = null;
      let rawSearchMs: number | null = null;
      let builtSearchMs: number | null = null;
      let overlap: string | null = null;
      let rawRelevant: boolean | null = null;
      let builtRelevant: boolean | null = null;

      if (retrieve && opts.search && built.searchQuery !== built.rawQuery) {
        searched += 1;
        const extra = [built.activeEntity?.name ?? "", built.activeTopic ?? ""].filter(Boolean);
        const [rawRes, builtRes] = await Promise.all([
          retrieveKbContextMultiEx(sourceIds, built.rawQuery, undefined, { skipFts: isPureNonLatinQuery(built.rawQuery) }),
          retrieveKbContextMultiEx(sourceIds, built.searchQuery, undefined, { skipFts: isPureNonLatinQuery(built.searchQuery) }),
        ]);
        const rawSum = kbHitSummary(rawRes);
        const builtSum = kbHitSummary(builtRes);
        rawTopHit = rawSum.topHit;
        builtTopHit = builtSum.topHit;
        rawSnippet = rawSum.snippet;
        builtSnippet = builtSum.snippet;
        rawSearchMs = rawRes.latencyMs;
        builtSearchMs = builtRes.latencyMs;
        overlap = kbHitOverlap(rawSum.ids, builtSum.ids);
        rawRelevant = looksRelevant(rawSnippet, built.rawQuery, extra);
        builtRelevant = looksRelevant(builtSnippet, built.searchQuery, extra);
      } else if (retrieve && opts.search) {
        searched += 1;
        const extra = [built.activeEntity?.name ?? "", built.activeTopic ?? ""].filter(Boolean);
        const rawRes = await retrieveKbContextMultiEx(sourceIds, built.rawQuery, undefined, {
          skipFts: isPureNonLatinQuery(built.rawQuery),
        });
        const rawSum = kbHitSummary(rawRes);
        rawTopHit = rawSum.topHit;
        builtTopHit = rawSum.topHit;
        rawSnippet = rawSum.snippet;
        builtSnippet = rawSum.snippet;
        rawSearchMs = rawRes.latencyMs;
        builtSearchMs = rawRes.latencyMs;
        overlap = "same-query";
        rawRelevant = looksRelevant(rawSnippet, built.rawQuery, extra);
        builtRelevant = rawRelevant;
      }

      rows.push({
        callId: call.id,
        agentId: call.agentId,
        turn: userTurn,
        utterance: clip(turn.content, 180),
        gateDecision: gate.decision,
        gateReason: gate.reason,
        utteranceClass: gate.utteranceClass,
        rawQuery: clip(built.rawQuery, 180),
        builtQuery: clip(built.searchQuery, 180),
        queryStrategy: built.queryStrategy,
        contextualized: built.contextualized,
        activeEntity: built.activeEntity?.name ?? null,
        entitySource: built.entitySource,
        entityConfidence: built.entityConfidence,
        entityAgeTurns: built.entityAgeTurns,
        entityChanged: built.entityChanged,
        activeTopic: built.activeTopic,
        topicSource: built.topicSource,
        topicAgeTurns: built.topicAgeTurns,
        topicCleared: built.topicCleared,
        candidateEntity: built.candidateEntity?.name ?? null,
        builderMs: built.builderMs,
        rawTopHit,
        builtTopHit,
        rawSnippet,
        builtSnippet,
        rawSearchMs,
        builtSearchMs,
        overlap,
        rawRelevant,
        builtRelevant,
        staleEntityContamination: staleContamination(built.searchQuery, turn.content, stickyBefore),
        referentialLike: built.contextualized && built.queryStrategy !== "raw" && built.queryStrategy !== "fallback_raw",
      });
    }
  }

  const retrieval = rows.filter((r) => r.gateDecision === "retrieve");
  const dual = retrieval.filter((r) => r.rawRelevant != null && r.builtQuery !== r.rawQuery);
  const builtWin = dual.filter((r) => r.builtRelevant && !r.rawRelevant).length;
  const rawWin = dual.filter((r) => r.rawRelevant && !r.builtRelevant).length;
  const both = dual.filter((r) => r.builtRelevant && r.rawRelevant).length;
  const neither = dual.filter((r) => !r.builtRelevant && !r.rawRelevant).length;
  const contaminated = rows.filter((r) => r.staleEntityContamination);
  const builderMs = rows.map((r) => r.builderMs);
  const searchMs = rows.map((r) => r.builtSearchMs).filter((n): n is number => n != null);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

  const summary = {
    callsScanned: calls.length,
    turns: rows.length,
    retrievalTurns: retrieval.length,
    skipTurns: rows.filter((r) => r.gateDecision === "skip").length,
    contextualized: rows.filter((r) => r.contextualized).length,
    dualCompared: dual.length,
    builtTopHitRelevantOnly: builtWin,
    rawTopHitRelevantOnly: rawWin,
    bothRelevant: both,
    neitherRelevant: neither,
    staleEntityContamination: contaminated.length,
    avgBuilderMs: Math.round(avg(builderMs) * 10) / 10,
    avgSearchMs: Math.round(avg(searchMs) * 10) / 10,
    searched,
  };

  const payload = { generatedAt: new Date().toISOString(), summary, contaminated, dual, rows };
  writeFileSync(opts.out, JSON.stringify(payload, null, 2));

  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nWrote ${opts.out}`);
  if (opts.labelOut) {
    const labels = pickLabelSet(rows, opts.labelLimit);
    writeFileSync(opts.labelOut, labels.map((r) => JSON.stringify({
      callId: r.callId,
      turn: r.turn,
      utterance: r.utterance,
      utteranceClass: r.utteranceClass,
      gateDecision: r.gateDecision,
      rawQuery: r.rawQuery,
      builtQuery: r.builtQuery,
      activeEntity: r.activeEntity,
      entitySource: r.entitySource,
      entityConfidence: r.entityConfidence,
      entityChanged: r.entityChanged,
      activeTopic: r.activeTopic,
      topicSource: r.topicSource,
      topicCleared: r.topicCleared,
      rawTopHit: r.rawTopHit,
      builtTopHit: r.builtTopHit,
      labels: {
        shouldRetrieve: "",
        correctEntity: "",
        correctTopic: "",
        rawTopHitRelevant: "",
        builtTopHitRelevant: "",
        builtQueryContaminated: "",
      },
    })).join("\n") + "\n");
    console.log(`Wrote ${labels.length} label rows to ${opts.labelOut}`);
  }
  if (contaminated.length) {
    console.log("\nStale-entity contamination:");
    for (const r of contaminated.slice(0, 20)) {
      console.log(`  call ${r.callId} t${r.turn}: ${r.utterance}`);
      console.log(`    built: ${r.builtQuery}`);
    }
  }
  console.log("\nReferential / contextualized sample:");
  for (const r of dual.filter((x) => x.referentialLike).slice(0, 15)) {
    console.log(`  call ${r.callId} t${r.turn} rawRel=${r.rawRelevant} builtRel=${r.builtRelevant} overlap=${r.overlap}`);
    console.log(`    raw:   ${r.rawQuery}`);
    console.log(`    built: ${r.builtQuery}`);
    console.log(`    rawHit:   ${clip(r.rawTopHit ?? "", 100)}`);
    console.log(`    builtHit: ${clip(r.builtTopHit ?? "", 100)}`);
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
