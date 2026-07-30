# @snapserve/mcp

Model Context Protocol server for **[SnapServe](https://app.snapserve.ai)** — create agents, run campaigns, link websites, manage WhatsApp/email, Sheets auto-calls, journeys, squads, and more.

## Setup

1. Create an API key: **Dashboard → API Keys** → `sk_live_...`
2. Install deps from the monorepo root: `pnpm install`
3. Build: `pnpm --filter @snapserve/mcp build`

## Run (stdio)

```bash
SNAPSERVE_API_KEY=sk_live_... node lib/snapserve-mcp/dist/index.js
```

Optional: `SNAPSERVE_BASE_URL=https://app.snapserve.ai/api` (default).

## Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "snapserve": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/voiceorch/lib/snapserve-mcp/dist/index.js"],
      "env": {
        "SNAPSERVE_API_KEY": "sk_live_...",
        "SNAPSERVE_BASE_URL": "https://app.snapserve.ai/api"
      }
    }
  }
}
```

## Claude Code

```bash
claude mcp add snapserve --env SNAPSERVE_API_KEY=sk_live_... -- node /ABSOLUTE/PATH/TO/voiceorch/lib/snapserve-mcp/dist/index.js
```

## Cursor

Add to Cursor MCP settings (or `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "snapserve": {
      "command": "node",
      "args": ["./lib/snapserve-mcp/dist/index.js"],
      "env": {
        "SNAPSERVE_API_KEY": "sk_live_..."
      }
    }
  }
}
```

## Tools (summary)

| Area | Tools |
|------|--------|
| Meta | `snapserve_help`, `snapserve_api` |
| Agents | `list_agents`, `get_agent`, `create_agent`, `update_agent`, `toggle_agent`, `delete_agent`, versions |
| Calls | `list_calls`, `get_call`, `get_call_logs`, `outbound_call`, `end_call`, `transfer_call` |
| Campaigns / website | `create_campaign`, `get_website_webhook`, leads, batches |
| Journeys | presets, create, activate, pause |
| WhatsApp / Email | channel + connections |
| Phone / KB / Sheets | list/assign, attach, automatic-calls |
| Dispositions / Squads / Webcall | config + runs + links |
| Wallet / analytics / providers / webhooks | balance, dashboard, keys, endpoints |

Pair with the **snapserve** Claude skill (`.claude/skills/snapserve`) for end-to-end workflows.
