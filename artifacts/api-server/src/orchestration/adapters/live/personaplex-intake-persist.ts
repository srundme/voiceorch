/**
 * PersonaPlex cannot call SnapServe tools. Form fill is a silent sidecar:
 * caller STT (or a user transcript we already have) → persist LLM →
 * save_candidate_details / set_disposition. Never blocks the spoken GPU path.
 */
import type { AgentTool, ConversationTurn, LLMAdapter, ToolDefinition } from "../../types.js";
import { buildToolDefs } from "../../../services/tool-executor.js";
import { isBackgroundIntakeTool } from "../../tool-fillers.js";
import { intakeAgentTools } from "../../../lib/intake-agent.js";
import {
  executeIntakeDisposition,
  executeIntakeSubmit,
  executeIntakeWrite,
  type IntakeToolContext,
} from "../../intake-tools.js";
import { evaluateIntakeScreen } from "../../../lib/intake-screen.js";
import { intakeExtraOf, loadIntakeByCallId } from "../../../lib/intake-service.js";
import { logger } from "../../../lib/logger.js";

export function buildIntakePersistTools(agentTools?: AgentTool[]): ToolDefinition[] {
  const tools = agentTools?.some((t) => t.type === "intake_write")
    ? agentTools
    : intakeAgentTools();
  return buildToolDefs(tools).filter((t) => isBackgroundIntakeTool(t.name));
}

export async function persistIntakeFromSpokenTurn(opts: {
  llm: LLMAdapter;
  ctx: IntakeToolContext;
  systemPrompt: string;
  history: ConversationTurn[];
  userText: string;
  agentText?: string | null;
}): Promise<{ tools: string[] }> {
  const persistTools = buildIntakePersistTools();
  const userText = opts.userText.trim();
  if (!userText || persistTools.length === 0) return { tools: [] };

  const agentLine = (opts.agentText ?? "").trim();
  const persistPrompt = [
    opts.systemPrompt,
    "",
    "[BACKGROUND SAVE — do not speak]",
    `The candidate just said: "${userText.slice(0, 500)}"`,
    agentLine ? `The agent last said: "${agentLine.slice(0, 300)}"` : "",
    "Call save_candidate_details and/or set_disposition with only the fields they just gave.",
    "If they named a workplace or how long they have worked, save lastCompany and tenure.",
    "6-digit Indian PIN goes in pincode, never dateOfBirth.",
    "Do not speak. Do not call finish_intake or end_call.",
  ].filter(Boolean).join("\n");

  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  try {
    await opts.llm.chat(
      opts.history.slice(-12),
      persistPrompt,
      () => {},
      () => {},
      {
        tools: persistTools,
        onToolCall: (name, args) => {
          if (isBackgroundIntakeTool(name)) calls.push({ name, args });
        },
      },
    );
  } catch (err) {
    logger.warn({ callId: opts.ctx.callId, err }, "PersonaPlex intake persist LLM failed");
    return { tools: [] };
  }

  const ran: string[] = [];
  for (const call of calls) {
    if (call.name === "save_candidate_details") {
      await executeIntakeWrite(opts.ctx, call.args);
      ran.push(call.name);
    } else if (call.name === "set_disposition") {
      await executeIntakeDisposition(opts.ctx, call.args);
      ran.push(call.name);
    }
  }

  if (ran.includes("save_candidate_details")) {
    const row = await loadIntakeByCallId(opts.ctx.callId);
    if (row) {
      const cue = evaluateIntakeScreen(row, intakeExtraOf(row));
      if (cue.canFinish) {
        await executeIntakeSubmit(opts.ctx);
        ran.push("finish_intake");
      }
    }
  }

  if (ran.length > 0) {
    logger.info({ callId: opts.ctx.callId, tools: ran, user: userText.slice(0, 80) }, "PersonaPlex intake persist");
  }
  return { tools: ran };
}

export class PersonaplexIntakePersist {
  private inFlight = false;
  private queued: string | null = null;

  constructor(
    private readonly opts: {
      llm: LLMAdapter;
      ctx: IntakeToolContext;
      systemPrompt: string;
      history: () => ConversationTurn[];
      lastAgentText: () => string | null;
    },
  ) {}

  noteUserTurn(text: string): void {
    const t = text.trim();
    if (!t) return;
    if (this.inFlight) {
      this.queued = t;
      return;
    }
    void this.run(t);
  }

  private async run(userText: string): Promise<void> {
    this.inFlight = true;
    try {
      await persistIntakeFromSpokenTurn({
        llm: this.opts.llm,
        ctx: this.opts.ctx,
        systemPrompt: this.opts.systemPrompt,
        history: this.opts.history(),
        userText,
        agentText: this.opts.lastAgentText(),
      });
    } catch (err) {
      logger.warn({ callId: this.opts.ctx.callId, err }, "PersonaPlex intake persist turn failed");
    } finally {
      this.inFlight = false;
      const next = this.queued;
      this.queued = null;
      if (next) void this.run(next);
    }
  }
}
