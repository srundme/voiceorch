import { Link } from "wouter";
import { Callout, PageHeader } from "../DocsUi";
import { CodeBlock } from "../CodeBlock";

const COPY = `SNAPSERVE_API_KEY=sk_live_YOUR_KEY
SNAPSERVE_BASE_URL=https://app.snapserve.ai/api
# Claude Desktop mcpServers.snapserve → node …/lib/snapserve-mcp/dist/index.js`;

const MCP_JSON = `{
  "mcpServers": {
    "snapserve": {
      "command": "npx",
      "args": ["-y", "@snapserveai/mcp"],
      "env": {
        "SNAPSERVE_API_KEY": "sk_live_YOUR_KEY",
        "SNAPSERVE_BASE_URL": "https://app.snapserve.ai/api"
      }
    }
  }
}`;

function McpHero() {
  return (
    <div className="not-prose my-6 rounded-2xl border border-border/60 bg-card/40 p-6">
      <div className="grid gap-8 lg:grid-cols-[1fr_1.4fr]">
        <div className="flex flex-col justify-center">
          <h2 className="text-2xl font-bold tracking-tight text-foreground m-0">Connect SnapServe over MCP</h2>
          <p className="text-sm text-muted-foreground mt-3">
            Drive your whole SnapServe account — agents, calls, campaigns, journeys, WhatsApp,
            analytics — as tools from Claude, Cursor, Windsurf, and any MCP-aware client.
            76 tools, plus a skill that teaches the assistant how SnapServe works.
          </p>
          <div className="flex flex-wrap items-center gap-3 mt-6">
            <a
              href="https://app.snapserve.ai/app/api-keys"
              target="_blank"
              rel="noreferrer"
              className="group inline-flex h-11 min-w-[9.5rem] items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-slate-950 px-6 text-sm font-semibold tracking-[-0.01em] text-white no-underline shadow-[0_1px_2px_rgba(15,23,42,0.2),0_4px_12px_rgba(15,23,42,0.12)] transition-all duration-200 hover:-translate-y-px hover:bg-slate-800 hover:shadow-[0_2px_4px_rgba(15,23,42,0.18),0_8px_20px_rgba(15,23,42,0.14)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400/50"
            >
              Get API key
              <span aria-hidden className="text-[11px] text-white/45 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5">↗</span>
            </a>
            <a
              href="#install-mcp"
              className="inline-flex h-11 min-w-[9.5rem] items-center justify-center whitespace-nowrap rounded-lg border border-slate-200/90 bg-white/90 px-6 text-sm font-semibold tracking-[-0.01em] text-slate-800 no-underline shadow-[0_1px_2px_rgba(15,23,42,0.04)] backdrop-blur-sm transition-all duration-200 hover:-translate-y-px hover:border-slate-300 hover:bg-white hover:shadow-[0_2px_8px_rgba(15,23,42,0.06)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300/60"
            >
              Full setup guide
            </a>
          </div>
        </div>
        <ol className="m-0 list-none p-0 space-y-4">
          <li>
            <p className="text-sm font-semibold text-foreground m-0">1 · Get your API key</p>
            <p className="text-xs text-muted-foreground mt-0.5 mb-0">
              Generate an <code>sk_live_…</code> key from Dashboard → API Keys.
            </p>
          </li>
          <li>
            <p className="text-sm font-semibold text-foreground m-0">2 · Add the SnapServe MCP server</p>
            <p className="text-xs text-muted-foreground mt-0.5">Paste this into your client&apos;s MCP config and add your key.</p>
            <CodeBlock language="json" code={MCP_JSON} />
          </li>
          <li>
            <p className="text-sm font-semibold text-foreground m-0">3 · Verify the connection</p>
            <p className="text-xs text-muted-foreground mt-0.5">Ask your assistant to run a SnapServe tool:</p>
            <CodeBlock language="text" code={`Using SnapServe, list my agents and show my wallet balance.`} />
          </li>
        </ol>
      </div>
    </div>
  );
}

export default function ClaudeSkillPage() {
  return (
    <div>
      <PageHeader
        breadcrumb="Get started"
        title="Claude skill & MCP"
        description={
          <>
            Use Claude (Desktop or Claude Code) with the SnapServe skill and MCP so you can create
            agents, run campaigns, link website forms, and manage your account in plain English —
            backed by live API tools for{" "}
            <a href="https://app.snapserve.ai" target="_blank" rel="noreferrer">
              app.snapserve.ai
            </a>
            .
          </>
        }
        copyText={COPY}
      />

      <McpHero />

      <Callout variant="tip" title="Skill vs MCP">
        The <strong>skill</strong> teaches Claude <em>how</em> SnapServe works (workflows, safe
        defaults). The <strong>MCP server</strong> gives Claude <em>tools</em> that call your account
        with your <code>sk_live_…</code> key. Use both together for the best experience.
      </Callout>

      <h2 id="what-you-can-do">What you can do in Claude</h2>
      <p>Once connected, ask Claude things like:</p>
      <ul>
        <li>“List my SnapServe agents”</li>
        <li>“Create an English Voiceathon agent with Sarvam STT”</li>
        <li>“Call +91… with agent 415”</li>
        <li>“Create a website lead campaign and give me the form webhook URL”</li>
        <li>“Show transcript and logs for call 4943”</li>
        <li>“What’s my wallet balance?”</li>
      </ul>
      <p>
        Claude uses tools such as <code>list_agents</code>, <code>create_agent</code>,{" "}
        <code>outbound_call</code>, <code>get_website_webhook</code>, and{" "}
        <code>snapserve_api</code> for anything else on the API.
      </p>

      <h2 id="prerequisites">Prerequisites</h2>
      <ol>
        <li>
          A SnapServe account on{" "}
          <a href="https://app.snapserve.ai" target="_blank" rel="noreferrer">
            app.snapserve.ai
          </a>
          .
        </li>
        <li>
          An API key from{" "}
          <a href="https://app.snapserve.ai/app/api-keys" target="_blank" rel="noreferrer">
            Dashboard → API Keys
          </a>{" "}
          (<code>sk_live_…</code>). See <Link href="/docs/authentication">Authentication</Link>.
        </li>
        <li>
          Claude Desktop or Claude Code, plus Node.js 20+ if you run the MCP from this repo.
        </li>
      </ol>

      <Callout variant="warn" title="Keep sk_live_ secret">
        Put the key only in MCP <code>env</code> / your secret manager — never paste the full key
        into public chats or commit it to git.
      </Callout>

      <h2 id="install-mcp">1. Install the SnapServe MCP</h2>
      <p>
        Prefer the published npm package <code>@snapserveai/mcp</code> (stdio via{" "}
        <code>npx</code>). Or build from this monorepo at <code>lib/snapserve-mcp</code>{" "}
        (workspace package name <code>@snapserve/mcp</code>).
      </p>
      <p>
        <strong>Hosted (no local install):</strong> Claude custom connector URL{" "}
        <code>https://app.snapserve.ai/api/mcp</code> — see{" "}
        <Link href="/docs/sdks#mcp">API Wrappers &amp; SDKs → MCP</Link>.
      </p>
      <CodeBlock
        language="bash"
        code={`# Option A — npm (recommended for Claude Desktop / Cursor)
# see config JSON below with npx -y @snapserveai/mcp

# Option B — from this repo
git clone https://github.com/srundme/voiceorch.git
cd voiceorch
pnpm install
pnpm --filter @snapserve/mcp build
# binary: lib/snapserve-mcp/dist/index.js`}
      />

      <h2 id="claude-desktop">2. Claude Desktop</h2>
      <p>
        Edit Claude’s config file (macOS:{" "}
        <code>~/Library/Application Support/Claude/claude_desktop_config.json</code>).{" "}
        <strong>Recommended (npm):</strong>
      </p>
      <CodeBlock
        language="json"
        code={`{
  "mcpServers": {
    "snapserve": {
      "command": "npx",
      "args": ["-y", "@snapserveai/mcp"],
      "env": {
        "SNAPSERVE_API_KEY": "sk_live_YOUR_KEY",
        "SNAPSERVE_BASE_URL": "https://app.snapserve.ai/api"
      }
    }
  }
}`}
      />
      <p>
        Or point <code>command</code>/<code>args</code> at a built{" "}
        <code>lib/snapserve-mcp/dist/index.js</code> from the repo.
      </p>
      <ol>
        <li>Replace the API key (and path if using the repo binary).</li>
        <li>Fully quit and reopen Claude Desktop.</li>
        <li>
          Confirm the SnapServe MCP appears under tools / connectors (wording varies by Claude
          version).
        </li>
      </ol>
      <p>
        <strong>Skill:</strong> copy the folder{" "}
        <code>claude-skill/snapserve</code> (or{" "}
        <code>.claude/skills/snapserve</code> from the repo) into your Claude skills directory so
        Claude loads SnapServe workflows automatically. Restart Claude after copying.
      </p>

      <h2 id="claude-code">3. Claude Code</h2>
      <CodeBlock
        language="bash"
        code={`# Hosted HTTP connector
claude mcp add snapserve --transport http \\
  --url https://app.snapserve.ai/api/mcp \\
  --header "Authorization: Bearer sk_live_YOUR_KEY"

# Or local stdio via npm
claude mcp add snapserve \\
  --env SNAPSERVE_API_KEY=sk_live_YOUR_KEY \\
  --env SNAPSERVE_BASE_URL=https://app.snapserve.ai/api \\
  -- npx -y @snapserveai/mcp`}
      />
      <p>
        With the repo open, Claude Code can also use{" "}
        <code>.claude/skills/snapserve/SKILL.md</code> for product guidance.
      </p>

      <h2 id="try-it">4. Try it</h2>
      <p>In a new Claude chat:</p>
      <CodeBlock
        language="text"
        code={`Using SnapServe, list my agents and show my wallet balance.`}
      />
      <p>Then try a website intake flow:</p>
      <CodeBlock
        language="text"
        code={`Create a campaign named "Website leads" for agent <id>, then give me the
website webhook URL and a curl example to POST a test lead.`}
      />
      <p>
        Paste the returned URL into your form / Sheet / Zap. Live intake path:
      </p>
      <CodeBlock
        language="bash"
        code={`curl -X POST 'https://app.snapserve.ai/api/webhooks/lead/YOUR_TOKEN' \\
  -H 'Content-Type: application/json' \\
  -d '{"phone":"+919876543210","name":"Test Lead"}'`}
      />

      <h2 id="skill-only">Skill only (no MCP)</h2>
      <p>
        If you only install the skill, Claude can still guide you and draft{" "}
        <code>curl</code> / SDK calls using your key — but it cannot call SnapServe live until MCP
        is connected. Prefer MCP for create-agent / campaign / dial actions.
      </p>
      <p>
        Manual REST wrappers: <Link href="/docs/sdks">API Wrappers &amp; SDKs</Link>. Full public
        HTTP surface: <Link href="/docs/api-reference">API Reference</Link>.
      </p>

      <h2 id="safety">Safety</h2>
      <ul>
        <li>Confirm before delete agent / campaign.</li>
        <li>Don’t invent transcripts — ask Claude to fetch call detail / logs.</li>
        <li>
          Phone purchase / KYC / Razorpay top-ups stay in the{" "}
          <a href="https://app.snapserve.ai/app" target="_blank" rel="noreferrer">
            dashboard
          </a>{" "}
          when checkout is required.
        </li>
      </ul>

      <h2 id="also-cursor">Also works in Cursor</h2>
      <p>
        Same MCP binary. Copy <code>.cursor/mcp.json.example</code> →{" "}
        <code>.cursor/mcp.json</code> in the repo and set <code>SNAPSERVE_API_KEY</code>. Project
        skill: <code>.agents/skills/snapserve</code>.
      </p>

      <Callout variant="info" title="Source of truth">
        User how-to in the repo: <code>claude-skill/snapserve/README.md</code>. Install details:{" "}
        <code>claude-skill/snapserve/references/install-mcp.md</code>. Workflows:{" "}
        <code>references/workflows.md</code>.
      </Callout>
    </div>
  );
}
