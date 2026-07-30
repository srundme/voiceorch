#!/usr/bin/env node
/**
 * SnapServe MCP server — stdio transport for Claude Desktop / Claude Code / Cursor.
 *
 * Env:
 *   SNAPSERVE_API_KEY  required (sk_live_...)
 *   SNAPSERVE_BASE_URL optional (default https://app.snapserve.ai/api)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SnapServeClient } from "./client.js";
import { registerTools } from "./tools.js";

async function main() {
  const apiKey = process.env.SNAPSERVE_API_KEY ?? "";
  const baseUrl = process.env.SNAPSERVE_BASE_URL;

  const client = new SnapServeClient({ apiKey, baseUrl });

  const server = new McpServer({
    name: "snapserve",
    version: "0.1.0",
  });

  registerTools(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
