import { Link } from "wouter";
import { Callout, PageHeader } from "../DocsUi";
import { CodeBlock } from "../CodeBlock";

export default function CallerMemoryPage() {
  return (
    <div>
      <PageHeader
        breadcrumb="Product guides"
        title="Caller memory updates"
        updated="18 Aug 2026"
        description="Push the latest status of a caller's request into agent memory so follow-up questions are answered from current ground truth — including campaign dials."
      />

      <p>
        SnapServe already remembers durable identity (name, location, language) from past calls.
        Request status — refund approved, order shipped, appointment moved — used to live only in
        your CRM. Use the endpoints below, or Memory / campaign lead Memory in the dashboard, to
        write that status onto the caller so the next conversation uses it automatically.
      </p>

      <Callout variant="info" title="Not runtime variables on outbound">
        <code>POST /calls/outbound</code> still accepts only <code>agentId</code> and{" "}
        <code>toNumber</code>. Per-caller updates go through caller memory (and campaign lead
        fields). See <Link href="/docs/variables">Variables</Link>.
      </Callout>

      <h2 id="what-gets-injected">What the agent sees</h2>
      <ul>
        <li>
          A freeform <code>note</code> is stored as <code>operator_update</code> and shown as{" "}
          <strong>Latest update</strong>.
        </li>
        <li>
          A <code>context</code> or <code>facts</code> map (for example{" "}
          <code>order_status: shipped</code>) is stored under <code>ext_order_status</code> and
          injected in an <strong>OPERATOR / CRM UPDATES</strong> block. The agent is told this is
          ground truth and must not re-ask.
        </li>
        <li>
          On a <strong>campaign</strong> dial, the same fields are merged into the lead so they
          also appear in <strong>LEAD CONTEXT</strong> (and as <code>{"{{order_status}}"}</code> if
          you mapped that variable).
        </li>
      </ul>

      <h2 id="api">API</h2>
      <p>
        Phone in the path must be URL-encoded. Auth is the same session or{" "}
        <Link href="/docs/authentication">API key</Link> as the rest of the agents API.
      </p>
      <CodeBlock
        language="bash"
        code={`curl -X POST "https://app.snapserve.ai/api/agents/36/caller-memory/%2B919876543210/facts" \\
  -H "Authorization: Bearer $SNAPSERVE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "note": "Refund of 1200 approved. Tracking TRK-441.",
    "context": {
      "order_status": "refund_approved",
      "tracking_id": "TRK-441"
    }
  }'`}
      />
      <p>
        Full schema:{" "}
        <Link href="/docs/api-reference/upsertCallerMemoryFacts">
          POST /agents/&#123;id&#125;/caller-memory/&#123;phone&#125;/facts
        </Link>
        .
      </p>

      <h2 id="campaigns">Campaigns</h2>
      <p>
        From a campaign lead, either add a <strong>Note</strong> (automatically copied into caller
        memory) or POST structured fields:
      </p>
      <CodeBlock
        language="bash"
        code={`curl -X POST "https://app.snapserve.ai/api/campaigns/12/leads/88/memory" \\
  -H "Authorization: Bearer $SNAPSERVE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "context": { "order_status": "shipped" } }'`}
      />
      <p>
        That writes caller memory for the campaign’s agent <em>and</em> updates{" "}
        <code>leadData</code>, so the next auto-dial already has the new status. Dashboard: open
        the lead → Overview or Memory → Save for next call.
      </p>
      <p>
        <Link href="/docs/api-reference/upsertCampaignLeadMemory">
          POST /campaigns/&#123;id&#125;/leads/&#123;leadId&#125;/memory
        </Link>
        .
      </p>

      <h2 id="dashboard">In the dashboard</h2>
      <ol>
        <li>
          <strong>Campaigns</strong> → open a lead → Overview or the <strong>Memory</strong> tab →
          Save for next call.
        </li>
        <li>
          <strong>Memory</strong> → pick an agent and caller → <em>Update for next call</em>.
        </li>
        <li>
          <strong>Calls</strong> → open a call → Caller Memory sidebar → update for the next
          conversation.
        </li>
      </ol>

      <h2 id="next">Next</h2>
      <p>
        <Link href="/docs/campaigns">Campaigns</Link> ·{" "}
        <Link href="/docs/variables">Variables</Link> ·{" "}
        <Link href="/docs/agents">Agents &amp; builder</Link>
      </p>
    </div>
  );
}
