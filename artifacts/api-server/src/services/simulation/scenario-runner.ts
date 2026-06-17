import { db } from "@workspace/db";
import { simulationRunsTable, simulationMessagesTable, simulationTestCasesTable, agentsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { runPersonaTurn } from "./persona.js";
import { scoreRun } from "./scorer.js";
import { callLlmDirect, getLlmApiKey } from "./chat.js";
import { logger } from "../../lib/logger.js";

export type ScenarioProgressCallback = (event: ScenarioEvent) => void;

export type ScenarioEvent =
  | { type: "persona_message"; turn: number; content: string }
  | { type: "agent_message"; turn: number; content: string; toolsCalled?: Array<{ name: string; args: Record<string, unknown> }> }
  | { type: "tool_call"; turn: number; name: string; args: Record<string, unknown> }
  | { type: "completed"; score: number; pass: boolean; result: unknown }
  | { type: "failed"; error: string; turn?: number; step?: "validation" | "persona" | "agent" };

/**
 * Run a full scenario simulation: AI persona ↔ agent LLM loop.
 * All message persistence is handled here (single source of truth, no duplicate inserts).
 */
export async function runScenario(
  runId: number,
  testCaseId: number,
  userId: string,
  maxTurns: number,
  onProgress: ScenarioProgressCallback,
): Promise<void> {
  const [testCase] = await db
    .select()
    .from(simulationTestCasesTable)
    .where(eq(simulationTestCasesTable.id, testCaseId));

  if (!testCase) {
    await db
      .update(simulationRunsTable)
      .set({ status: "failed", completedAt: new Date() })
      .where(eq(simulationRunsTable.id, runId));
    onProgress({ type: "failed", error: "Test case not found" });
    return;
  }

  // ── Pre-run validation ──────────────────────────────────────────────────────
  const [agent] = await db
    .select()
    .from(agentsTable)
    .where(and(eq(agentsTable.id, testCase.agentId), eq(agentsTable.userId, userId)));

  if (!agent) {
    await db
      .update(simulationRunsTable)
      .set({ status: "failed", completedAt: new Date() })
      .where(eq(simulationRunsTable.id, runId));
    onProgress({ type: "failed", error: "Agent not found", step: "validation" });
    return;
  }

  if (!agent.systemPrompt?.trim()) {
    await db
      .update(simulationRunsTable)
      .set({ status: "failed", completedAt: new Date() })
      .where(eq(simulationRunsTable.id, runId));
    onProgress({ type: "failed", error: "Agent has no system prompt — add one in the agent settings before running a simulation", step: "validation" });
    return;
  }

  const llmKey = await getLlmApiKey(userId, agent.llmProvider);
  if (!llmKey) {
    await db
      .update(simulationRunsTable)
      .set({ status: "failed", completedAt: new Date() })
      .where(eq(simulationRunsTable.id, runId));
    onProgress({ type: "failed", error: `No API key for provider "${agent.llmProvider}" — add it in Providers`, step: "validation" });
    return;
  }

  await db
    .update(simulationRunsTable)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(simulationRunsTable.id, runId));

  // History maintained in scenario-runner; NOT re-read from DB each turn.
  // role "assistant" is what the LLM adapter expects on the agent side.
  const conversationHistory: Array<{ role: "user" | "assistant"; content: string }> = [];

  const extraVariables: Record<string, string> | null =
    testCase.variables
      ? Object.fromEntries(
          Object.entries(testCase.variables as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
        )
      : null;

  const extraKbSourceIds: number[] = testCase.kbSourceId ? [testCase.kbSourceId] : [];

  let turn = 0;
  let ended = false;
  let currentStep: "persona" | "agent" = "persona";

  try {
    while (turn < maxTurns && !ended) {
      turn++;

      // ── Persona (customer) turn ─────────────────────────────────────────────
      currentStep = "persona";
      const personaTurn = await runPersonaTurn(
        testCase.personaPrompt,
        // Persona sees history in "user = customer, agent = assistant" framing
        conversationHistory.map((m) => ({
          role: (m.role === "assistant" ? "agent" : "user") as "user" | "agent",
          content: m.content,
        })),
        testCase.goal,
      );

      // Persist persona message (single insert here, not in callLlmDirect)
      await db.insert(simulationMessagesTable).values({
        simulationRunId: runId,
        role: "user",
        content: personaTurn.message,
        metadata: { turn, source: "persona" },
      });

      onProgress({ type: "persona_message", turn, content: personaTurn.message });

      if (personaTurn.shouldEnd) {
        ended = true;
        break;
      }

      // ── Agent turn ──────────────────────────────────────────────────────────
      currentStep = "agent";
      const toolsCalled: Array<{ name: string; args: Record<string, unknown> }> = [];

      const { text: agentReply, debug } = await callLlmDirect(
        testCase.agentId,
        userId,
        conversationHistory, // prior history WITHOUT the current persona message
        personaTurn.message, // current user message — appended inside callLlmDirect
        {
          extraVariables,
          extraKbSourceIds,
          onToolCall: (name, args) => {
            toolsCalled.push({ name, args });
            onProgress({ type: "tool_call", turn, name, args });
          },
        },
      );

      // Persist agent message (single insert here)
      await db.insert(simulationMessagesTable).values({
        simulationRunId: runId,
        role: "agent",
        content: agentReply,
        metadata: {
          turn,
          toolsCalled: debug.toolsCalled,
          inputTokens: debug.inputTokens,
          outputTokens: debug.outputTokens,
          latencyMs: debug.latencyMs,
        },
      });

      // Update history for next turn
      conversationHistory.push({ role: "user", content: personaTurn.message });
      conversationHistory.push({ role: "assistant", content: agentReply });

      onProgress({ type: "agent_message", turn, content: agentReply, toolsCalled });

      // Natural conversation end detection
      const lower = agentReply.toLowerCase();
      if (
        lower.includes("goodbye") ||
        lower.includes("have a great day") ||
        lower.includes("thank you for calling") ||
        lower.includes("is there anything else")
      ) {
        // Give the persona one more turn to respond before ending
        if (turn >= Math.floor(maxTurns * 0.6)) {
          ended = true;
        }
      }
    }

    const scored = await scoreRun(runId, testCase.successCriteria ?? []);
    onProgress({ type: "completed", score: scored.overall, pass: scored.pass, result: scored });
  } catch (err) {
    logger.error({ runId, testCaseId, turn, step: currentStep, err }, "runScenario: error");
    await db
      .update(simulationRunsTable)
      .set({ status: "failed", completedAt: new Date() })
      .where(eq(simulationRunsTable.id, runId));
    const message = err instanceof Error ? err.message : String(err);
    onProgress({ type: "failed", error: `Turn ${turn} (${currentStep}): ${message}`, turn, step: currentStep });
  }
}
