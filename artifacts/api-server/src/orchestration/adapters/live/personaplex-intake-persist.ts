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
import { intakeExtraOf, loadIntakeByCallId, persistRecruiterProfile } from "../../../lib/intake-service.js";
import { logger } from "../../../lib/logger.js";
import {
  decideNext,
  emptyRecruiterProfile,
  sanitizeIntakeWrite,
  type RecruiterDecision,
  type RecruiterProfile,
} from "../../../lib/recruiter-brain.js";
import { writeExecutionLog } from "../../../services/execution-log.js";

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
  profile?: RecruiterProfile;
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
    "Never copy a salary, company, opening, name, or email the agent invented or restated. Only what the candidate said.",
    "Do not save email unless the candidate's own words contain a full address (including the domain).",
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
      const args = opts.profile
        ? sanitizeIntakeWrite(call.args, opts.profile, userText)
        : call.args;
      await executeIntakeWrite(opts.ctx, args);
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
  private profile: RecruiterProfile = emptyRecruiterProfile();
  private readonly userTurns: string[] = [];
  private lastCoach = "";

  constructor(
    private readonly opts: {
      llm: LLMAdapter;
      ctx: IntakeToolContext;
      systemPrompt: string;
      history: () => ConversationTurn[];
      lastAgentText: () => string | null;
      onDecision?: (decision: RecruiterDecision) => void;
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
    const t0 = Date.now();
    try {
      // In-memory profile is the live source of truth. Reloading extra.recruiter
      // every STT final wiped facts when the intake row had no recruiter yet
      // (08:42 call: coach bounced back to "what job" after Bangalore).
      this.userTurns.push(userText);
      const decision = decideNext(this.profile, userText, this.userTurns);
      this.profile = { ...this.profile, ...decision.profile_patch, current_state: decision.state };
      await persistRecruiterProfile(this.opts.ctx.callId, this.profile);
      writeExecutionLog(this.opts.ctx.callId, this.opts.ctx.agentId, "RecruiterBrain", "system", {
        status: "info",
        latencyMs: Date.now() - t0,
        metadata: {
          current_state: decision.state,
          previous_state: decision.previous_state,
          question_reason: decision.reason,
          profile_patch: decision.profile_patch,
          communication_class: decision.communication_class,
          outcome: decision.outcome,
        },
      });
      if (decision.coachText && decision.coachText !== this.lastCoach) {
        this.lastCoach = decision.coachText;
        try { this.opts.onDecision?.(decision); } catch { /* coach must never break persist */ }
      }
      await persistIntakeFromSpokenTurn({
        llm: this.opts.llm,
        ctx: this.opts.ctx,
        systemPrompt: this.opts.systemPrompt,
        history: this.opts.history(),
        userText,
        agentText: this.opts.lastAgentText(),
        profile: this.profile,
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
