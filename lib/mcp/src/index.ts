#!/usr/bin/env node
/**
 * SnapServe MCP server — stdio transport for Claude Desktop / Cursor / local MCP clients.
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
 * Hosted remote MCP (Claude custom connectors): https://app.snapserve.ai/api/mcp
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SnapServe } from "@snapserveai/sdk";
import { createSnapServeMcpServer } from "./server.js";

const apiKey = process.env["SNAPSERVE_API_KEY"];
if (!apiKey) {
  console.error("SNAPSERVE_API_KEY environment variable is required (Dashboard → API Keys).");
  process.exit(1);
}

const snapserve = new SnapServe({
  apiKey,
  ...(process.env["SNAPSERVE_BASE_URL"] ? { baseUrl: process.env["SNAPSERVE_BASE_URL"] } : {}),
});

const server = createSnapServeMcpServer(snapserve);
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("SnapServe MCP server running on stdio");
