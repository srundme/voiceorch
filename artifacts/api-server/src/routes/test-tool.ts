import { Router, type IRouter } from "express";
import { db, agentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { RunToolTestBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth.js";
import {
  executeNativeBooking,
  executeNativeCheckAvailability,
  executeNativeListBookings,
  executeNativeCancel,
  executeNativeReschedule,
} from "../services/tool-executor.js";
import type { AgentTool } from "../orchestration/types.js";

const router: IRouter = Router();

const SCHEDULING_TOOL_TYPES = new Set([
  "native_booking",
  "native_check_availability",
  "native_list_bookings",
  "native_cancel",
  "native_reschedule",
]);

const SYNTHETIC_CALL_ID = -1;

router.post("/test/tool", requireAuth, async (req, res): Promise<void> => {
  const clerkId = (req as any).clerkUserId as string;

  const parsed = RunToolTestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    return;
  }

  const { agentId, toolName, args } = parsed.data;

  const [agent] = await db
    .select()
    .from(agentsTable)
    .where(eq(agentsTable.id, agentId));

  if (!agent || agent.userId !== clerkId) {
    res.status(404).json({ error: "Agent not found" });
    return;
  }

  const tools = (agent.tools ?? []) as unknown as AgentTool[];
  const tool = tools.find((t) => t.name === toolName);

  if (!tool) {
    res.status(404).json({ error: `Tool "${toolName}" not found on this agent` });
    return;
  }

  if (!SCHEDULING_TOOL_TYPES.has(tool.type)) {
    res.status(400).json({ error: `Tool type "${tool.type}" is not supported in the test simulator` });
    return;
  }

  const safeArgs = (args ?? {}) as Record<string, unknown>;

  try {
    let result: string;

    if (tool.type === "native_booking") {
      result = await executeNativeBooking(SYNTHETIC_CALL_ID, agentId, tool as AgentTool & { type: "native_booking" }, safeArgs);
    } else if (tool.type === "native_check_availability") {
      result = await executeNativeCheckAvailability(SYNTHETIC_CALL_ID, agentId, tool as AgentTool & { type: "native_check_availability" }, safeArgs);
    } else if (tool.type === "native_list_bookings") {
      result = await executeNativeListBookings(SYNTHETIC_CALL_ID, agentId, tool as AgentTool & { type: "native_list_bookings" }, safeArgs);
    } else if (tool.type === "native_cancel") {
      result = await executeNativeCancel(SYNTHETIC_CALL_ID, agentId, tool as AgentTool & { type: "native_cancel" }, safeArgs);
    } else if (tool.type === "native_reschedule") {
      result = await executeNativeReschedule(SYNTHETIC_CALL_ID, agentId, tool as AgentTool & { type: "native_reschedule" }, safeArgs);
    } else {
      res.status(400).json({ error: "Unsupported tool type" });
      return;
    }

    res.json({ result });
  } catch (err) {
    req.log.error({ err, agentId, toolName }, "Test tool execution threw unexpectedly");
    res.status(500).json({ error: "Tool execution failed due to a server error" });
  }
});

export default router;
