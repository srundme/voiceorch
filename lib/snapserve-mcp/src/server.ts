import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SnapServeClient } from "./client.js";
import { registerTools } from "./tools.js";

/** Build an MCP server bound to a SnapServe API key (hosted HTTP or stdio). */
export function createSnapServeMcpServer(opts: { apiKey: string; baseUrl?: string }): McpServer {
  const client = new SnapServeClient(opts);
  const server = new McpServer({
    name: "snapserve",
    version: "0.2.0",
  });
  registerTools(server, client);
  return server;
}

export { SnapServeClient } from "./client.js";
