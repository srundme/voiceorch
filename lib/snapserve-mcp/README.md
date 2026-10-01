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
| Account | `get_account`, `get_wallet`, `list_transactions` |
| Agents | `list_agents`, `get_agent`, `create_agent`, `update_agent`, `toggle_agent`, `delete_agent`, `list_agent_versions`, `publish_agent_version` |
| Calls | `list_calls`, `get_call`, `get_call_logs`, `outbound_call`, `end_call`, `transfer_call` |
| Campaigns | `list_campaigns`, `get_campaign` (website intake URL), `create_campaign`, `update_campaign`, `delete_campaign`, `create_campaign_batch`, `list_campaign_batches`, `start_campaign_batch`, `import_campaign_leads`, `list_campaign_leads` |
| Journeys | `list_journey_presets`, `list_journeys`, `get_journey`, `create_journey`, `apply_journey_preset`, `activate_journey`, `pause_journey` |
| Knowledge | `list_knowledge_sources`, `create_knowledge_source`, `attach_knowledge`, `search_knowledge` |
| Phone numbers | `list_phone_numbers`, `search_available_numbers`, `assign_phone_number` |
| WhatsApp / email | `get_whatsapp_channel`, `update_whatsapp_channel`, `list_whatsapp_connections`, `create_whatsapp_connection`, `get_email_channel`, `update_email_channel` |
| Sheets | `list_automatic_calls`, `create_automatic_call`, `start_automatic_call`, `pause_automatic_call` |
| Dispositions / squads | `get_disposition_config`, `set_disposition_config`, `list_squads`, `list_squad_templates`, `create_squad`, `start_squad_run` |
| Browser calls | `create_webcall_link` (returns `joinUrl`), `list_webcall_links` |
| Providers / webhooks | `list_providers`, `create_provider`, `list_webhook_endpoints`, `create_webhook_endpoint` |
| Analytics | `get_analytics_dashboard`, `get_agent_analytics`, `get_calls_by_status`, `get_daily_call_volume` |

Every tool carries MCP annotations (read-only / destructive / open-world) so clients can auto-approve reads and ask before calls, dialing and deletes. List tools return compact rows; credentials in responses are masked.

Pair with the **snapserve** Claude skill (`.claude/skills/snapserve`) for end-to-end workflows.
