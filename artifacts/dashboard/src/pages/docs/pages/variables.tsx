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
      <CodeBlock
        language="bash"
        code={`curl https://app.snapserve.ai/api/agents/36/variables \\
  -H "Authorization: Bearer $SNAPSERVE_API_KEY"`}
      />
      <p>
        When placing an outbound call, pass runtime values in the call metadata / lead payload
        your integration uses (campaign field mappings or your own pre-call setup). For custom
        apps, keep the mapping layer in your backend and use the SnapServe agent that already
        expects those names.
      </p>

      <h2 id="next">Next</h2>
      <p>
        <Link href="/docs/agents">Agents &amp; builder</Link> ·{" "}
        <Link href="/docs/api-reference/initiateOutboundCall">Make a call</Link>
      </p>
    </div>
  );
}
