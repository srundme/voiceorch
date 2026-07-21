import type { AgentConfig, AgentTool, SessionConfig } from "../../types.js";
import { resolveGoodbyeMessage } from "../../types.js";
import {
  matchToolByName,
  executeNativeBooking,
  executeNativeCheckAvailability,
  executeNativeListBookings,
  executeNativeReschedule,
  executeNativeCancel,
  executeWebhookTool,
} from "../../../services/tool-executor.js";
import { executeAnalyzeImage } from "../../../services/vision-analyze.js";
import { scheduleCallbackRequested } from "../../../services/autoRedial.js";
import { resolveCallbackTime } from "../../../lib/tz-datetime.js";
import { logger } from "../../../lib/logger.js";

export interface LiveToolRunnerDeps {
  config: SessionConfig;
  agent: AgentConfig;
  onAgentText: (text: string) => void;
  speakText: (text: string) => Promise<void>;
  endCall: () => void;
  /** Fired when analyze_image returns a successful description. */
  onAnalyzeImageResult?: (text: string) => void;
}

/**
 * Execute a single Live API function call synchronously and return the JSON
 * result payload for sendToolResponse.
 */
export async function runLiveToolCall(
  deps: LiveToolRunnerDeps,
  toolName: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { config, agent, onAgentText, speakText, endCall } = deps;

  if (toolName === "end_call") {
    const endCallTool = agent.tools.find((t) => t.type === "end_call");
    const goodbye = resolveGoodbyeMessage(
      endCallTool?.type === "end_call" ? endCallTool.goodbyeMessage : undefined,
      agent.endCallPhrases,
    );
    onAgentText(goodbye);
    await speakText(goodbye);
    endCall();
    return { output: "call_ended" };
  }

  if (toolName === "schedule_callback") {
    const toNumber = config.callerPhone ?? "";
    const scheduledAtRaw = args["scheduled_at"] as string | undefined;
    const notes = args["notes"] as string | undefined;
    const cbTz = agent.timezone?.trim() || "Asia/Kolkata";
    const { scheduledAt, wasDefaulted, wasClamped } = resolveCallbackTime(scheduledAtRaw, cbTz);
    if (toNumber) {
      await scheduleCallbackRequested({
        agentId: agent.id,
        toNumber,
        scheduledAt,
        callId: config.callId,
        notes,
      });
      const cbLocal = scheduledAt.toLocaleString("en-IN", {
        weekday: "long", day: "numeric", month: "long",
        hour: "numeric", minute: "2-digit", hour12: true, timeZone: cbTz,
      });
      logger.info(
        { callId: config.callId, agentId: agent.id, toNumber, scheduledAtRaw, scheduledAt, tz: cbTz, wasDefaulted, wasClamped },
        "Live: schedule_callback invoked by LLM",
      );
      return {
        output:
          `Callback recorded for ${cbLocal} (${cbTz}). Confirm THIS exact time to the caller, then close with a proper goodbye.`,
      };
    }
    return { output: "Callback noted." };
  }

  const tool = matchToolByName(agent.tools, toolName);
  if (!tool) {
    logger.warn({ callId: config.callId, toolName }, "Live: unknown tool call");
    return { error: `Unknown tool: ${toolName}` };
  }

  try {
    const result = await executeLiveAgentTool(deps, tool, args);
    if (result === undefined) return { output: "ok" };
    return { output: result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ callId: config.callId, toolName, err }, "Live tool execution failed");
    return { error: message };
  }
}

async function executeLiveAgentTool(
  deps: LiveToolRunnerDeps,
  tool: AgentTool,
  args: Record<string, unknown>,
): Promise<string | undefined> {
  const { config, agent, onAgentText, speakText, endCall } = deps;
  const callId = config.callId;
  const agentId = agent.id;

  switch (tool.type) {
    case "call_transfer": {
      const ok = (await config.onCallTransfer?.(tool.transferTo)) ?? true;
      if (!ok) return "transfer_failed: unable to connect to a human agent at this time";
      endCall();
      return undefined;
    }
    case "transfer_cold": {
      if (!tool.targetNumber?.trim()) return "transfer_unavailable: no transfer number configured";
      if (tool.holdMessage?.trim()) {
        onAgentText(tool.holdMessage);
        await speakText(tool.holdMessage);
      }
      const ok = (await config.onCallTransfer?.(tool.targetNumber)) ?? true;
      if (!ok) return "transfer_failed: unable to connect to a human agent at this time";
      endCall();
      return undefined;
    }
    case "transfer_warm": {
      if (!tool.targetNumber?.trim()) return "transfer_unavailable: no transfer number configured";
      if (tool.holdMessage?.trim()) {
        onAgentText(tool.holdMessage);
        await speakText(tool.holdMessage);
      }
      const ok = (await config.onCallTransfer?.(tool.targetNumber)) ?? true;
      if (!ok) return "transfer_failed: unable to connect to a human agent at this time";
      endCall();
      return undefined;
    }
    case "transfer_agent": {
      const targetId = tool.targetAgentId || args["targetAgentId"];
      const ok = (await config.onCallTransfer?.(`agent:${targetId}`)) ?? false;
      if (!ok) return "transfer_failed: agent-to-agent transfer is not supported";
      // In-call squad handoff keeps media open — do not end the call.
      return "handoff_complete: a teammate is now continuing with the customer";
    }
    case "squad_followup": {
      const targetAgentId = parseInt(String(args["targetAgentId"] ?? ""), 10);
      const note = String(args["note"] ?? "").trim();
      const delayMinutes = parseInt(String(args["delay_minutes"] ?? ""), 10);
      if (!Number.isFinite(targetAgentId) || !note || !Number.isFinite(delayMinutes)) {
        return "followup_failed: targetAgentId, note and delay_minutes are all required";
      }
      const { createSquadFollowupTask } = await import("../../../services/squad-teamwork.js");
      return createSquadFollowupTask({
        fromAgentId: agentId,
        callId,
        callerPhone: config.callerPhone ?? null,
        targetAgentId,
        note,
        delayMinutes,
      });
    }
    case "webhook":
      await executeWebhookTool(callId, tool, args);
      return undefined;
    case "end_call": {
      const goodbye = resolveGoodbyeMessage(tool.goodbyeMessage, agent.endCallPhrases);
      onAgentText(goodbye);
      await speakText(goodbye);
      endCall();
      return undefined;
    }
    case "native_booking":
      return executeNativeBooking(callId, agentId, tool, args);
    case "native_check_availability":
      return executeNativeCheckAvailability(callId, agentId, tool, args);
    case "native_list_bookings":
      return executeNativeListBookings(callId, agentId, tool, args);
    case "native_reschedule":
      return executeNativeReschedule(callId, agentId, tool, args);
    case "native_cancel":
      return executeNativeCancel(callId, agentId, tool, args);
    case "analyze_image": {
      const out = await executeAnalyzeImage({
        callId,
        agentId,
        userId: null,
        phone: config.callerPhone ?? null,
        args,
      });
      if (out && !out.startsWith("analyze_image_error")) {
        deps.onAnalyzeImageResult?.(out);
      }
      return out;
    }
    case "send_sms":
      return undefined;
    default:
      return `Tool type ${tool.type} is not supported on the Live stack yet.`;
  }
}
