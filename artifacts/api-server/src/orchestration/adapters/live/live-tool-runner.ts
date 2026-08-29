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
  executeSendEmail,
  executeSendWhatsapp,
  executeSendSms,
} from "../../../services/tool-executor.js";
import { scheduleCallbackRequested } from "../../../services/autoRedial.js";
import { resolveCallbackTime } from "../../../lib/tz-datetime.js";
import {
  executeScheduleMeetRejoin,
  resolveAgentOwnerUserId,
} from "../../../services/meet-booking.js";
import { executeMeetPresentationTool } from "../../../services/meet-presentation.js";
import { executeMeetChatTool } from "../../../services/meet-chat.js";
import {
  executeLeaveMeetingTool,
  executeMuteMeetingTool,
} from "../../../services/meet-control.js";
import { logger } from "../../../lib/logger.js";

export interface LiveToolRunnerDeps {
  config: SessionConfig;
  agent: AgentConfig;
  onAgentText: (text: string) => void;
  speakText: (text: string) => Promise<void>;
  endCall: () => void;
  /** Committed caller turns so far — gates booking on real engagement. */
  genuineUserTurns: () => number;
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
      agent.language,
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
    const { scheduledAt, wasDefaulted, wasClamped, wasRolled } = resolveCallbackTime(scheduledAtRaw, cbTz);
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
        { callId: config.callId, agentId: agent.id, toNumber, scheduledAtRaw, scheduledAt, tz: cbTz, wasDefaulted, wasClamped, wasRolled },
        "Live: schedule_callback invoked by LLM",
      );
      return {
        output:
          `Callback recorded for ${cbLocal} (${cbTz}). Confirm THIS exact time to the caller, then close with a proper goodbye.`,
      };
    }
    return { output: "Callback noted." };
  }

  if (toolName === "schedule_meet_rejoin") {
    if (!agent.isMeetingSession) {
      return { error: "schedule_meet_rejoin is only available during meeting sessions" };
    }
    const meetUrl =
      (typeof args["meet_url"] === "string" && args["meet_url"].trim()) ||
      config.currentMeetUrl?.trim() ||
      "";
    if (!meetUrl) return { error: "meet_url is required" };
    const ownerUserId = await resolveAgentOwnerUserId(agent.id);
    if (!ownerUserId) return { error: "could not resolve agent owner" };
    const output = await executeScheduleMeetRejoin({
      sessionCallId: config.callId,
      agentId: agent.id,
      userId: ownerUserId,
      meetUrl,
      scheduledAtRaw: typeof args["scheduled_at"] === "string" ? args["scheduled_at"] : null,
      notes: typeof args["notes"] === "string" ? args["notes"] : null,
      lineageCallId: config.bookingLineageCallId,
      timezone: agent.timezone?.trim() || "Asia/Kolkata",
    });
    return { output };
  }

  if (
    toolName === "start_presentation" ||
    toolName === "stop_presentation" ||
    toolName === "next_slide" ||
    toolName === "previous_slide" ||
    toolName === "goto_slide"
  ) {
    if (!agent.isMeetingSession) {
      return { error: `${toolName} is only available during meeting sessions` };
    }
    const safeArgs = args && typeof args === "object" ? args : {};
    const output = await executeMeetPresentationTool({
      toolName,
      args: safeArgs,
      meetMid: config.meetMid,
      meetBotToken: config.meetBotToken,
      presentationDefaultUrl: config.presentationDefaultUrl,
    });
    return { output };
  }

  if (toolName === "send_meeting_chat") {
    if (!agent.isMeetingSession) {
      return { error: "send_meeting_chat is only available during meeting sessions" };
    }
    const safeArgs = args && typeof args === "object" ? args : {};
    const output = await executeMeetChatTool({
      meetMid: config.meetMid,
      message: typeof safeArgs["message"] === "string" ? safeArgs["message"] : "",
      pin: safeArgs["pin"] === true,
    });
    return { output };
  }

  if (toolName === "leave_meeting") {
    if (!agent.isMeetingSession) {
      return { error: "leave_meeting is only available during meeting sessions" };
    }
    const output = await executeLeaveMeetingTool({ meetMid: config.meetMid });
    return { output };
  }

  if (toolName === "mute_meeting" || toolName === "unmute_meeting") {
    if (!agent.isMeetingSession) {
      return { error: `${toolName} is only available during meeting sessions` };
    }
    const output = executeMuteMeetingTool({
      meetMid: config.meetMid,
      muted: toolName === "mute_meeting",
    });
    return { output };
  }

  const tool = matchToolByName(agent.tools, toolName);
  if (!tool) {
    logger.warn({ callId: config.callId, toolName }, "Live: unknown tool call");
    return { error: `Unknown tool: ${toolName}` };
  }

  try {
    const skipTimeout =
      tool.type === "end_call"
      || tool.type === "call_transfer"
      || tool.type === "transfer_cold"
      || tool.type === "transfer_warm"
      || tool.type === "transfer_agent";
    const resultPromise = executeLiveAgentTool(deps, tool, args);
    const result = skipTimeout
      ? await resultPromise
      : await Promise.race([
          resultPromise,
          new Promise<never>((_, reject) => {
            setTimeout(
              () => reject(new Error(`tool timed out after ${LIVE_TOOL_TIMEOUT_MS}ms`)),
              LIVE_TOOL_TIMEOUT_MS,
            );
          }),
        ]);
    if (result === undefined) return { output: "ok" };
    return { output: result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ callId: config.callId, toolName, err }, "Live tool execution failed");
    return { error: message };
  }
}

const LIVE_TOOL_TIMEOUT_MS = 15_000;

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
      return await executeWebhookTool(callId, tool, args);
    case "end_call": {
      const goodbye = resolveGoodbyeMessage(tool.goodbyeMessage, agent.endCallPhrases, agent.language);
      onAgentText(goodbye);
      await speakText(goodbye);
      endCall();
      return undefined;
    }
    case "native_booking": {
      // Mirrors the classic pipeline guard: Live can chain check_availability →
      // book off a single "Hello", so a dead-air call ends up with a real
      // calendar invite and confirmation email.
      const userTurns = deps.genuineUserTurns();
      if (userTurns < 2) {
        logger.warn({ callId, userTurns }, "Live native booking blocked: fewer than 2 caller turns");
        return "error: cannot book yet — you must first ask the caller for their name, email, and preferred slot. Do not call this tool until the caller has provided those details in the conversation.";
      }
      return executeNativeBooking(callId, agentId, tool, args, {
        lineageCallId: config.bookingLineageCallId,
      });
    }
    case "native_check_availability":
      return executeNativeCheckAvailability(callId, agentId, tool, args);
    case "native_list_bookings":
      return executeNativeListBookings(callId, agentId, tool, args);
    case "native_reschedule":
      return executeNativeReschedule(callId, agentId, tool, args, {
        lineageCallId: config.bookingLineageCallId,
      });
    case "native_cancel":
      return executeNativeCancel(callId, agentId, tool, args);
    case "send_sms":
      return executeSendSms({
        callId,
        callerPhone: config.callerPhone,
        telephonyProvider: config.telephonyProvider,
        providerKeys: config.providerKeys,
        messageTemplate: tool.messageTemplate,
      });
    case "send_email":
      return executeSendEmail({
        agentId: agent.id,
        callId,
        agentName: agent.name,
        callerPhone: config.callerPhone,
        args,
      });
    case "send_whatsapp":
      return executeSendWhatsapp({
        agentId: agent.id,
        callId,
        agentName: agent.name,
        callerPhone: config.callerPhone,
        args,
      });
    default:
      return `Tool type ${(tool as AgentTool).type} is not supported on the Live stack yet.`;
  }
}
