import { Link } from "wouter";
import { Callout, PageHeader } from "../DocsUi";
import { CodeBlock } from "../CodeBlock";

export default function VariablesPage() {
  return (
    <div>
      <PageHeader
        breadcrumb="Product guides"
        title="Variables"
        description="Inject per-call data into the agent prompt so every conversation is personalized."
      />

      <h2 id="syntax">Syntax</h2>
      <p>
        In the agent system prompt (or greeting), use double curly braces:
      </p>
      <CodeBlock language="text" code={`Hello {{customer_name}}, I'm calling about {{order_id}}.`} />

      <h2 id="dashboard">In the dashboard</h2>
      <ol>
        <li>Open an agent → builder.</li>
        <li>Add variables in the Variables section (name + optional default).</li>
        <li>Reference them in the prompt as <code>{"{{name}}"}</code>.</li>
        <li>Save / publish the agent.</li>
      </ol>

      <Callout variant="tip">
        Campaigns and lead CSVs can map columns onto the same variable names so each dial is
        unique without changing the agent.
      </Callout>

      <h2 id="api">Via API</h2>
      <p>
        Manage the registry with{" "}
        <Link href="/docs/api-reference/listAgentVariables">list / create / update / delete agent variables</Link>
        .
      </p>
      <p>
        For <strong>runtime values on each outbound call</strong> (patient name, category, questions),
        pass a <code>variables</code> object on{" "}
        <Link href="/docs/api-reference/initiateOutboundCall">POST /calls/outbound</Link>. The same
        agent can dial hundreds of patients; only the payload changes. Keys fill{" "}
        <code>{"{{placeholders}}"}</code> in the prompt and greeting. The whole bag is also injected
        as a <strong>THIS CALL</strong> block, so a <code>questions</code> array is asked even if you
        did not list every item in the script.
      </p>
      <CodeBlock
        language="bash"
        code={`curl -X POST https://app.snapserve.ai/api/calls/outbound \\
  -H "Authorization: Bearer $SNAPSERVE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "agentId": 36,
    "toNumber": "+919876543210",
    "variables": {
      "patient_name": "Priya Sharma",
      "category": "post-op knee",
      "questions": [
        "How is your pain today on a scale of 1 to 10?",
        "Have you been walking as advised?",
        "Any swelling, fever, or discharge from the wound?"
      ]
    }
  }'`}
      />
      <Callout variant="tip" title="One agent, many questionnaires">
        Keep the system prompt generic: greet {"{{patient_name}}"}, then ask every question listed
        under THIS CALL in order. Do not hardcode hospital categories.{" "}
        <code>parameters</code> is accepted as an alias of <code>variables</code>.
      </Callout>

      <h2 id="next">Next</h2>
      <p>
        <Link href="/docs/agents">Agents &amp; builder</Link> ·{" "}
        <Link href="/docs/api-reference/initiateOutboundCall">Make a call</Link>
      </p>
    </div>
  );
}
