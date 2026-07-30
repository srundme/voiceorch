# @snapserveai/mcp

Official [MCP](https://modelcontextprotocol.io) server for [SnapServe](https://app.snapserve.ai) — control your AI voice agents, phone calls, numbers, analytics and wallet from Claude Desktop, Cursor, or any MCP-compatible client.

## Setup

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

| Tool | What it does |
|---|---|
| `list_agents` / `get_agent` / `create_agent` / `update_agent` / `toggle_agent` / `delete_agent` | Manage voice agents |
| `list_calls` / `get_call` / `create_outbound_call` / `end_call` / `transfer_call` | Place and manage phone calls |
| `list_phone_numbers` / `assign_phone_number` | Manage phone numbers |
| `get_dashboard_stats` / `get_recent_calls` / `get_calls_by_status` / `get_daily_call_volume` / `get_agent_stats` | Analytics |
| `get_wallet` / `get_wallet_transactions` / `get_account` | Wallet & account |
| `snapserve_api_request` | Escape hatch for any other REST endpoint |

Example prompts once connected:

- "List my SnapServe agents and show today's call volume"
- "Call +91XXXXXXXXXX with my Tamil sales agent"
- "Why did call 1234 fail? Show me the transcript"

## License

MIT
