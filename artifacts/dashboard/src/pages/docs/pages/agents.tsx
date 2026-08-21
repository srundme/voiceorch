import { Link } from "wouter";
import { Callout, PageHeader } from "../DocsUi";

export default function AgentsPage() {
  return (
    <div>
      <PageHeader
        breadcrumb="Build agents"
        title="Agents & builder"
        description="Create the voice persona in Vibe or the classic builder, then drive it from your app with the Agents API."
      />

      <Callout variant="tip" title="Recommended">
        New agents: start in <Link href="/docs/vibe">Vibe</Link>. This page is the full builder
        checklist (also the Agent tab inside Vibe).
      </Callout>

      <h2 id="dashboard">Build in the dashboard</h2>
      <ol>
        <li>
          Open{" "}
          <a href="https://app.snapserve.ai/app/vibe" target="_blank" rel="noreferrer">
            Vibe
          </a>{" "}
          or{" "}
          <a href="https://app.snapserve.ai/app/agents" target="_blank" rel="noreferrer">
            Agents
          </a>{" "}
          → create or open an agent.
        </li>
        <li>
          <strong>Script</strong> — welcome (exact first line) then call instructions. Use{" "}
          <Link href="/docs/variables">variables</Link> like <code>{"{{name}}"}</code>. The agent
          display name is an internal label — not automatically your company brand on the call.
        </li>
        <li>
          <strong>Sound</strong> — voice, language, and Fast / Balanced / Patient turn-taking.
        </li>
        <li>
          <strong>Actions</strong> — booking, transfer, mid-call WhatsApp / email. Connect the
          account once under <Link href="/docs/connections">Connections</Link>, then pick the
          template or meeting here.
        </li>
        <li>
          <strong>After the call</strong> — outcome labels, per-outcome WhatsApp templates, and
          voicemail. Mid-call send stays on Actions.
        </li>
        <li>
          <strong>Activity</strong> — this agent’s call volume, success rate, spend, and latency.
          Platform-wide funnel stays at{" "}
          <a href="https://app.snapserve.ai/app/analytics" target="_blank" rel="noreferrer">
            /app/analytics
          </a>
          .
        </li>
        <li>
          <strong>Knowledge</strong> — attach a{" "}
          <Link href="/docs/knowledge-base">knowledge base</Link>.
        </li>
        <li>
          <strong>Phone</strong> — assign a number for caller ID / inbound.
        </li>
        <li>
          <strong>Meetings</strong> (optional) — meeting prompt + deck for Meet/Zoom/Teams.{" "}
          <Link href="/docs/meetings">Meetings guide</Link>.
        </li>
        <li>
          <strong>Save</strong>, then toggle <strong>Active</strong> when ready.
        </li>
        <li>
          Optional: <strong>Settings → Website</strong> — copy embed code so visitors can webcall this
          agent on your site.{" "}
          <Link href="/docs/website-embed">Website embed guide</Link>.
        </li>
        <li>Use Test / Publish flows in the builder before going live.</li>
      </ol>

      <Callout variant="tip">
        First agent: build in the UI. Day-to-day from your product: list / patch / toggle via API.
      </Callout>

      <h2 id="api">Agents API</h2>
      <p>Full schemas and cURL in the API Reference:</p>
      <ul>
        <li>
          <Link href="/docs/api-reference/listAgents">List agents</Link>
        </li>
        <li>
          <Link href="/docs/api-reference/createAgent">Create agent</Link>
        </li>
        <li>
          <Link href="/docs/api-reference/getAgent">Get agent</Link>
        </li>
        <li>
          <Link href="/docs/api-reference/updateAgent">Update (save) agent</Link>
        </li>
        <li>
          <Link href="/docs/api-reference/toggleAgent">Toggle active</Link>
        </li>
        <li>
          <Link href="/docs/api-reference/deleteAgent">Delete agent</Link>
        </li>
      </ul>

      <h2 id="calls">Using on a call</h2>
      <p>
        Pass <code>agentId</code> and optional <code>variables</code> (patient fields, questions) to{" "}
        <Link href="/docs/api-reference/initiateOutboundCall">POST /calls/outbound</Link>. Wallet
        must cover ₹5/min. See <Link href="/docs/variables">Variables</Link> and{" "}
        <Link href="/docs/outbound-calls">Calls &amp; history</Link>.
      </p>
    </div>
  );
}
