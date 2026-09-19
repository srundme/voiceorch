/**
 * Replay the frozen fresh-150 holdout through Phase 2B gate + frozen Strategy B.
 * Does not change labels, the builder, bake, Jina, RRF, or chunks.
 *
 *   DATABASE_URL=... ./node_modules/.bin/tsx src/scripts/replay-holdout-phase2b.ts \
 *     --labels /tmp/kb-query-labels-fresh.jsonl --out /tmp/kb-query-phase2b-replay.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { eq, inArray } from "drizzle-orm";
import { db, callsTable, agentsTable, knowledgeEntriesTable, knowledgeSourcesTable } from "@workspace/db";
import { decideKbRetrieval } from "../orchestration/kb-retrieval-gate.js";
import {
  harvestOfferingNamesFromText,
  kbHitSummary,
  recentKbTurns,
  runKbQueryBuilderConservative,
  type KbActiveEntity,
} from "../orchestration/kb-query-builder.js";
import { getAttachedSourceIds, retrieveKbContextMultiEx, isPureNonLatinQuery, listKbOfferingTitles } from "../orchestration/kb-retrieval.js";

type Turn = { role: "user" | "assistant"; content: string };
type Lab = {
  callId: number;
  turn: number;
  utterance: string;
  utteranceClass?: string;
  gateDecision?: string;
  bQuery?: string;
  labels: {
    shouldRetrieve: string;
    correctEntity: string | null;
    correctTopic: string | null;
    rawTopHitRelevant: boolean | string;
    builtTopHitRelevant: boolean | string;
    builtQueryContaminated: boolean;
  };
  labelMeta?: { severeContamination?: boolean; referential?: boolean; note?: string };
  rawQuery: string;
  rawTopHit: string | null;
  bTopHit?: string | null;
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
  }
  return extra.every((t) => allow.has(t) || (correctEntity && correctEntity.toLowerCase().includes(t)));
}

function norm(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase();
}

async function main() {
  const argv = process.argv;
  let labelsPath = "/tmp/kb-query-labels-fresh.jsonl";
  let outPath = "/tmp/kb-query-phase2b-replay.json";
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

  const compared: Array<Record<string, unknown>> = [];
  for (const call of calls) {
    const turns = parseTurns(call.transcript);
    let sourceIds = sourceCache.get(call.agentId);
    if (!sourceIds) {
      sourceIds = await getAttachedSourceIds(call.agentId, call.knowledgeBaseId);
      sourceCache.set(call.agentId, sourceIds);
    }
    const offerings = await catalog(call.agentId, sourceIds);

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
      const gate = decideKbRetrieval(turn.content, { knownOfferings: offerings });
      const prev = recentKbTurns(history);
      const b = runKbQueryBuilderConservative({
        utterance: turn.content,
        previousAgentTurn: prev.previousAgentTurn,
        previousCallerTurn: prev.previousCallerTurn,
        activeEntity: entityB,
        activeTopic: topicB,
        knownOfferings: offerings,
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
      const oldB = lab.bQuery ?? rawQ;
      const sameRaw = norm(b.searchQuery) === norm(rawQ);
      const sameOldB = norm(b.searchQuery) === norm(oldB);
      const extra = extraInjected(b.searchQuery, rawQ);

      let contaminated: boolean;
      let severe: boolean;
      if (sameRaw) {
        contaminated = false;
        severe = false;
      } else if (sameOldB) {
        contaminated = Boolean(lab.labels.builtQueryContaminated);
        severe = Boolean(lab.labelMeta?.severeContamination);
      } else {
        contaminated = lab.labels.shouldRetrieve === "unclear"
          ? false
          : extra.length > 0 && !extraAllowed(extra, lab.labels.correctEntity, lab.labels.correctTopic, b.queryLevel);
        severe = Boolean(
          extra.length
          && offerings.some((o) => extra.some((t) => o.toLowerCase().includes(t)))
          && !(lab.labels.correctEntity && extra.some((t) => (lab.labels.correctEntity ?? "").toLowerCase().includes(t))),
        );
      }

      let builtRel: boolean | string = lab.labels.builtTopHitRelevant;
      let bTopHit = lab.bTopHit ?? lab.rawTopHit;
      if (sameRaw) {
        builtRel = lab.labels.rawTopHitRelevant;
        bTopHit = lab.rawTopHit;
      } else if (!sameOldB && sourceIds.length) {
        const hit = await search(sourceIds, b.searchQuery);
        bTopHit = hit.topHit;
        if (lab.labels.shouldRetrieve !== "yes") builtRel = false;
        else if (!hit.topHit) builtRel = false;
        else if (lab.labels.rawTopHitRelevant === true && lab.rawTopHit === hit.topHit) builtRel = true;
        else if (lab.labels.builtTopHitRelevant === true && lab.bTopHit === hit.topHit) builtRel = true;
        else builtRel = "needs_human";
      }

      compared.push({
        callId: call.id,
        turn: userTurn,
        utterance: turn.content,
        shouldRetrieve: lab.labels.shouldRetrieve,
        correctEntity: lab.labels.correctEntity,
        oldClass: lab.utteranceClass,
        newClass: gate.utteranceClass,
        oldGate: lab.gateDecision,
        newGate: gate.decision,
        rawQuery: rawQ,
        oldBQuery: oldB,
        bQuery: b.searchQuery,
        bLevel: b.queryLevel,
        bEntity: b.activeEntity?.name ?? null,
        oldContaminated: lab.labels.builtQueryContaminated,
        contaminated,
        severe,
        oldSevere: Boolean(lab.labelMeta?.severeContamination),
        referential: Boolean(lab.labelMeta?.referential),
        rawRelevant: lab.labels.rawTopHitRelevant,
        oldBuiltRelevant: lab.labels.builtTopHitRelevant,
        builtRelevant: builtRel,
        bTopHit,
        extra,
        note: lab.labelMeta?.note ?? null,
      });
    }
  }

  const need = compared.filter((r) => r.shouldRetrieve === "yes");
  const needScored = need.filter((r) => r.builtRelevant === true || r.builtRelevant === false);
  const ref = compared.filter((r) => r.referential);
  const lang = compared.filter((r) => r.newClass === "language_control");
  const ack = compared.filter((r) => r.newClass === "acknowledgement");
  const langHumanSkip = compared.filter((r) => r.shouldRetrieve === "no" && r.newClass === "language_control");
  const classShift = compared.filter((r) => r.oldClass !== r.newClass);

  const summary = {
    n: compared.length,
    uniqueCalls: new Set(compared.map((r) => r.callId)).size,
    severe: `${compared.filter((r) => r.severe).length}/${compared.length}`,
    contamination: {
      all: `${compared.filter((r) => r.contaminated).length}/${compared.length}`,
      need: `${need.filter((r) => r.contaminated).length}/${need.length}`,
    },
    regression: (() => {
      const rawYes = needScored.filter((r) => r.rawRelevant === true);
      const lost = rawYes.filter((r) => r.builtRelevant === false);
      return `${lost.length}/${rawYes.length}`;
    })(),
    matrix: {
      GOOD: needScored.filter((r) => r.rawRelevant === true && r.builtRelevant === true).length,
      REGRESSION: needScored.filter((r) => r.rawRelevant === true && r.builtRelevant === false).length,
      IMPROVEMENT: needScored.filter((r) => r.rawRelevant === false && r.builtRelevant === true).length,
      NO_CHANGE: needScored.filter((r) => r.rawRelevant === false && r.builtRelevant === false).length,
      need: need.length,
      needsHuman: compared.filter((r) => r.builtRelevant === "needs_human").length,
    },
    referential: {
      n: ref.length,
      built_only: ref.filter((r) => r.builtRelevant === true && r.rawRelevant !== true).length,
      raw_only: ref.filter((r) => r.rawRelevant === true && r.builtRelevant !== true).length,
      built_only_utt: ref.filter((r) => r.builtRelevant === true && r.rawRelevant !== true).map((r) => r.utterance),
    },
    falseRetrieval: {
      language_control: `${lang.filter((r) => r.newGate === "retrieve").length}/${lang.length}`,
      acknowledgement: `${ack.filter((r) => r.newGate === "retrieve").length}/${ack.length}`,
      language_human_skip_still_retrieve: `${langHumanSkip.filter((r) => r.newGate === "retrieve").length}/${langHumanSkip.length}`,
    },
    classShift: {
      n: classShift.length,
      to_language_control: classShift.filter((r) => r.newClass === "language_control").length,
      to_caller_fact: classShift.filter((r) => r.newClass === "caller_fact").length,
      to_call_control: classShift.filter((r) => r.newClass === "call_control").length,
      to_repeat: classShift.filter((r) => r.newClass === "repeat_request").length,
      to_ack: classShift.filter((r) => r.newClass === "acknowledgement").length,
    },
    remainingContaminated: compared.filter((r) => r.contaminated).map((r) => ({
      utterance: r.utterance,
      bQuery: r.bQuery,
      newClass: r.newClass,
      shouldRetrieve: r.shouldRetrieve,
      note: r.note,
    })),
  };

  writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), summary, rows: compared }, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Wrote ${outPath} (${compared.length} labelled turns; labels unchanged)`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
