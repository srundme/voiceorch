import { Link } from "wouter";
import { Callout, PageHeader } from "../DocsUi";

export default function AgentsPage() {
  return (
    <div>
      <PageHeader
        breadcrumb="Product guides"
        title="Agents & builder"
        description="Create the voice persona in the dashboard, then drive it from your app with the Agents API."
      />

      <h2 id="dashboard">Build in the dashboard</h2>
      <ol>
        <li>
          Open{" "}
          <a href="https://app.snapserve.ai/app/agents" target="_blank" rel="noreferrer">
            Agents
          </a>{" "}
          → create or open an agent.
        </li>
        <li>
          <strong>Prompt</strong> — instructions, language, and an explicit{" "}
          <strong>Greeting message</strong> (exact first line). Use{" "}
          <Link href="/docs/variables">variables</Link> like <code>{"{{name}}"}</code>. The agent
          display name is an internal label — not automatically your company brand on the call.
        </li>
        <li>
          <strong>Voice</strong> — speak / listen providers (or BYOP keys under Providers).
        </li>
        <li>
          <strong>Tools</strong> — transfer, HTTP, booking (
          <Link href="/docs/calendar">calendar</Link>), etc.
        </li>
        <li>
          <strong>Outcomes</strong> (top-level Builder tab) — taxonomy, funnel meaning (Interested /
          Callback / DNC), data fields, and <strong>after-call WhatsApp / email</strong> rules. Wire
          channels under Connections first (or save rules and connect later). Mid-call WhatsApp is
          under Tools.
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
        Pass <code>agentId</code> to{" "}
        <Link href="/docs/api-reference/initiateOutboundCall">POST /calls/outbound</Link>. Wallet
        must cover ₹5/min. See <Link href="/docs/outbound-calls">Calls &amp; history</Link>.
      </p>
    </div>
  );
}
