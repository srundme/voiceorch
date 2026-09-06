#!/usr/bin/env node
/**
 * SnapServe MCP server — stdio transport for Claude Desktop / Claude Code / Cursor.
 *
 * Env:
 *   SNAPSERVE_API_KEY  required (sk_live_...)
 *   SNAPSERVE_BASE_URL optional (default https://app.snapserve.ai/api)
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createSnapServeMcpServer } from "./server.js";

export { createSnapServeMcpServer } from "./server.js";
export { SnapServeClient } from "./client.js";

async function main() {
  const apiKey = process.env.SNAPSERVE_API_KEY ?? "";
  const baseUrl = process.env.SNAPSERVE_BASE_URL;
  const server = createSnapServeMcpServer({ apiKey, baseUrl });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
