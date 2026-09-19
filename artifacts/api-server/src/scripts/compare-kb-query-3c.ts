/**
 * Replay the frozen 150 labelled turns through Strategy A (Phase 3B) and
 * Strategy B (Phase 3C conservative). Does not promote the builder.
 *
 *   DATABASE_URL=... ./node_modules/.bin/tsx src/scripts/compare-kb-query-3c.ts \
 *     --labels /tmp/kb-query-labels.jsonl --out /tmp/kb-query-3c-compare.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { eq, inArray } from "drizzle-orm";
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
type Lab = {
  callId: number;
  turn: number;
  utterance: string;
  labels: {
    shouldRetrieve: string;
    correctEntity: string | null;
    correctTopic: string | null;
    rawTopHitRelevant: boolean | string;
    builtTopHitRelevant: boolean | string;
    builtQueryContaminated: boolean;
  };
  rawQuery: string;
  builtQuery: string;
  rawTopHit: string | null;
  builtTopHit: string | null;
  rawSnippet?: string | null;
  builtSnippet?: string | null;
};

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

const STOP = new Set([
  "the", "a", "an", "is", "are", "was", "were", "do", "does", "did", "can", "could",
  "what", "which", "when", "where", "why", "who", "how", "about", "for", "and", "or",
  "to", "of", "in", "on", "at", "with", "from", "please", "tell", "me", "my", "we",
  "you", "your", "our", "it", "that", "this", "okay", "ok", "yeah", "yes",
]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9\u00C0-\uFFFF]+/u)
    .filter((t) => t.length >= 4 && !STOP.has(t));
}

function extraInjected(query: string, raw: string): string[] {
  const rawSet = new Set(tokens(raw));
  return tokens(query).filter((t) => !rawSet.has(t));
}

function extraAllowed(
  extra: string[],
  correctEntity: string | null | undefined,
  correctTopic: string | null | undefined,
  level: number,
): boolean {
  if (!extra.length) return true;
  const allow = new Set<string>();
  if (correctEntity && correctEntity !== "unclear") {
    for (const t of correctEntity.toLowerCase().split(/\s+/)) {
      if (t.length >= 4) allow.add(t);
    }
  }
  if (level >= 2 && correctTopic && correctTopic !== "unclear") {
    for (const t of correctTopic.toLowerCase().split(/\s+/)) {
      if (t.length >= 4) allow.add(t);
    }
    if (correctTopic === "coverage") allow.add("coverage");
    if (correctTopic === "premium") { allow.add("premium"); allow.add("pricing"); }
  }
  return extra.every((t) => allow.has(t) || (correctEntity && correctEntity.toLowerCase().includes(t)));
}

async function main() {
  const argv = process.argv;
  let labelsPath = "/tmp/kb-query-labels.jsonl";
  let outPath = "/tmp/kb-query-3c-compare.json";
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--labels") labelsPath = argv[++i] ?? labelsPath;
    else if (argv[i] === "--out") outPath = argv[++i] ?? outPath;
  }

  const labs: Lab[] = readFileSync(labelsPath, "utf8")
    .split(/\n/).filter(Boolean).map((l) => JSON.parse(l) as Lab);
  const wanted = new Map(labs.map((l) => [`${l.callId}:${l.turn}`, l]));
  const callIds = [...new Set(labs.map((l) => l.callId))];

  const calls = await db
    .select({
      id: callsTable.id,
      agentId: callsTable.agentId,
      transcript: callsTable.transcript,
      knowledgeBaseId: agentsTable.knowledgeBaseId,
    })
    .from(callsTable)
    .innerJoin(agentsTable, eq(callsTable.agentId, agentsTable.id))
    .where(inArray(callsTable.id, callIds));

  const catalogCache = new Map<number, string[]>();
  const sourceCache = new Map<number, number[]>();
  const hitCache = new Map<string, { topHit: string | null; snippet: string | null }>();

  async function catalog(agentId: number, sourceIds: number[]): Promise<string[]> {
    const cached = catalogCache.get(agentId);
    if (cached) return cached;
    const titles = await listKbOfferingTitles(sourceIds);
    const harvested: string[] = [...titles];
    if (sourceIds.length) {
      const [entries, sources] = await Promise.all([
        db.select({
          title: knowledgeEntriesTable.title,
          content: knowledgeEntriesTable.content,
        }).from(knowledgeEntriesTable).where(inArray(knowledgeEntriesTable.sourceId, sourceIds)),
        db.select({ name: knowledgeSourcesTable.name }).from(knowledgeSourcesTable).where(inArray(knowledgeSourcesTable.id, sourceIds)),
      ]);
      for (const s of sources) if (s.name) harvested.push(s.name);
      for (const e of entries) {
        if (e.title) harvested.push(e.title);
        harvested.push(...harvestOfferingNamesFromText((e.content ?? "").slice(0, 4000)));
      }
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
    catalogCache.set(agentId, unique);
    return unique;
  }

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

  const compared = [];
  for (const call of calls) {
    const turns = parseTurns(call.transcript);
    let sourceIds = sourceCache.get(call.agentId);
    if (!sourceIds) {
      sourceIds = await getAttachedSourceIds(call.agentId, call.knowledgeBaseId);
      sourceCache.set(call.agentId, sourceIds);
    }
    const offeringsB = await catalog(call.agentId, sourceIds);
    const offeringsA = await listKbOfferingTitles(sourceIds);

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
      const key = `${call.id}:${userTurn}`;
      const lab = wanted.get(key);
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

      if (!lab) continue;

      const rawQ = turn.content;
      const sameRaw = b.searchQuery.trim().toLowerCase() === rawQ.trim().toLowerCase();
      const sameA = b.searchQuery.trim().toLowerCase() === a.searchQuery.trim().toLowerCase();
      let bHit: { topHit: string | null; snippet: string | null } = { topHit: lab.rawTopHit, snippet: lab.rawSnippet ?? null };
      if (!sameRaw) {
        if (sameA) bHit = { topHit: lab.builtTopHit, snippet: lab.builtSnippet ?? null };
        else if (sourceIds.length) bHit = await search(sourceIds, b.searchQuery);
      }

      const extra = extraInjected(b.searchQuery, rawQ);
      const contaminated = lab.labels.shouldRetrieve === "unclear"
        ? false
        : extra.length > 0 && !extraAllowed(extra, lab.labels.correctEntity, lab.labels.correctTopic, b.queryLevel);
      const severe = Boolean(
        lab.labels.correctEntity
        && lab.labels.correctEntity !== "unclear"
        && extra.some((t) => {
          const ent = (lab.labels.correctEntity ?? "").toLowerCase();
          return !ent.includes(t) && offeringsB.some((o) => o.toLowerCase().includes(t) && !ent.includes(o.toLowerCase().split(/\s+/)[0] ?? "\0"));
        }),
      );

      let builtRel: boolean | string = lab.labels.rawTopHitRelevant;
      if (!sameRaw) {
        if (sameA) builtRel = lab.labels.builtTopHitRelevant;
        else if (lab.labels.shouldRetrieve !== "yes") builtRel = false;
        else if (!bHit.topHit) builtRel = false;
        else if (lab.labels.rawTopHitRelevant === true && lab.rawTopHit === bHit.topHit) builtRel = true;
        else if (lab.labels.builtTopHitRelevant === true && lab.builtTopHit === bHit.topHit) builtRel = true;
        else builtRel = "needs_human";
      }

      compared.push({
        callId: call.id,
        turn: userTurn,
        utterance: turn.content,
        shouldRetrieve: lab.labels.shouldRetrieve,
        correctEntity: lab.labels.correctEntity,
        gateClass: gate.utteranceClass,
        gateDecision: gate.decision,
        rawQuery: rawQ,
        aQuery: a.searchQuery,
        bQuery: b.searchQuery,
        bLevel: b.queryLevel,
        bEntity: b.activeEntity?.name ?? null,
        bTopic: b.activeTopic,
        aContaminated: lab.labels.builtQueryContaminated,
        bContaminated: contaminated,
        bSevere: severe,
        rawRelevant: lab.labels.rawTopHitRelevant,
        aRelevant: lab.labels.builtTopHitRelevant,
        bRelevant: builtRel,
        bTopHit: bHit.topHit,
        extra,
      });
    }
  }

  const need = compared.filter((r) => r.shouldRetrieve === "yes" && r.rawRelevant !== "unclear" && r.aRelevant !== "unclear");
  const bScored = need.filter((r) => r.bRelevant === true || r.bRelevant === false);
  const ref = bScored.filter((r) => {
    const lab = wanted.get(`${r.callId}:${r.turn}`);
    return Boolean((lab as Lab & { labelMeta?: { referential?: boolean } })?.labelMeta?.referential);
  });
  // labelMeta is on the jsonl
  const labelled = new Map(labs.map((l) => [`${l.callId}:${l.turn}`, l as Lab & { labelMeta?: { referential?: boolean } }]));
  const refRows = bScored.filter((r) => labelled.get(`${r.callId}:${r.turn}`)?.labelMeta?.referential);

  const matrix = (relKey: "aRelevant" | "bRelevant") => {
    const rows = bScored;
    const good = rows.filter((r) => r.rawRelevant === true && r[relKey] === true).length;
    const regression = rows.filter((r) => r.rawRelevant === true && r[relKey] === false).length;
    const improve = rows.filter((r) => r.rawRelevant === false && r[relKey] === true).length;
    const miss = rows.filter((r) => r.rawRelevant === false && r[relKey] === false).length;
    const rawRel = rows.filter((r) => r.rawRelevant === true);
    const builtOnly = rows.filter((r) => r[relKey] === true && r.rawRelevant !== true);
    const rawOnly = rows.filter((r) => r.rawRelevant === true && r[relKey] !== true);
    return { good, regression, improve, miss, rawRel: rawRel.length, builtOnly: builtOnly.length, rawOnly: rawOnly.length, n: rows.length };
  };

  const refMatrix = (relKey: "aRelevant" | "bRelevant") => {
    const rows = refRows;
    return {
      n: rows.length,
      builtOnly: rows.filter((r) => r[relKey] === true && r.rawRelevant !== true).length,
      rawOnly: rows.filter((r) => r.rawRelevant === true && r[relKey] !== true).length,
    };
  };

  const lang = compared.filter((r) => r.gateClass === "language_control");
  const ack = compared.filter((r) => r.gateClass === "acknowledgement");

  const summary = {
    n: compared.length,
    strategyA: {
      contaminationAll: compared.filter((r) => r.aContaminated).length,
      contaminationNeed: need.filter((r) => r.aContaminated).length,
      matrix: matrix("aRelevant"),
      referential: refMatrix("aRelevant"),
    },
    strategyB: {
      contaminationAll: compared.filter((r) => r.bContaminated).length,
      contaminationNeed: need.filter((r) => r.bContaminated).length,
      severe: compared.filter((r) => r.bSevere).length,
      matrix: matrix("bRelevant"),
      referential: refMatrix("bRelevant"),
      needsHuman: compared.filter((r) => r.bRelevant === "needs_human").length,
      queryLevels: compared.reduce((acc: Record<string, number>, r) => {
        acc[String(r.bLevel)] = (acc[String(r.bLevel)] ?? 0) + 1;
        return acc;
      }, {}),
    },
    falseRetrieval: {
      language_control: `${lang.filter((r) => r.gateDecision === "retrieve").length}/${lang.length}`,
      acknowledgement: `${ack.filter((r) => r.gateDecision === "retrieve").length}/${ack.length}`,
    },
  };

  writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), summary, rows: compared }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Wrote ${outPath} (${compared.length} labelled turns)`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
