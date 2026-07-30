# How users use the SnapServe skill + MCP

Target: **[app.snapserve.ai](https://app.snapserve.ai)**  
Audience: anyone who wants Claude / Cursor to create agents, run campaigns, link websites, etc.

---

## What you get

1. **Skill** — teaches the AI *how* SnapServe works (workflows, guardrails).
2. **MCP** — gives the AI *live tools* that call your SnapServe account.

Together: you chat in plain English; Claude/Cursor creates agents, campaigns, website webhooks, and more.

---

## One-time setup (5 minutes)

### 1. Get an API key
1. Open [app.snapserve.ai](https://app.snapserve.ai)
2. Go to **Dashboard → API Keys**
3. Create a key → copy `sk_live_...` (shown once)

### 2. Install / build MCP (from this repo)

```bash
git clone https://github.com/srundme/voiceorch.git   # or your fork
cd voiceorch
pnpm install
pnpm --filter @snapserve/mcp build
```

### 3. Connect your AI client

**Cursor** — copy `.cursor/mcp.json.example` → `.cursor/mcp.json` and paste your key:

```json
{
  "mcpServers": {
    "snapserve": {
      "command": "node",
      "args": ["lib/snapserve-mcp/dist/index.js"],
      "env": {
        "SNAPSERVE_API_KEY": "sk_live_YOUR_KEY",
        "SNAPSERVE_BASE_URL": "https://app.snapserve.ai/api"
      }
    }
  }
}
```

Restart Cursor. Skill auto-loads from `.agents/skills/snapserve`.

**Claude Desktop** — edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "snapserve": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/voiceorch/lib/snapserve-mcp/dist/index.js"],
      "env": {
        "SNAPSERVE_API_KEY": "sk_live_YOUR_KEY",
        "SNAPSERVE_BASE_URL": "https://app.snapserve.ai/api"
      }
    }
  }
}
```

Restart Claude. Copy `.claude/skills/snapserve` into your Claude skills folder if needed.

**Claude Code:**

```bash
claude mcp add snapserve \
  --env SNAPSERVE_API_KEY=sk_live_YOUR_KEY \
  -- node /ABSOLUTE/PATH/TO/voiceorch/lib/snapserve-mcp/dist/index.js
```

---

## Everyday use (just talk)

| You say | What happens |
|---------|----------------|
| “List my SnapServe agents” | `list_agents` |
| “Create an English agent for Voiceathon with Sarvam STT” | `create_agent` |
| “Call +91… with agent 415” | `outbound_call` |
| “Create a website lead campaign and give me the form URL” | `create_campaign` → `get_website_webhook` |
| “Import these leads and start dialing” | `import_campaign_leads` / start batch |
| “Attach Event Outreach journey and go live” | journey tools |
| “Show call 4943 logs / why was STT bad?” | `get_call` + `get_call_logs` |
| “What’s my wallet balance?” | `get_wallet` |

Paste the **website lead URL** the AI returns into your form / Sheet / Zap:

```http
POST https://app.snapserve.ai/api/webhooks/lead/{token}
{"phone":"+919876543210","name":"Lead"}
```

---

## Skill-only (no MCP)

If MCP is not connected, the skill still guides the AI to use `curl` / `@snapserve/sdk` with your API key — see `references/rest-api.md` and `references/workflows.md`.

---

## Safety

- Don’t share `sk_live_` keys in chat screenshots
- Confirm before delete agent / campaign
- Prefer Instant WhatsApp for Voiceathon unless you need Business/BYO

More detail: `references/install-mcp.md`, `references/workflows.md`.
