# Install SnapServe MCP

Package: `@snapserve/mcp` in this repo at `lib/snapserve-mcp`.

## 1. Build

```bash
cd /path/to/voiceorch
pnpm install
pnpm --filter @snapserve/mcp build
```

## 2. API key

Dashboard → **API Keys** → create `sk_live_...`

## 3. Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

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

Restart Claude Desktop. Ask: “List my SnapServe agents.”

## 4. Claude Code

```bash
claude mcp add snapserve \
  --env SNAPSERVE_API_KEY=sk_live_YOUR_KEY \
  --env SNAPSERVE_BASE_URL=https://app.snapserve.ai/api \
  -- node /ABSOLUTE/PATH/TO/voiceorch/lib/snapserve-mcp/dist/index.js
```

Copy this skill into Claude Code skills (repo already has `.claude/skills/snapserve`).

## 5. Cursor

Project `.cursor/mcp.json` or user MCP config:

```json
{
  "mcpServers": {
    "snapserve": {
      "command": "node",
      "args": ["lib/snapserve-mcp/dist/index.js"],
      "env": {
        "SNAPSERVE_API_KEY": "sk_live_YOUR_KEY"
      }
    }
  }
}
```

Skill path: `.agents/skills/snapserve`.

## 6. Smoke test

```bash
SNAPSERVE_API_KEY=sk_live_... node -e "
import('./lib/snapserve-mcp/dist/client.js').then(({SnapServeClient}) => {
  const c = new SnapServeClient({ apiKey: process.env.SNAPSERVE_API_KEY });
  return c.request('GET', '/agents').then(a => console.log('agents', Array.isArray(a)?a.length:a));
});
"
```

Or start MCP and call `snapserve_help` / `list_agents`.
