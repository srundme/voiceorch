# @snapserveai/mcp

Official [MCP](https://modelcontextprotocol.io) server for [SnapServe](https://app.snapserve.ai) — operate the full product (agents, calls, campaigns, journeys, WhatsApp, Sheets, wallet) from Claude, Cursor, or any MCP client.

## Hosted remote MCP (Claude custom connectors)

**URL:** `https://app.snapserve.ai/api/mcp`

### Claude.ai / Claude Desktop (custom connector)

1. Create an API key: Dashboard → **API Keys** → `sk_live_...`
2. Claude → **Customize → Connectors → Add custom connector**
3. Name: `snapserve`
4. Remote MCP server URL: `https://app.snapserve.ai/api/mcp`
5. Click **Add**, then **Connect** — paste your `sk_live_...` key on the SnapServe authorize page

Optional (if your Claude plan shows **Request headers**): set header `authorization` to `Bearer sk_live_...` and skip OAuth.

### Claude Code

```bash
claude mcp add snapserve --transport http \
  --url https://app.snapserve.ai/api/mcp \
  --header "Authorization: Bearer sk_live_..."
```

## Local stdio (Claude Desktop / Cursor)

1. Create an API key in **SnapServe Dashboard → API Keys** (`sk_live_...`).
2. Add to your MCP client config:

```json
{
  "mcpServers": {
    "snapserve": {
      "command": "npx",
      "args": ["-y", "@snapserveai/mcp"],
      "env": { "SNAPSERVE_API_KEY": "sk_live_..." }
    }
  }
}
```

Optional: set `SNAPSERVE_BASE_URL` for self-hosted/staging deployments (default `https://app.snapserve.ai/api`).

## Tools

| Area | Tools |
|---|---|
| Agents | `list_agents`, `get_agent`, `create_agent`, `update_agent`, `toggle_agent`, `delete_agent`, versions |
| Calls | `list_calls`, `get_call`, `get_call_logs`, `outbound_call` / `create_outbound_call`, `end_call`, `transfer_call` |
| Campaigns | `list_campaigns`, `create_campaign`, `update_campaign`, batches, leads |
| Journeys | presets, create, activate, pause |
| WhatsApp / email | channel status, BYO connections, Brevo |
| Sheets | Automatic Calls list / create / start / pause |
| Knowledge / squads / webcall | attach KB, squads, webcall links |
| Numbers / providers / webhooks | list, assign, BYO keys, outbound webhooks |
| Wallet / analytics | `get_wallet`, dashboard, per-agent stats |
| Escape hatch | `snapserve_api` / `snapserve_api_request` |

Example prompts once connected:

- "List my SnapServe agents and show today's call volume"
- "Call +91XXXXXXXXXX with my Tamil sales agent"
- "Create a campaign from this sheet and start dialing"
- "Why did call 1234 fail? Show me the transcript"

## License

MIT
