/**
 * Outbound dial for Agent Tasks — wraps shared dialOutboundAgent.
 */

import { dialOutboundAgent, OutboundDialError } from "./outbound-agent-dial.js";
import { recordTaskCallStarted } from "./task-orchestrator.js";
import { logger } from "../lib/logger.js";

export class TaskDialError extends OutboundDialError {
  constructor(message: string, code: string, status = 400) {
    super(message, code, status);
    this.name = "TaskDialError";
  }
}

export async function dialOutboundForTask(opts: {
  userId: string;
  agentId: number;
  toNumber: string;
  agentTaskId: number;
  candidateId: number;
  taskBrief: string;
  webhookBaseUrl: string;
}): Promise<{ callId: number; executionId: string }> {
  const { userId, agentId, toNumber, agentTaskId, candidateId, taskBrief, webhookBaseUrl } = opts;

  try {
    const result = await dialOutboundAgent({
      userId,
      agentId,
      toNumber,
      webhookBaseUrl,
      metadata: {
        agentTaskId,
        candidateId,
        taskBrief,
      },
    });

    await recordTaskCallStarted({
      taskId: agentTaskId,
      callId: result.callId,
      candidateId,
      toNumber,
    });

    logger.info(
      { evt: "agent_task_dialed", agentTaskId, callId: result.callId, agentId, toNumber },
      "Task outbound call initiated",
    );

    return result;
  } catch (err) {
    if (err instanceof OutboundDialError) {
      throw new TaskDialError(err.message, err.code, err.status);
    }
    throw err;
  }
}
