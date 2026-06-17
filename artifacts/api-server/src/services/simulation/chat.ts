import { db, agentsTable, providersTable, platformSettingsTable } from "@workspace/db";
import { simulationRunsTable, simulationMessagesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { createLLMAdapter } from "../../orchestration/adapters/llm/index.js";
import { buildToolDefs, matchToolByName } from "../tool-executor.js";
import { retrieveKbContextMulti } from "../../orchestration/kb-retrieval.js";
import { decryptKey } from "../../lib/crypto.js";
import { logger } from "../../lib/logger.js";
import type { ConversationTurn, ToolDefinition, AgentTool } from "../../orchestration/types.js";

export interface ChatDebugInfo {
  resolvedPrompt: string;
  kbChunks: string;
  toolsCalled: Array<{ name: string; args: Record<string, unknown>; result?: string }>;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  variables: Record<string, string>;
}

export interface ChatTurnResult {
  runId: number;
  agentText: string;
  debug: ChatDebugInfo;
}

/* ── LLM API key resolution ──────────────────────────────────────────────────── */

export async function getLlmApiKey(userId: string, llmProvider: string): Promise<string | null> {
  const [row] = await db
    .select({ apiKey: providersTable.apiKey })
    .from(providersTable)
    .where(and(eq(providersTable.userId, userId), eq(providersTable.providerName, llmProvider)));

  if (row?.apiKey) {
    return decryptKey(row.apiKey);
  }

  if (llmProvider === "groq" || llmProvider === "qwen") {
    try {
      const [setting] = await db
        .select({ value: platformSettingsTable.value })
        .from(platformSettingsTable)
        .where(eq(platformSettingsTable.key, "managed_qwen_key"));
      if (setting?.value) return setting.value;
    } catch {
      // fall through
    }
    return (process.env["GROQ_API_KEY"] ?? "").trim() || null;
  }

  return null;
}

/* ── Simulation-safe mock tool executor ─────────────────────────────────────── */
// Mirrors pipeline turn semantics (tool call → result → LLM continuation) without
// creating real bookings, firing webhooks, or causing any production side-effects.

async function executeSimulationTool(
  toolName: string,
  args: Record<string, unknown>,
  agentTools: AgentTool[],
): Promise<string> {
  if (toolName === "end_call") return "call_ended";

  const tool = matchToolByName(agentTools, toolName);
  if (!tool) return "success";

  switch (tool.type) {
    case "native_booking": {
      const attendeeName = String(args["attendee_name"] ?? args["name"] ?? "Test User");
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(10, 0, 0, 0);
      const code = `SIM-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
      return (
        `booking_confirmed: Appointment booked for ${attendeeName} on ${d.toDateString()} at 10:00 AM. ` +
        `Confirmation code: ${code}. [SIMULATED — no actual booking was created]`
      );
    }
    case "native_check_availability": {
      const base = new Date();
      base.setDate(base.getDate() + 1);
      base.setHours(0, 0, 0, 0);
      const slots = [10, 14, 16].map((h) => {
        const d = new Date(base);
        d.setHours(h, 0, 0, 0);
        return d.toISOString().slice(0, 16);
      });
      return `available_slots: ${JSON.stringify(slots)} [SIMULATED]`;
    }
    case "native_list_bookings":
      return `bookings: [] (no bookings in simulation context) [SIMULATED]`;
    case "native_reschedule":
      return `rescheduled: Appointment has been rescheduled successfully. [SIMULATED]`;
    case "native_cancel":
      return `cancelled: Appointment has been cancelled. [SIMULATED]`;
    case "webhook":
      return JSON.stringify({ success: true, message: "Webhook received (simulated)", simulated: true });
    case "transfer_cold":
    case "transfer_warm":
    case "transfer_agent":
      return `transfer_initiated: Simulated transfer to ${
        (tool as any).targetNumber ?? (tool as any).targetAgentId ?? "target"
      }. [SIMULATED]`;
    default:
      return "success";
  }
}

/* ── runChatTurn — manual chat with DB persistence ──────────────────────────── */

export async function runChatTurn(
  agentId: number,
  userId: string,
  runId: number | null,
  userMessage: string,
  onToken: (token: string) => void,
  onDebug: (info: Partial<ChatDebugInfo>) => void,
): Promise<ChatTurnResult> {
  const startMs = Date.now();

  const [agent] = await db
    .select()
    .from(agentsTable)
    .where(and(eq(agentsTable.id, agentId), eq(agentsTable.userId, userId)));

  if (!agent) throw new Error(`Agent ${agentId} not found`);

  const llmProvider = agent.llmProvider;
  const llmModel = agent.llmModel ?? null;
  const apiKey = await getLlmApiKey(userId, llmProvider);

  if (!apiKey) {
    throw new Error(`No API key found for LLM provider "${llmProvider}". Add it in the Providers section.`);
  }

  const llm = createLLMAdapter(llmProvider, apiKey, llmModel);

  let activeRunId = runId;
  if (!activeRunId) {
    const [newRun] = await db
      .insert(simulationRunsTable)
      .values({ agentId, userId, status: "running", startedAt: new Date() })
      .returning({ id: simulationRunsTable.id });
    activeRunId = newRun!.id;
  } else {
    await db
      .update(simulationRunsTable)
      .set({ status: "running" })
      .where(eq(simulationRunsTable.id, activeRunId));
  }

  await db.insert(simulationMessagesTable).values({
    simulationRunId: activeRunId,
    role: "user",
    content: userMessage,
  });

  const kbSourceIds: number[] = ((agent as any).knowledgeSourceIds as number[] | null) ?? [];
  let kbChunks = "";
  if (kbSourceIds.length > 0) {
    kbChunks = await retrieveKbContextMulti(kbSourceIds, userMessage).catch(() => "");
  }

  const variables: Record<string, string> = {};
  const promptVars: Array<{ key: string; defaultValue: string }> =
    ((agent as any).agentConfig as any)?.promptVariables ?? [];
  for (const v of promptVars) {
    variables[v.key] = v.defaultValue;
  }

  let systemPrompt = agent.systemPrompt ?? "";
  for (const [k, v] of Object.entries(variables)) {
    systemPrompt = systemPrompt.replace(new RegExp(`{{${k}}}`, "g"), v);
  }
  if (kbChunks) {
    systemPrompt += `\n\n## Knowledge Base Context\n${kbChunks}`;
  }

  onDebug({ resolvedPrompt: systemPrompt, kbChunks, variables });

  const existingMessages = await db
    .select()
    .from(simulationMessagesTable)
    .where(eq(simulationMessagesTable.simulationRunId, activeRunId))
    .orderBy(simulationMessagesTable.createdAt);

  // fullHistory includes the user message just persisted
  const fullHistory: ConversationTurn[] = existingMessages
    .filter((m) => m.role === "user" || m.role === "agent")
    .map((m) => ({
      role: (m.role === "agent" ? "assistant" : "user") as "user" | "assistant",
      content: m.content,
    }));

  const agentTools: AgentTool[] = ((agent.tools ?? []) as unknown as AgentTool[]);
  const toolDefs: ToolDefinition[] = buildToolDefs(agentTools).filter(
    (t) => t.name !== "end_call",
  );

  let agentText = "";
  const toolsCalled: Array<{ name: string; args: Record<string, unknown>; result?: string }> = [];
  let inputTokens = 0;
  let outputTokens = 0;

  // ── Tool execution loop ────────────────────────────────────────────────────
  // Mirrors pipeline.ts: tool call → mock execute → inject result → continue LLM.
  // Prevents double-booking and other prod side-effects while preserving full
  // conversation turn semantics for testing tool-driven agent flows.
  const MAX_TOOL_DEPTH = 5;
  let depth = 0;

  while (depth <= MAX_TOOL_DEPTH) {
    let triggeredToolName: string | null = null;
    let triggeredToolArgs: Record<string, unknown> = {};
    let turnText = "";

    await llm.chat(
      fullHistory,
      systemPrompt,
      (token) => {
        turnText += token;
        agentText += token;
        onToken(token);
      },
      (_full, usage) => {
        if (usage) {
          inputTokens += usage.inputTokens;
          outputTokens += usage.outputTokens;
        }
      },
      {
        tools: toolDefs.length > 0 ? toolDefs : undefined,
        onToolCall: (name, args) => {
          triggeredToolName = name;
          triggeredToolArgs = args;
          onDebug({ toolsCalled: [...toolsCalled, { name, args }] });
        },
      },
    );

    if (!triggeredToolName) break;

    // Inject tool call marker into ephemeral history for next LLM turn
    const markerContent = turnText.trim()
      ? `${turnText.trim()}\n[calling tool: ${triggeredToolName}]`
      : `[calling tool: ${triggeredToolName}]`;
    fullHistory.push({ role: "assistant", content: markerContent });

    const toolResult = await executeSimulationTool(triggeredToolName, triggeredToolArgs, agentTools);
    toolsCalled.push({ name: triggeredToolName, args: triggeredToolArgs, result: toolResult });
    onDebug({ toolsCalled: [...toolsCalled] });

    fullHistory.push({
      role: "user",
      content: `[Tool result for ${triggeredToolName}]: ${toolResult}`,
    });

    if (triggeredToolName === "end_call") break;

    depth++;
  }

  // Strip <think>...</think> blocks that Qwen3 may emit even with thinking mode disabled
  agentText = agentText.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  const latencyMs = Date.now() - startMs;

  await db.insert(simulationMessagesTable).values({
    simulationRunId: activeRunId,
    role: "agent",
    content: agentText || "(no response)",
    metadata: {
      toolsCalled,
      inputTokens,
      outputTokens,
      latencyMs,
    },
  });

  const debug: ChatDebugInfo = {
    resolvedPrompt: systemPrompt,
    kbChunks,
    toolsCalled,
    latencyMs,
    inputTokens,
    outputTokens,
    variables,
  };

  onDebug(debug);

  logger.info({ agentId, runId: activeRunId, latencyMs, inputTokens, outputTokens }, "simulation chat turn completed");

  return { runId: activeRunId, agentText: agentText || "(no response)", debug };
}

/* ── callLlmDirect — pure LLM call, no DB writes ───────────────────────────── */
// Used by scenario-runner.ts which owns all message persistence.
// Includes a simulation-safe tool execution loop so agents that use native
// booking / webhook / transfer tools are tested with full pipeline fidelity.

export async function callLlmDirect(
  agentId: number,
  userId: string,
  priorHistory: Array<{ role: "user" | "assistant"; content: string }>,
  userMessage: string,
  opts?: {
    extraVariables?: Record<string, string> | null;
    extraKbSourceIds?: number[];
    onToken?: (token: string) => void;
    onToolCall?: (name: string, args: Record<string, unknown>) => void;
  },
): Promise<{ text: string; debug: ChatDebugInfo }> {
  const startMs = Date.now();

  const [agent] = await db
    .select()
    .from(agentsTable)
    .where(and(eq(agentsTable.id, agentId), eq(agentsTable.userId, userId)));

  if (!agent) throw new Error(`Agent ${agentId} not found`);

  const apiKey = await getLlmApiKey(userId, agent.llmProvider);
  if (!apiKey) {
    throw new Error(
      `No API key found for LLM provider "${agent.llmProvider}". Add it in the Providers section.`,
    );
  }

  const llm = createLLMAdapter(agent.llmProvider, apiKey, agent.llmModel ?? null);

  const agentKbSourceIds: number[] =
    ((agent as any).knowledgeSourceIds as number[] | null) ?? [];
  const allKbSourceIds = [
    ...new Set([...agentKbSourceIds, ...(opts?.extraKbSourceIds ?? [])]),
  ];
  let kbChunks = "";
  if (allKbSourceIds.length > 0) {
    kbChunks = await retrieveKbContextMulti(allKbSourceIds, userMessage).catch(() => "");
  }

  const promptVars: Array<{ key: string; defaultValue: string }> =
    ((agent as any).agentConfig as any)?.promptVariables ?? [];
  const variables: Record<string, string> = {};
  for (const v of promptVars) {
    variables[v.key] = v.defaultValue;
  }
  if (opts?.extraVariables) {
    for (const [k, v] of Object.entries(opts.extraVariables)) {
      variables[k] = v;
    }
  }

  let systemPrompt = agent.systemPrompt ?? "";
  for (const [k, v] of Object.entries(variables)) {
    systemPrompt = systemPrompt.replace(new RegExp(`{{${k}}}`, "g"), v);
  }
  if (kbChunks) {
    systemPrompt += `\n\n## Knowledge Base Context\n${kbChunks}`;
  }

  const fullHistory: ConversationTurn[] = [
    ...priorHistory,
    { role: "user", content: userMessage },
  ];

  const agentTools: AgentTool[] = ((agent.tools ?? []) as unknown as AgentTool[]);
  const toolDefs: ToolDefinition[] = buildToolDefs(agentTools).filter(
    (t) => t.name !== "end_call",
  );

  let agentText = "";
  const toolsCalled: Array<{ name: string; args: Record<string, unknown>; result?: string }> = [];
  let inputTokens = 0;
  let outputTokens = 0;

  // ── Tool execution loop ────────────────────────────────────────────────────
  const MAX_TOOL_DEPTH = 5;
  let depth = 0;

  while (depth <= MAX_TOOL_DEPTH) {
    let triggeredToolName: string | null = null;
    let triggeredToolArgs: Record<string, unknown> = {};

    await llm.chat(
      fullHistory,
      systemPrompt,
      (token) => {
        agentText += token;
        opts?.onToken?.(token);
      },
      (_full, usage) => {
        if (usage) {
          inputTokens += usage.inputTokens;
          outputTokens += usage.outputTokens;
        }
      },
      {
        tools: toolDefs.length > 0 ? toolDefs : undefined,
        onToolCall: (name, args) => {
          triggeredToolName = name;
          triggeredToolArgs = args;
          opts?.onToolCall?.(name, args);
        },
      },
    );

    if (!triggeredToolName) break;

    // Capture any text emitted alongside the tool call, then inject into history
    const markerContent = agentText.trim()
      ? `${agentText.trim()}\n[calling tool: ${triggeredToolName}]`
      : `[calling tool: ${triggeredToolName}]`;
    fullHistory.push({ role: "assistant", content: markerContent });

    const toolResult = await executeSimulationTool(triggeredToolName, triggeredToolArgs, agentTools);
    toolsCalled.push({ name: triggeredToolName, args: triggeredToolArgs, result: toolResult });

    fullHistory.push({
      role: "user",
      content: `[Tool result for ${triggeredToolName}]: ${toolResult}`,
    });

    // Reset agentText so only the continuation text is returned as the agent response
    agentText = "";

    if (triggeredToolName === "end_call") {
      agentText = agentText || "Thank you for calling. Goodbye!";
      break;
    }

    depth++;
  }

  // Strip <think>...</think> blocks that Qwen3 may emit even with thinking mode disabled
  agentText = agentText.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  const latencyMs = Date.now() - startMs;

  const debug: ChatDebugInfo = {
    resolvedPrompt: systemPrompt,
    kbChunks,
    toolsCalled,
    latencyMs,
    inputTokens,
    outputTokens,
    variables,
  };

  return { text: agentText || "(no response)", debug };
}
