/**
 * Load the inputs for an agent brief (prompt, tools, dispositions, KB) and
 * cache the extracted brief per agent, keyed by an input hash so it is
 * recomputed only when the agent's prompt/config/KB changes.
 */

import { asc, eq } from "drizzle-orm";
import { db, agentsTable, kbChunksTable, aiTestAgentBriefsTable } from "@workspace/db";
import {
  analyzeAgentBrief,
  briefInputHash,
  coerceBrief,
  extractKeyTerms,
  selectKbChunks,
  type AgentBrief,
  type BriefAgentInput,
  type KbChunkLite,
} from "./brief.js";

/** Upper bound on KB rows scanned for selection (ranked down to MAX_KB_CHUNKS). */
const KB_SCAN_LIMIT = 400;

type AgentRow = typeof agentsTable.$inferSelect;

export function briefInputFromAgent(agent: AgentRow): BriefAgentInput {
  const cfg = (agent.agentConfig ?? {}) as { successCriteria?: string };
  const tools = (Array.isArray(agent.tools) ? agent.tools : [])
    .map((t) => {
      const r = (t ?? {}) as Record<string, unknown>;
      const name = String(r["name"] ?? r["type"] ?? "").trim();
      return name ? { name, description: String(r["description"] ?? "").trim().slice(0, 400) } : null;
    })
    .filter((t): t is { name: string; description: string } => !!t);
  const dispositionFields = (Array.isArray(agent.dispositionSchema) ? agent.dispositionSchema : [])
    .filter((f) => f && typeof f.key === "string")
    .map((f) => ({ key: f.key, label: f.label ?? f.key, type: f.type ?? "text", options: f.options, required: f.required }));
  return {
    name: agent.name,
    systemPrompt: agent.systemPrompt ?? "",
    greetingMessage: agent.greetingMessage ?? null,
    language: agent.language ?? null,
    firstSpeaker: agent.firstSpeaker ?? null,
    useCase: agent.useCase ?? null,
    productDetails: agent.productDetails ?? null,
    successCriteria: cfg.successCriteria ?? null,
    tools,
    dispositionFields,
  };
}

export async function loadKbChunksForBrief(agent: AgentRow, input: BriefAgentInput): Promise<KbChunkLite[]> {
  if (!agent.knowledgeBaseId) return [];
  const rows = await db
    .select({ id: kbChunksTable.id, documentId: kbChunksTable.documentId, chunkIndex: kbChunksTable.chunkIndex, content: kbChunksTable.content })
    .from(kbChunksTable)
    .where(eq(kbChunksTable.knowledgeBaseId, agent.knowledgeBaseId))
    .orderBy(asc(kbChunksTable.documentId), asc(kbChunksTable.chunkIndex))
    .limit(KB_SCAN_LIMIT);
  const terms = extractKeyTerms([input.systemPrompt, input.productDetails ?? "", input.greetingMessage ?? ""].join("\n"));
  return selectKbChunks(rows, terms);
}

export async function getCachedBrief(agentId: number): Promise<{ brief: AgentBrief; inputHash: string; updatedAt: Date } | null> {
  const [row] = await db.select().from(aiTestAgentBriefsTable).where(eq(aiTestAgentBriefsTable.agentId, agentId));
  const brief = row ? coerceBrief(row.brief) : null;
  return row && brief ? { brief, inputHash: row.inputHash, updatedAt: row.updatedAt } : null;
}

/** Cached brief when the agent's inputs are unchanged; otherwise re-extract and store. */
export async function getAgentBrief(agent: AgentRow, opts: { force?: boolean } = {}): Promise<{ brief: AgentBrief; cached: boolean }> {
  const input = briefInputFromAgent(agent);
  const kb = await loadKbChunksForBrief(agent, input);
  const hash = briefInputHash(input, kb);
  if (!opts.force) {
    const cached = await getCachedBrief(agent.id);
    if (cached && cached.inputHash === hash) return { brief: cached.brief, cached: true };
  }
  const { brief, provider } = await analyzeAgentBrief(input, kb);
  await db.insert(aiTestAgentBriefsTable)
    .values({ agentId: agent.id, userId: agent.userId!, inputHash: hash, brief, provider })
    .onConflictDoUpdate({
      target: aiTestAgentBriefsTable.agentId,
      set: { inputHash: hash, brief, provider, updatedAt: new Date() },
    });
  return { brief, cached: false };
}
