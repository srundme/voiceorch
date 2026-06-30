import { Router } from "express";
import type { Request, Response } from "express";
import { db, agentsTable, callsTable, platformSettingsTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const router = Router();

async function getSetting(key: string): Promise<string | null> {
  const [row] = await db.select().from(platformSettingsTable).where(eq(platformSettingsTable.key, key));
  const dbVal = row?.value ?? null;
  if (dbVal) return dbVal;
  if (key === "managed_qwen_key") {
    const envVal = (process.env["GROQ_API_KEY"] ?? "").trim();
    return envVal || null;
  }
  return null;
}

const SYSTEM_PROMPT = `You are Orcha, an expert AI assistant embedded in SnapServe — India's AI voice agent orchestration platform. You have deep knowledge of the platform and can read users' real agent data, diagnose issues, and propose configuration changes.

## DATA RETRIEVAL COMMANDS
When you need data to answer a question accurately, output ONLY a JSON command (nothing else) and the system will fetch it for you. Then give your full response with the data.

Get all agents:         {"cmd":"list_agents"}
Get agent details:      {"cmd":"get_agent_detail","agent_id":36}
Get call performance:   {"cmd":"get_call_stats","agent_id":36}
Full diagnosis:         {"cmd":"diagnose_agent","agent_id":36}

## RESPONSE FORMAT
Always respond with valid JSON (no markdown, no code fences):
{"message":"Your detailed response","navigate":"/app/agents","proposal":null}

"navigate" — optional, only when sending user to a specific page.
"proposal" — include when proposing configuration changes (see PROPOSING CHANGES).

## PROPOSING CHANGES
When you want to change an agent's settings, include a proposal in your response:
{
  "message": "I found 2 issues. Here's what I recommend — click Apply to make these changes:",
  "proposal": {
    "agentId": 36,
    "agentName": "New Agent",
    "summary": "Reduce latency by switching LLM and adjusting VAD",
    "changes": [
      {"field":"vadSilenceMs","label":"Thinking Pause","current_value":250,"proposed_value":400,"reason":"250ms cuts callers off mid-sentence — 400ms feels natural"},
      {"field":"llmModel","label":"LLM Model","current_value":"gpt-4o","proposed_value":"gpt-4.1-nano","reason":"gpt-4o has 800ms latency; gpt-4.1-nano is 3x faster for voice"}
    ]
  }
}

IMPORTANT: Always explain in your "message" what you found and what will change. Never apply changes without showing the proposal first. The user will click "Apply" to confirm.

## PLATFORM ARCHITECTURE
SnapServe chains 4 providers per voice call:
1. ASR (Speech → Text): Sarvam Saaras v3 (best Indian languages, 50-150ms), Azure Speech (reliable, 100-250ms)
2. LLM (Brain): Qwen 3 32B via Groq (fastest 200-400ms TTFT), Gemini 2.5 Flash Lite (200-400ms), GPT-4.1 Nano (250-450ms), GPT-4.1 Mini (300-600ms), GPT-4o (600-1200ms — slow), Sarvam 30B (Indian context)
3. TTS (Text → Audio): Cartesia Sonic 3.5 (fastest English/multilingual, 100-200ms), Sarvam Bulbul v3 (best Indian voices, 38 voices, 150-300ms)
4. Telephony: VoBiz (managed — REST+WebSocket, LINEAR16 PCM), Twilio, Plivo

## AGENT SETTINGS GUIDE

vadSilenceMs (Thinking Pause Tolerance):
- How long agent waits after caller stops speaking before responding
- < 280ms: Agent interrupts caller before they finish — feels rude
- 300-450ms: Sweet spot — feels natural. Default: 350ms
- > 600ms: Agent feels slow and unresponsive
- Indian languages: 380-500ms | Elderly users: 450-550ms

temperature:
- 0.2-0.4: Consistent, predictable (NBFC, IVR, structured tasks) ← recommended
- 0.5-0.7: Balanced (support, scheduling)
- > 0.8: Too random for voice — inconsistent responses, slower generation

firstSpeaker:
- "assistant": Agent speaks first — use for outbound calls, proactive agents
- "user": Agent waits — use for inbound helplines, support

bargeInEnabled:
- ON: Caller can interrupt agent mid-speech (conversational agents)
- OFF: Agent finishes before listening (IVR menus, legal disclaimers)

silenceTimeoutSeconds: Seconds of silence before "Are you there?" Default 30s. Sales: 15s. Elderly: 60s.

maxDuration: Max call seconds. Default 300 (5 min). Complex support: 600-900s.

contextWindowTurns: How many past turns LLM sees. Lower (6-8) = faster on long calls.

systemPrompt length: Keep under 1500 chars. Every extra 500 chars adds ~50ms LLM latency.

## LATENCY DIAGNOSIS

Typical "fast" agent budget: ASR 100ms + LLM 300ms + TTS 150ms = 550ms total
Slow agent (> 1500ms total): Usually LLM choice or long system prompt

Common causes ranked by impact:
1. Wrong LLM: gpt-4o (800ms) vs gpt-4.1-nano (300ms) — 3x difference
2. System prompt too long: > 3000 chars adds 200-400ms
3. Temperature > 0.7: Slows LLM generation significantly
4. vadSilenceMs mismatch: Doesn't slow LLM but makes agent FEEL slower (wait time)
5. Wrong ASR for language: Azure for Tamil adds 150ms vs Sarvam

## SYSTEM PROMPT WRITING GUIDE

For voice agents, the system prompt must be:
1. Concise (under 1500 chars): Long prompts slow every turn
2. Role-first: "You are [Name], a [role] for [Company]..."
3. Language explicit: "Respond ONLY in Hindi. Never switch to English unless customer does first."
4. Task-numbered: Numbered steps for multi-step flows
5. No markdown/lists: Voice agents speak sentences, not bullet points
6. Personality in one line: "Warm but professional. Direct. Never use jargon."
7. Scope boundaries: "If asked about anything outside [topic], say 'I can only help with X'"
8. End conditions: "End the call when customer confirms their appointment OR says goodbye"

⚠️ CRITICAL RULE FOR SYSTEM PROMPT REWRITES:
When proposing a new systemPrompt value you MUST write the COMPLETE, FULL replacement text — never a stub, never a placeholder, never "..." or "[rest of prompt]". The proposed_value must preserve EVERY task, step, language rule, tone, and behavior from the original prompt — just written more concisely. Removing filler words is good. Dropping entire task flows or steps is forbidden. If the user's prompt has 10 instructions, the rewrite must still have all 10 instructions. You have the full original systemPrompt in the agent data — use it.

## PLATFORM PAGES
/app/command-center — Home dashboard with stats
/app/agents — Create and manage voice agents
/app/calls — Call history and transcripts
/app/providers — BYOP API keys (ASR, LLM, TTS, Telephony)
/app/campaigns — Outbound campaign management
/app/scheduling — Booking engine (calendars, event types, availability)
/app/wallet — Billing and usage
/app/knowledge-bases — Document knowledge bases for agents
/app/memory — Caller memory and profiles`;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ProposalChange {
  field: string;
  label: string;
  current_value?: unknown;
  proposed_value: unknown;
  reason: string;
}

interface Proposal {
  agentId: number;
  agentName: string;
  summary: string;
  changes: ProposalChange[];
}

function tryParseCommand(raw: string): Record<string, unknown> | null {
  const cleaned = raw.trim().replace(/```json\n?|\n?```/g, "").trim();
  if (!cleaned.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    if (typeof parsed.cmd === "string") return parsed;
  } catch { /* ok */ }
  return null;
}

function parseResponse(raw: string): { text: string; navigate: string | null; proposal: Proposal | null } {
  const cleaned = raw.trim().replace(/```json\n?|\n?```/g, "").trim();
  if (!cleaned.startsWith("{")) return { text: cleaned, navigate: null, proposal: null };
  try {
    const parsed = JSON.parse(cleaned) as { message?: string; navigate?: string; proposal?: Proposal };
    return {
      text: parsed.message ?? cleaned,
      navigate: parsed.navigate ?? null,
      proposal: parsed.proposal ?? null,
    };
  } catch {
    // Try to extract JSON from mixed text
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const p = JSON.parse(match[0]) as { message?: string; navigate?: string; proposal?: Proposal };
        return { text: p.message ?? cleaned, navigate: p.navigate ?? null, proposal: p.proposal ?? null };
      } catch { /* ok */ }
    }
    return { text: cleaned, navigate: null, proposal: null };
  }
}

async function executeTool(cmd: string, args: Record<string, unknown>, clerkUserId: string): Promise<string> {
  switch (cmd) {
    case "list_agents": {
      const agents = await db
        .select({
          id: agentsTable.id,
          name: agentsTable.name,
          status: agentsTable.status,
          asrProvider: agentsTable.asrProvider,
          asrModel: agentsTable.asrModel,
          llmProvider: agentsTable.llmProvider,
          llmModel: agentsTable.llmModel,
          ttsProvider: agentsTable.ttsProvider,
          ttsModel: agentsTable.ttsModel,
          language: agentsTable.language,
          temperature: agentsTable.temperature,
          agentConfig: agentsTable.agentConfig,
          totalCalls: agentsTable.totalCalls,
          successfulCalls: agentsTable.successfulCalls,
          avgSttLatencyMs: agentsTable.avgSttLatencyMs,
          avgLlmLatencyMs: agentsTable.avgLlmLatencyMs,
          avgTtsFirstChunkMs: agentsTable.avgTtsFirstChunkMs,
        })
        .from(agentsTable)
        .where(eq(agentsTable.userId, clerkUserId))
        .limit(20);

      return JSON.stringify(
        agents.map((a) => ({
          id: a.id,
          name: a.name,
          status: a.status,
          asr: `${a.asrProvider}/${a.asrModel ?? "auto"}`,
          llm: `${a.llmProvider}/${a.llmModel ?? "auto"}`,
          tts: `${a.ttsProvider}/${a.ttsModel ?? "auto"}`,
          language: a.language,
          temperature: a.temperature ?? 0.4,
          vadSilenceMs: ((a.agentConfig ?? {}) as Record<string, unknown>)?.vadSilenceMs ?? 350,
          bargeInEnabled: ((a.agentConfig ?? {}) as Record<string, unknown>)?.bargeInEnabled ?? false,
          totalCalls: a.totalCalls ?? 0,
          successRate: a.totalCalls ? Math.round(((a.successfulCalls ?? 0) / a.totalCalls) * 100) : null,
          avgLatencyMs: {
            stt: a.avgSttLatencyMs,
            llm: a.avgLlmLatencyMs,
            ttsFirstChunk: a.avgTtsFirstChunkMs,
          },
        })),
      );
    }

    case "get_agent_detail": {
      const [agent] = await db
        .select()
        .from(agentsTable)
        .where(and(eq(agentsTable.id, args.agent_id as number), eq(agentsTable.userId, clerkUserId)));

      if (!agent) return JSON.stringify({ error: "Agent not found or does not belong to you" });

      const config = ((agent.agentConfig ?? {}) as Record<string, unknown>);
      return JSON.stringify({
        id: agent.id,
        name: agent.name,
        status: agent.status,
        language: agent.language,
        asrProvider: agent.asrProvider,
        asrModel: agent.asrModel,
        llmProvider: agent.llmProvider,
        llmModel: agent.llmModel,
        ttsProvider: agent.ttsProvider,
        ttsModel: agent.ttsModel,
        ttsVoice: agent.ttsVoice,
        temperature: agent.temperature ?? 0.4,
        maxDuration: agent.maxDuration ?? 300,
        silenceTimeoutSeconds: agent.silenceTimeoutSeconds ?? 30,
        firstSpeaker: agent.firstSpeaker ?? "assistant",
        greetingMessage: agent.greetingMessage,
        systemPromptLength: (agent.systemPrompt ?? "").length,
        systemPrompt: agent.systemPrompt ?? "",
        vadSilenceMs: config.vadSilenceMs ?? 350,
        bargeInEnabled: config.bargeInEnabled ?? false,
        backchannelingEnabled: agent.backchannelingEnabled ?? false,
        contextWindowTurns: agent.contextWindowTurns,
        performance: {
          totalCalls: agent.totalCalls ?? 0,
          successRate: agent.totalCalls ? Math.round(((agent.successfulCalls ?? 0) / agent.totalCalls) * 100) : null,
          avgSttMs: agent.avgSttLatencyMs,
          avgLlmMs: agent.avgLlmLatencyMs,
          avgTtsMs: agent.avgTtsFirstChunkMs,
          totalAvgMs: (agent.avgSttLatencyMs ?? 0) + (agent.avgLlmLatencyMs ?? 0) + (agent.avgTtsFirstChunkMs ?? 0) || null,
        },
      });
    }

    case "get_call_stats": {
      const agentId = args.agent_id as number | undefined;
      const userFilter = eq(callsTable.userId, clerkUserId);
      const whereClause = agentId ? and(userFilter, eq(callsTable.agentId, agentId)) : userFilter;

      const [stats] = await db
        .select({
          total: sql<number>`count(*)::int`,
          completed: sql<number>`count(*) filter (where status = 'completed')::int`,
          failed: sql<number>`count(*) filter (where status = 'failed')::int`,
          avgDuration: sql<number>`round(avg(duration_seconds))::int`,
          avgStt: sql<number>`round(avg(stt_latency_ms))::int`,
          avgLlm: sql<number>`round(avg(llm_latency_ms))::int`,
          avgTts: sql<number>`round(avg(tts_first_chunk_ms))::int`,
        })
        .from(callsTable)
        .where(whereClause);

      const recent = await db
        .select({ status: callsTable.status, durationSeconds: callsTable.durationSeconds, sttLatencyMs: callsTable.sttLatencyMs, llmLatencyMs: callsTable.llmLatencyMs, createdAt: callsTable.createdAt })
        .from(callsTable)
        .where(whereClause)
        .orderBy(desc(callsTable.createdAt))
        .limit(5);

      return JSON.stringify({
        total: stats?.total ?? 0,
        completed: stats?.completed ?? 0,
        failed: stats?.failed ?? 0,
        successRate: stats?.total ? Math.round(((stats.completed) / (stats.total)) * 100) : null,
        avgDurationSeconds: stats?.avgDuration,
        avgLatencyMs: { stt: stats?.avgStt, llm: stats?.avgLlm, ttsFirstChunk: stats?.avgTts, total: ((stats?.avgStt ?? 0) + (stats?.avgLlm ?? 0) + (stats?.avgTts ?? 0)) || null },
        recentCalls: recent,
      });
    }

    case "diagnose_agent": {
      const agentId = args.agent_id as number;
      const [[agent], [stats]] = await Promise.all([
        db.select().from(agentsTable).where(and(eq(agentsTable.id, agentId), eq(agentsTable.userId, clerkUserId))),
        db.select({
          total: sql<number>`count(*)::int`,
          completed: sql<number>`count(*) filter (where status = 'completed')::int`,
          avgStt: sql<number>`round(avg(stt_latency_ms))::int`,
          avgLlm: sql<number>`round(avg(llm_latency_ms))::int`,
          avgTts: sql<number>`round(avg(tts_first_chunk_ms))::int`,
        }).from(callsTable).where(and(eq(callsTable.userId, clerkUserId), eq(callsTable.agentId, agentId))),
      ]);

      if (!agent) return JSON.stringify({ error: "Agent not found" });

      const config = ((agent.agentConfig ?? {}) as Record<string, unknown>);
      const vadSilenceMs = (config.vadSilenceMs as number) ?? 350;
      const temperature = agent.temperature ?? 0.4;
      const systemPromptLen = (agent.systemPrompt ?? "").length;
      const issues: Array<{ severity: string; field: string; label: string; current: unknown; recommended: unknown; issue: string; fix: string }> = [];

      if (vadSilenceMs < 280) issues.push({ severity: "high", field: "vadSilenceMs", label: "Thinking Pause", current: `${vadSilenceMs}ms`, recommended: "400ms", issue: "Agent cuts caller off before they finish speaking", fix: "Increase to 380-450ms" });
      else if (vadSilenceMs > 650) issues.push({ severity: "medium", field: "vadSilenceMs", label: "Thinking Pause", current: `${vadSilenceMs}ms`, recommended: "400ms", issue: "Long pause makes agent feel unresponsive", fix: "Decrease to 380-450ms" });

      if (temperature > 0.75) issues.push({ severity: "medium", field: "temperature", label: "LLM Temperature", current: temperature, recommended: 0.4, issue: "High temperature causes inconsistent responses and slower generation", fix: "Set to 0.3-0.5 for voice agents" });

      const slowModels = new Set(["gpt-4o", "gpt-4-turbo", "gpt-4", "claude-3-opus-20240229", "claude-3-5-sonnet-20241022", "sarvam-105b"]);
      if (agent.llmModel && slowModels.has(agent.llmModel)) {
        issues.push({ severity: "high", field: "llmModel", label: "LLM Model", current: agent.llmModel, recommended: "gpt-4.1-nano or qwen/qwen3-32b", issue: "This model has 600-1200ms TTFT — very slow for voice calls", fix: "Switch to GPT-4.1 Nano (3x faster) or Qwen 3 32B (free on managed plan)" });
      }

      if (systemPromptLen > 3000) issues.push({ severity: "medium", field: "systemPrompt", label: "System Prompt Length", current: `${systemPromptLen} chars`, recommended: "< 1500 chars", issue: "Long system prompt increases LLM processing time by 200-400ms", fix: "Trim to under 1500 characters — remove redundant instructions" });

      const indic = ["ta-IN", "te-IN", "kn-IN", "ml-IN", "mr-IN", "bn-IN", "gu-IN", "pa-IN"];
      if (agent.asrProvider === "azure" && agent.language && indic.includes(agent.language)) {
        issues.push({ severity: "low", field: "asrProvider", label: "ASR Provider", current: "Azure Speech", recommended: "Sarvam", issue: `Azure isn't optimized for ${agent.language}`, fix: "Switch ASR to Sarvam for Indian languages — 50-100ms faster" });
      }

      const totalAvg = (stats?.avgStt ?? 0) + (stats?.avgLlm ?? 0) + (stats?.avgTts ?? 0);

      return JSON.stringify({
        agent: { id: agent.id, name: agent.name, asrProvider: agent.asrProvider, llmProvider: agent.llmProvider, llmModel: agent.llmModel, ttsProvider: agent.ttsProvider, vadSilenceMs, temperature, systemPromptLength: systemPromptLen },
        callStats: {
          total: stats?.total ?? 0,
          successRate: stats?.total ? Math.round(((stats.completed) / (stats.total)) * 100) : null,
          avgLatencyMs: { stt: stats?.avgStt, llm: stats?.avgLlm, ttsFirstChunk: stats?.avgTts, total: totalAvg || null },
        },
        issues: issues.sort((a, b) => (a.severity === "high" ? -1 : b.severity === "high" ? 1 : 0)),
        overallHealth: issues.some((i) => i.severity === "high") ? "poor" : issues.some((i) => i.severity === "medium") ? "fair" : "good",
      });
    }

    default:
      return JSON.stringify({ error: `Unknown command: ${cmd}` });
  }
}

function stripThinkTags(raw: string): string {
  // Qwen 3 / reasoning models wrap internal monologue in <think>...</think> — strip it
  return raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
}

async function callLLM(
  messages: Array<{ role: string; content: string }>,
  key: string,
  model: string,
  baseUrl: string,
): Promise<string | null> {
  try {
    const isGroq = baseUrl.includes("groq.com");
    const body: Record<string, unknown> = {
      model,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      max_tokens: 1024,
      temperature: 0.65,
    };
    // Disable Qwen 3 chain-of-thought thinking on Groq — keeps responses clean
    if (isGroq) body["reasoning_effort"] = null;

    const r = await fetch(baseUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) return null;
    const data = (await r.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = data.choices?.[0]?.message?.content ?? null;
    return raw ? stripThinkTags(raw) : null;
  } catch (err) {
    logger.warn({ err, model }, "assistant: LLM call error");
    return null;
  }
}

async function runChat(
  messages: ChatMessage[],
  key: string,
  model: string,
  baseUrl: string,
  clerkUserId: string,
): Promise<{ text: string; navigate: string | null; proposal: Proposal | null } | null> {
  const raw1 = await callLLM(messages.map((m) => ({ role: m.role, content: m.content })), key, model, baseUrl);
  if (!raw1) return null;

  const cmd = tryParseCommand(raw1);
  if (cmd) {
    const toolResult = await executeTool(cmd.cmd as string, cmd, clerkUserId);
    const messages2 = [
      ...messages.map((m) => ({ role: m.role, content: m.content })),
      { role: "assistant", content: raw1 },
      { role: "user", content: `[PLATFORM DATA RESULT]:\n${toolResult}\n\nNow give your complete response to the user based on this data.` },
    ];
    const raw2 = await callLLM(messages2, key, model, baseUrl);
    if (!raw2) return null;
    return parseResponse(raw2);
  }

  return parseResponse(raw1);
}

// ── POST /assistant/chat ──────────────────────────────────────────────────────

router.post("/assistant/chat", async (req: Request, res: Response): Promise<void> => {
  const clerkUserId = (req as any).clerkUserId as string;
  const dbUser = (req as any).dbUser;
  if (!clerkUserId || !dbUser) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { message, history, userName, isFirst, pageUrl } = req.body as {
    message: string;
    history?: ChatMessage[];
    userName?: string;
    isFirst?: boolean;
    pageUrl?: string;
  };

  if (!message?.trim()) { res.status(400).json({ error: "message required" }); return; }

  const displayName = (userName || dbUser.name || dbUser.email?.split("@")[0] || "there").trim();
  const contextNote = pageUrl ? `[User is on page: ${pageUrl}] ` : "";

  const userContent = isFirst
    ? `${contextNote}[User name: "${displayName}". First message — greet warmly by first name, welcome to SnapServe, ask what they need help with today.]\n${message}`
    : `${contextNote}${message}`;

  const messages: ChatMessage[] = [
    ...(history ?? []).slice(-10),
    { role: "user", content: userContent },
  ];

  const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
  const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

  const qwenKey = await getSetting("managed_qwen_key");
  if (qwenKey) {
    const result = await runChat(messages, qwenKey, "qwen/qwen3-32b", GROQ_URL, clerkUserId);
    if (result?.text) { res.json(result); return; }
  }

  const openaiKey = await getSetting("managed_openai_key");
  if (openaiKey) {
    const result = await runChat(messages, openaiKey, "gpt-4o-mini", OPENAI_URL, clerkUserId);
    if (result?.text) { res.json(result); return; }
  }

  const fallback = isFirst
    ? `Hi ${displayName}! I'm Orcha, your SnapServe assistant. I can read your agents, diagnose latency issues, write system prompts, and apply fixes for you. What do you need?`
    : "I'm here to help with your agents and calls. Try asking 'why is my agent slow?' or 'show me my agents'.";
  res.json({ text: fallback, navigate: null, proposal: null });
});

// ── POST /assistant/apply — applies proposed changes to an agent ───────────────

const TOP_LEVEL_FIELDS = new Set([
  "asrProvider", "asrModel", "asrLanguage", "llmProvider", "llmModel", "llmFallbackProvider", "llmFallbackModel",
  "ttsProvider", "ttsModel", "ttsVoice", "systemPrompt", "greetingMessage", "temperature",
  "maxDuration", "silenceTimeoutSeconds", "language", "firstSpeaker", "endCallPhrases",
  "backchannelingEnabled", "contextWindowTurns", "noiseCancellationEnabled",
]);

router.post("/assistant/apply", async (req: Request, res: Response): Promise<void> => {
  const clerkUserId = (req as any).clerkUserId as string;
  if (!clerkUserId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { agentId, changes } = req.body as {
    agentId: number;
    changes: Array<{ field: string; proposed_value: unknown }>;
  };

  if (!agentId || !Array.isArray(changes) || changes.length === 0) {
    res.status(400).json({ error: "agentId and changes[] required" });
    return;
  }

  const [agent] = await db
    .select({ id: agentsTable.id, agentConfig: agentsTable.agentConfig })
    .from(agentsTable)
    .where(and(eq(agentsTable.id, agentId), eq(agentsTable.userId, clerkUserId)));

  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }

  const topLevelUpdate: Record<string, unknown> = {};
  const configUpdate: Record<string, unknown> = { ...((agent.agentConfig ?? {}) as Record<string, unknown>) };

  for (const change of changes) {
    if (TOP_LEVEL_FIELDS.has(change.field)) {
      topLevelUpdate[change.field] = change.proposed_value;
    } else {
      configUpdate[change.field] = change.proposed_value;
    }
  }

  await (db
    .update(agentsTable) as any)
    .set({ ...topLevelUpdate, agentConfig: configUpdate, updatedAt: new Date() })
    .where(eq(agentsTable.id, agentId));

  logger.info({ agentId, fields: changes.map((c) => c.field) }, "assistant: applied agent changes");
  res.json({ success: true, appliedFields: changes.map((c) => c.field) });
});

// ── POST /assistant/tts ───────────────────────────────────────────────────────

router.post("/assistant/tts", async (req: Request, res: Response): Promise<void> => {
  const dbUser = (req as any).dbUser;
  if (!dbUser) { res.status(401).json({ error: "Unauthorized" }); return; }

  const { text, voiceId } = req.body as { text: string; voiceId?: string };
  if (!text?.trim()) { res.status(400).json({ error: "text required" }); return; }

  const cartesiaKey = await getSetting("managed_cartesia_key");
  if (!cartesiaKey) {
    res.status(503).json({ error: "TTS unavailable — Cartesia key not configured" });
    return;
  }

  try {
    const cartesiaBase = (process.env["CARTESIA_BASE_URL"] ?? "https://api-india.cartesia.ai").replace(/\/+$/, "");
    const ttsRes = await fetch(`${cartesiaBase}/tts/bytes`, {
      method: "POST",
      headers: {
        "X-API-Key": cartesiaKey,
        "Cartesia-Version": "2026-03-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model_id: "sonic-3.5",
        transcript: text.slice(0, 500),
        voice: { mode: "id", id: voiceId ?? "a0e99841-438c-4a64-b679-ae501e7d6091" },
        output_format: { container: "wav", encoding: "pcm_f32le", sample_rate: 22050 },
      }),
    });

    if (!ttsRes.ok) {
      const err = await ttsRes.text();
      logger.warn({ err }, "assistant: Cartesia TTS error");
      res.status(502).json({ error: `Cartesia error: ${err}` });
      return;
    }

    const audio = await ttsRes.arrayBuffer();
    res.set("Content-Type", "audio/wav");
    res.set("Cache-Control", "no-store");
    res.send(Buffer.from(audio));
  } catch (err) {
    logger.error({ err }, "assistant: TTS request failed");
    res.status(500).json({ error: "TTS failed" });
  }
});

export default router;
