import { Router } from "express";
import type { Request, Response } from "express";
import {
  db,
  agentsTable,
  callsTable,
  campaignsTable,
  phoneNumbersTable,
  platformSettingsTable,
  usersTable,
} from "@workspace/db";
import { eq, and, desc, ne, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import {
  formatBriefForLlm,
  recommendationsFromSnapshot,
  type AssistantRecommendation,
} from "../services/assistant-brief.js";
import { loadWorkspaceSnapshot } from "../services/assistant-brief-load.js";
import { resolveJarvisVoice } from "../services/assistant-voice-resolve.js";
import { JARVIS_TTS_FALLBACK_VOICE_ID, ttsLanguageForText } from "../services/assistant-voice.js";
import {
  JOB_TYPES,
  runAssistantJob,
  runAssistantJobs,
  sanitizeJobs,
  type AssistantJob,
} from "../services/assistant-jobs.js";

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

const SYSTEM_PROMPT = `You are Jarvis — Karthikeyan's voice on SnapServe. You are their friend on the dashboard, and you also build the workspace when they ask. No forms, no "click apply" unless they ask to review a risky change.

VOICE: Speak colloquial Tamil — Chennai / Tamil Nadu spoken Tamil (பேச்சுத் தமிழ்), never literary or news-reader Tamil. Write the reply in Tamil script. Everyday particles are required: டா, மா, இல்ல, சரிப்பா, வேணும், பண்ணு, சொல்லு. English loanwords only for product words (agent, campaign, wallet, number). Sound like a close friend, not a call-center bot. Examples:
- "வணக்கம்டா, நான் ஜார்விஸ். எப்படி இருக்கே? ஏஜென்ட் வேணுமா, இல்ல ஜஸ்ட் பேசலாமா?"
- "பிரியா ரெடிடா. கேம்பெய்ன் டிராஃப்ட்ல வச்சிட்டேன் — லீட்ஸ் இம்போர்ட் பண்ண சொல்லு."
Keep "message" spoken: 1–3 short sentences. No markdown, no lists, no code fences.

LANGUAGE: Default is colloquial Tamil. Switch to English only if their last message is English-only with no Tamil. Do not romanize Tamil (no "eppadi irukka" in the spoken message).

FRIENDLY CHAT: You are also their friend, not only a builder. If they greet, joke, ask how you are, ask what you can do, or just want to talk — talk back warmly. Tease a little. Use their name. Empty jobs and empty recommendations are correct for pure chat. Do not force a build, a page jump, or a next-step card. You can offer help in one short last sentence only if it fits.

CREATE IMMEDIATELY: When they describe a campaign or assignment on an existing agent, emit the job. Do not ask permission. Only refuse delete / release number / start a live dial batch — send them to the page instead.

FULL VIBE BUILD: The dashboard HUD already runs official Vibe Build (same phases, voices, phone numbers, and save path as /app/vibe) when they have no agent yet or they ask to create or build an agent. Do not emit create_agent for that path. You still diagnose, draft campaigns, assign numbers, and publish.

## DATA RETRIEVAL COMMANDS
When you need data, output ONLY a JSON command (nothing else):

Workspace snapshot:     {"cmd":"get_workspace_brief"}
Get all agents:         {"cmd":"list_agents"}
Get agent details:      {"cmd":"get_agent_detail","agent_id":36}
Get call performance:   {"cmd":"get_call_stats","agent_id":36}
Full diagnosis:         {"cmd":"diagnose_agent","agent_id":36}
List campaigns:         {"cmd":"list_campaigns"}
List phone numbers:     {"cmd":"list_phone_numbers"}
Wallet + minutes:       {"cmd":"get_wallet"}

## RESPONSE FORMAT
Always respond with valid JSON (no markdown, no code fences):
{"message":"Spoken reply","navigate":null,"proposal":null,"recommendations":[],"jobs":[]}

"navigate" — send them to a page when that is the job.
"proposal" — agent setting changes they must confirm with Apply.
"recommendations" — 1–3 next steps with {id,title,reason,href,priority}.
"jobs" — actions the system runs immediately (except navigate).

## JOBS
Emit jobs to do the work now. Types:
- create_agent: {"type":"create_agent","label":"Create Priya","agentName":"Priya","useCase":"NBFC loan collection","language":"ta-IN","companyName":"their company","direction":"outbound","gender":"female"}
- create_campaign: {"type":"create_campaign","label":"Website Leads","agentId":36,"campaignName":"Website Leads"}
- assign_phone: {"type":"assign_phone","label":"Assign number","agentId":36,"phoneNumberId":9}
- set_agent_status: {"type":"set_agent_status","label":"Publish Priya","agentId":36,"status":"active"}
- navigate: {"type":"navigate","label":"Open wallet","href":"/app/wallet"}

If you just created an agent and also want a campaign, emit both — create_agent first, then create_campaign without inventing agentId. Never invent IDs for existing records. Destructive work (delete, release number, start a live batch) is navigate-only.

## RECOMMENDATIONS
Lead with the highest-leverage gap: no agent, no phone/WhatsApp, unused number, no campaign, draft-only agent, low wallet, recent failed calls. If the workspace is healthy, recommend a test call.

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

function sanitizeRecs(raw: unknown): AssistantRecommendation[] {
  if (!Array.isArray(raw)) return [];
  const out: AssistantRecommendation[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.title !== "string" || typeof r.href !== "string") continue;
    out.push({
      id: r.id.slice(0, 40),
      title: r.title.slice(0, 80),
      reason: typeof r.reason === "string" ? r.reason.slice(0, 160) : "",
      href: r.href,
      priority: r.priority === "high" || r.priority === "low" ? r.priority : "medium",
    });
    if (out.length >= 4) break;
  }
  return out;
}

function mergeRecs(server: AssistantRecommendation[], llm: AssistantRecommendation[]): AssistantRecommendation[] {
  const seen = new Set(server.map((r) => r.id));
  return [...server, ...llm.filter((r) => !seen.has(r.id))].slice(0, 4);
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

type ChatResult = {
  text: string;
  navigate: string | null;
  proposal: Proposal | null;
  recommendations: AssistantRecommendation[];
  jobs: AssistantJob[];
  done: Array<{ label: string; message: string; href?: string }>;
};

function emptyResult(text: string): ChatResult {
  return { text, navigate: null, proposal: null, recommendations: [], jobs: [], done: [] };
}

async function fulfillJobs(clerkUserId: string, result: ChatResult): Promise<ChatResult> {
  const actionable = result.jobs.filter((j) => j.type !== "navigate");
  if (actionable.length === 0) return result;
  const voice = await resolveJarvisVoice();
  const { results, navigate } = await runAssistantJobs(clerkUserId, actionable, voice);
  const done = results
    .filter((r) => r.success)
    .map((r) => ({
      label: r.message.split(/[.!]/)[0] || "Done",
      message: r.message,
      href: r.navigate,
    }));
  const extra = results.map((r) => r.message).filter(Boolean).join(" ");
  return {
    ...result,
    text: extra ? `${result.text} ${extra}`.trim() : result.text,
    navigate: navigate ?? result.navigate,
    jobs: result.jobs.filter((j) => j.type === "navigate"),
    done,
  };
}

function parseResponse(raw: string): ChatResult {
  const cleaned = raw.trim().replace(/```json\n?|\n?```/g, "").trim();
  if (!cleaned.startsWith("{")) return emptyResult(cleaned);
  try {
    const parsed = JSON.parse(cleaned) as {
      message?: string;
      navigate?: string;
      proposal?: Proposal;
      recommendations?: unknown;
      jobs?: unknown;
    };
    return {
      text: parsed.message ?? cleaned,
      navigate: parsed.navigate ?? null,
      proposal: parsed.proposal ?? null,
      recommendations: sanitizeRecs(parsed.recommendations),
      jobs: sanitizeJobs(parsed.jobs),
      done: [],
    };
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const p = JSON.parse(match[0]) as {
          message?: string;
          navigate?: string;
          proposal?: Proposal;
          recommendations?: unknown;
          jobs?: unknown;
        };
        return {
          text: p.message ?? cleaned,
          navigate: p.navigate ?? null,
          proposal: p.proposal ?? null,
          recommendations: sanitizeRecs(p.recommendations),
          jobs: sanitizeJobs(p.jobs),
          done: [],
        };
      } catch { /* ok */ }
    }
    return emptyResult(cleaned);
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

    case "get_workspace_brief": {
      const snap = await loadWorkspaceSnapshot(clerkUserId);
      return formatBriefForLlm(snap);
    }

    case "list_campaigns": {
      const rows = await db
        .select({
          id: campaignsTable.id,
          name: campaignsTable.name,
          status: campaignsTable.status,
          isActive: campaignsTable.isActive,
          agentId: campaignsTable.agentId,
          totalLeads: campaignsTable.totalLeads,
          calledLeads: campaignsTable.calledLeads,
        })
        .from(campaignsTable)
        .where(eq(campaignsTable.userId, clerkUserId))
        .orderBy(desc(campaignsTable.updatedAt))
        .limit(20);
      return JSON.stringify(rows);
    }

    case "list_phone_numbers": {
      const rows = await db
        .select({
          id: phoneNumbersTable.id,
          number: phoneNumbersTable.number,
          agentId: phoneNumbersTable.agentId,
          status: phoneNumbersTable.status,
        })
        .from(phoneNumbersTable)
        .where(and(
          eq(phoneNumbersTable.userId, clerkUserId),
          eq(phoneNumbersTable.status, "active"),
          ne(phoneNumbersTable.service, "whatsapp"),
        ))
        .limit(20);
      return JSON.stringify(rows);
    }

    case "get_wallet": {
      const [user] = await db
        .select({ walletBalanceCents: usersTable.walletBalanceCents })
        .from(usersTable)
        .where(eq(usersTable.clerkId, clerkUserId))
        .limit(1);
      const cents = user?.walletBalanceCents ?? 0;
      return JSON.stringify({
        balanceInr: Math.round(cents / 100),
        minutesLeft: Math.floor(cents / 500),
        low: cents < 10_000,
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
      max_tokens: 1600,
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
): Promise<ChatResult | null> {
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
  let snapshotRecs: AssistantRecommendation[] = [];
  let briefBlock = "";
  try {
    const snap = await loadWorkspaceSnapshot(clerkUserId);
    snapshotRecs = recommendationsFromSnapshot(snap);
    briefBlock = `\n[WORKSPACE BRIEF]: ${formatBriefForLlm(snap)}\n`;
  } catch (err) {
    logger.warn({ err }, "assistant: workspace brief failed");
  }

  const userContent = isFirst
    ? `${contextNote}${briefBlock}[User name: "${displayName}". First message — greet them as a friend in colloquial Tamil script as Jarvis (Karthikeyan's voice). Ask how they are. Say you can just talk, or build their first agent when they are ready. Do not start building until they ask.]\n${message}`
    : `${contextNote}${briefBlock}${message}`;

  const messages: ChatMessage[] = [
    ...(history ?? []).slice(-10),
    { role: "user", content: userContent },
  ];

  const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
  const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

  const qwenKey = await getSetting("managed_qwen_key");
  if (qwenKey) {
    const result = await runChat(messages, qwenKey, "qwen/qwen3-32b", GROQ_URL, clerkUserId);
    if (result?.text) {
      const fulfilled = await fulfillJobs(clerkUserId, {
        ...result,
        recommendations: mergeRecs(snapshotRecs, result.recommendations),
      });
      res.json(fulfilled);
      return;
    }
  }

  const openaiKey = await getSetting("managed_openai_key");
  if (openaiKey) {
    const result = await runChat(messages, openaiKey, "gpt-4o-mini", OPENAI_URL, clerkUserId);
    if (result?.text) {
      const fulfilled = await fulfillJobs(clerkUserId, {
        ...result,
        recommendations: mergeRecs(snapshotRecs, result.recommendations),
      });
      res.json(fulfilled);
      return;
    }
  }

  const fallback = isFirst
    ? `வணக்கம் ${displayName}, நான் ஜார்விஸ். எப்படி இருக்கே? பேசலாம் — இல்ல ஏஜென்ட் வேணும்னா சொல்லு, நான் Vibe-ல பில்ட் பண்ணிடுவேன்.`
    : "சொல்லுடா — பேசலாம், இல்ல ஏஜென்ட், கேம்பெய்ன், நம்பர் — என்ன வேணுமோ.";
  res.json({
    text: fallback,
    navigate: null,
    proposal: null,
    recommendations: snapshotRecs,
    jobs: [],
    done: [],
  });
});

// ── GET /assistant/brief — live recommendations without chatting ──────────────

router.get("/assistant/brief", async (req: Request, res: Response): Promise<void> => {
  const clerkUserId = (req as any).clerkUserId as string;
  if (!clerkUserId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const snap = await loadWorkspaceSnapshot(clerkUserId);
  res.json({
    snapshot: snap,
    recommendations: recommendationsFromSnapshot(snap),
  });
});

// ── POST /assistant/job — confirmable workspace actions ───────────────────────

router.post("/assistant/job", async (req: Request, res: Response): Promise<void> => {
  const clerkUserId = (req as any).clerkUserId as string;
  if (!clerkUserId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const job = req.body as AssistantJob;
  if (!job || typeof job.type !== "string" || !JOB_TYPES.has(job.type)) {
    res.status(400).json({ error: "Unsupported job" });
    return;
  }

  const voice = await resolveJarvisVoice();
  const result = await runAssistantJob(clerkUserId, job, voice);
  if (!result.success) {
    res.status(400).json({ error: result.message });
    return;
  }
  res.json(result);
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

  const jarvisVoice = voiceId || (await resolveJarvisVoice()).voiceId || JARVIS_TTS_FALLBACK_VOICE_ID;

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
        transcript: text.slice(0, 700),
        language: ttsLanguageForText(text),
        voice: { mode: "id", id: jarvisVoice },
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
