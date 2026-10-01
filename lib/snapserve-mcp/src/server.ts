import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SnapServeClient } from "./client.js";
import { registerTools } from "./tools.js";

const INSTRUCTIONS =
  "SnapServe runs AI voice agents that place and answer phone calls. Call snapserve_help first for workflows. " +
  "List tools return compact rows; fetch one item by id for detail. Confirm with the user before any tool that rings " +
  "real people or spends wallet balance (outbound_call, create_campaign_batch, start_campaign_batch, activate_journey, " +
  "automatic calls) and before deletes. Phone numbers must be E.164 (+91…).";

/** Build an MCP server bound to a SnapServe API key (hosted HTTP or stdio). */
export function createSnapServeMcpServer(opts: { apiKey: string; baseUrl?: string }): McpServer {
  const client = new SnapServeClient(opts);
  const server = new McpServer(
    { name: "snapserve", title: "SnapServe", version: "1.0.0" },
    { instructions: INSTRUCTIONS },
  );
  registerTools(server, client);
  return server;
}

export { SnapServeClient } from "./client.js";
