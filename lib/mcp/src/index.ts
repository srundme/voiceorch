#!/usr/bin/env node
/**
 * SnapServe MCP server — exposes the SnapServe AI voice agent platform as MCP tools.
 *
 * Usage (Claude Desktop / Cursor / any MCP client, stdio transport):
 *
 * {
 *   "mcpServers": {
 *     "snapserve": {
 *       "command": "npx",
 *       "args": ["-y", "@snapserveai/mcp"],
 *       "env": { "SNAPSERVE_API_KEY": "sk_live_..." }
 *     }
 *   }
 * }
 *
 * Env vars:
 *   SNAPSERVE_API_KEY   (required) — created in Dashboard → API Keys
 *   SNAPSERVE_BASE_URL  (optional) — override for self-hosted/staging (default https://app.snapserve.ai/api)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SnapServe, SnapServeApiError } from "@snapserveai/sdk";
import { z } from "zod";

const apiKey = process.env["SNAPSERVE_API_KEY"];
if (!apiKey) {
  console.error("SNAPSERVE_API_KEY environment variable is required (Dashboard → API Keys).");
  process.exit(1);
}

const snapserve = new SnapServe({
  apiKey,
  ...(process.env["SNAPSERVE_BASE_URL"] ? { baseUrl: process.env["SNAPSERVE_BASE_URL"] } : {}),
});

const server = new McpServer({ name: "snapserve", version: "0.1.0" });

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data ?? { ok: true }, null, 2) }] };
}

function fail(err: unknown): ToolResult {
  const msg =
    err instanceof SnapServeApiError
      ? `SnapServe API error ${err.status}: ${err.message}`
      : err instanceof Error
        ? err.message
        : String(err);
  return { content: [{ type: "text", text: msg }], isError: true };
}

function tool(
  name: string,
  description: string,
  shape: z.ZodRawShape,
  handler: (args: Record<string, unknown>) => Promise<unknown>,
): void {
  server.tool(name, description, shape, async (args: Record<string, unknown>) => {
    try {
      return ok(await handler(args));
    } catch (err) {
      return fail(err);
    }
  });
}

// ---------- Agents ----------
tool("list_agents", "List all SnapServe voice agents on the account.", {}, () => snapserve.agents.list());
tool(
  "get_agent",
  "Get one voice agent by id (full configuration).",
  { agentId: z.number().int() },
  a => snapserve.agents.get(a["agentId"] as number),
);
tool(
  "create_agent",
  "Create a new voice agent. Provide at least name and systemPrompt; other SnapServe agent fields (language, voice, llmProvider, etc.) may be included in `config`.",
  {
    name: z.string(),
    systemPrompt: z.string(),
    config: z.record(z.unknown()).optional().describe("Additional agent fields merged into the create payload"),
  },
  a =>
    snapserve.agents.create({
      name: a["name"] as string,
      systemPrompt: a["systemPrompt"] as string,
      ...((a["config"] as Record<string, unknown> | undefined) ?? {}),
    } as never),
);
tool(
  "update_agent",
  "Update fields on an existing voice agent (partial update — only send the fields to change).",
  { agentId: z.number().int(), fields: z.record(z.unknown()) },
  a => snapserve.agents.update(a["agentId"] as number, a["fields"] as never),
);
tool(
  "toggle_agent",
  "Enable/disable a voice agent (flips its active state).",
  { agentId: z.number().int() },
  a => snapserve.agents.toggle(a["agentId"] as number),
);
tool(
  "delete_agent",
  "Permanently delete a voice agent. Irreversible — confirm with the user first.",
  { agentId: z.number().int() },
  async a => {
    await snapserve.agents.delete(a["agentId"] as number);
    return { deleted: true };
  },
);

// ---------- Calls ----------
tool(
  "list_calls",
  "List calls, optionally filtered by agentId and/or status (e.g. completed, in_progress, failed).",
  { agentId: z.number().int().optional(), status: z.string().optional() },
  a => snapserve.calls.list({ agentId: a["agentId"] as number | undefined, status: a["status"] as string | undefined }),
);
tool(
  "get_call",
  "Get one call by id, including transcript and outcome details.",
  { callId: z.number().int() },
  a => snapserve.calls.get(a["callId"] as number),
);
tool(
  "create_outbound_call",
  "Place an outbound phone call using a voice agent. toNumber must be E.164 (e.g. +9198xxxxxxxx). This dials a real phone number and spends wallet balance — confirm with the user first.",
  { agentId: z.number().int(), toNumber: z.string(), metadata: z.record(z.unknown()).optional() },
  a =>
    snapserve.calls.createOutbound({
      agentId: a["agentId"] as number,
      toNumber: a["toNumber"] as string,
      ...((a["metadata"] as Record<string, unknown> | undefined) ? { metadata: a["metadata"] as Record<string, unknown> } : {}),
    } as never),
);
tool(
  "end_call",
  "End a live call.",
  { callId: z.number().int() },
  a => snapserve.calls.end(a["callId"] as number),
);
tool(
  "transfer_call",
  "Transfer a live call to a human phone number (E.164).",
  { callId: z.number().int(), toNumber: z.string() },
  a => snapserve.calls.transfer(a["callId"] as number, { toNumber: a["toNumber"] as string } as never),
);

// ---------- Phone numbers ----------
tool("list_phone_numbers", "List phone numbers on the account and their agent assignments.", {}, () =>
  snapserve.phoneNumbers.list(),
);
tool(
  "assign_phone_number",
  "Assign a phone number to an agent (or pass agentId=null to unassign).",
  { phoneNumberId: z.number().int(), agentId: z.number().int().nullable() },
  a => snapserve.phoneNumbers.assign(a["phoneNumberId"] as number, a["agentId"] as number | null),
);

// ---------- Analytics ----------
tool("get_dashboard_stats", "Account-wide dashboard stats (total calls, minutes, success rates).", {}, () =>
  snapserve.analytics.dashboard(),
);
tool("get_recent_calls", "Most recent calls across all agents.", {}, () => snapserve.analytics.recentCalls());
tool("get_calls_by_status", "Call counts grouped by status.", {}, () => snapserve.analytics.callsByStatus());
tool("get_daily_call_volume", "Daily call volume time series.", {}, () => snapserve.analytics.dailyCallVolume());
tool(
  "get_agent_stats",
  "Dashboard stats for one agent.",
  { agentId: z.number().int() },
  a => snapserve.analytics.agentStats(a["agentId"] as number),
);

// ---------- Wallet & account ----------
tool("get_wallet", "Wallet balance and billing info.", {}, () => snapserve.wallet.get());
tool(
  "get_wallet_transactions",
  "Recent wallet transactions (credits/debits).",
  { limit: z.number().int().optional(), offset: z.number().int().optional() },
  a => snapserve.wallet.transactions({ limit: a["limit"] as number | undefined, offset: a["offset"] as number | undefined }),
);
tool("get_account", "Account profile info.", {}, () => snapserve.account.get());

// ---------- Escape hatch ----------
tool(
  "snapserve_api_request",
  "Advanced: call any SnapServe REST endpoint not covered by the other tools. path is relative to the API base (e.g. /webhook-endpoints).",
  {
    method: z.enum(["GET", "POST", "PATCH", "DELETE"]),
    path: z.string(),
    body: z.record(z.unknown()).optional(),
    query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  },
  a =>
    snapserve.request(a["method"] as "GET" | "POST" | "PATCH" | "DELETE", a["path"] as string, {
      body: a["body"],
      query: a["query"] as Record<string, string | number | boolean> | undefined,
    }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("SnapServe MCP server running on stdio");
