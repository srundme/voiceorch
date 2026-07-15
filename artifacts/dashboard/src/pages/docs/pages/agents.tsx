import { Link } from "wouter";
import { Callout, Endpoint, PageHeader, ParamsTable } from "../DocsUi";
import { CodeBlock } from "../CodeBlock";

export default function AgentsPage() {
  return (
    <div>
      <PageHeader
        breadcrumb="Agents"
        title="Agents"
        description="An agent is a voice persona: system prompt, language, ASR/LLM/TTS, and tools. Create richly in the dashboard, then list / update / toggle from your app."
        copyText={`GET  https://app.snapserve.ai/api/agents
POST https://app.snapserve.ai/api/agents
GET  https://app.snapserve.ai/api/agents/{id}
PATCH https://app.snapserve.ai/api/agents/{id}
PATCH https://app.snapserve.ai/api/agents/{id}/toggle
DELETE https://app.snapserve.ai/api/agents/{id}`}
      />

      <Callout variant="info">
        Pass <code>agentId</code> to <Link href="/docs/outbound-calls">outbound calls</Link>. The
        agent must be <code>active</code> and your wallet must cover ₹5/min.
      </Callout>

      <Endpoint id="list" method="get" path="/agents" title="List agents" opId="listAgents">
        <CodeBlock
          language="bash"
          code={`curl https://app.snapserve.ai/api/agents \\
  -H "Authorization: Bearer $SNAPSERVE_API_KEY"`}
        />
        <CodeBlock
          language="json"
          code={`[
  {
    "id": 123,
    "name": "Support desk",
    "status": "active",
    "language": "en-IN",
    "asrProvider": "sarvam",
    "llmProvider": "groq",
    "ttsProvider": "cartesia"
  }
]`}
        />
      </Endpoint>

      <Endpoint id="get" method="get" path="/agents/{id}" title="Get agent" opId="getAgent">
        <CodeBlock
          language="bash"
          code={`curl https://app.snapserve.ai/api/agents/123 \\
  -H "Authorization: Bearer $SNAPSERVE_API_KEY"`}
        />
      </Endpoint>

      <Endpoint id="create" method="post" path="/agents" title="Create agent" opId="createAgent">
        <ParamsTable
          rows={[
            { name: "name", type: "string", required: true, description: "Display name" },
            { name: "systemPrompt", type: "string", required: true, description: "Instructions for the voice agent" },
            { name: "language", type: "string", description: "BCP-47 / locale, e.g. en-IN, hi-IN" },
            { name: "asrProvider", type: "string", description: "Speech-to-text provider key" },
            { name: "llmProvider", type: "string", description: "LLM provider key" },
            { name: "ttsProvider", type: "string", description: "Text-to-speech provider key" },
          ]}
        />
        <CodeBlock
          language="bash"
          code={`curl -X POST https://app.snapserve.ai/api/agents \\
  -H "Authorization: Bearer $SNAPSERVE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Support desk",
    "systemPrompt": "You are a helpful phone support agent. Keep answers short.",
    "language": "en-IN",
    "asrProvider": "sarvam",
    "llmProvider": "groq",
    "ttsProvider": "cartesia"
  }'`}
        />
        <p>
          Prefer the dashboard builder for the first agent (voices, tools, phone feel), then{" "}
          <code>GET</code> / <code>PATCH</code> from your app. Full schema in{" "}
          <Link href="/docs/api-reference/createAgent">API Reference → createAgent</Link>.
        </p>
      </Endpoint>

      <Endpoint id="update" method="patch" path="/agents/{id}" title="Update agent" opId="updateAgent">
        <CodeBlock
          language="bash"
          code={`curl -X PATCH https://app.snapserve.ai/api/agents/123 \\
  -H "Authorization: Bearer $SNAPSERVE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "systemPrompt": "Updated instructions…" }'`}
        />
      </Endpoint>

      <Endpoint
        id="toggle"
        method="patch"
        path="/agents/{id}/toggle"
        title="Toggle active / paused"
        opId="toggleAgent"
      >
        <CodeBlock
          language="bash"
          code={`curl -X PATCH https://app.snapserve.ai/api/agents/123/toggle \\
  -H "Authorization: Bearer $SNAPSERVE_API_KEY"`}
        />
      </Endpoint>

      <Endpoint id="delete" method="delete" path="/agents/{id}" title="Delete agent" opId="deleteAgent">
        <CodeBlock
          language="bash"
          code={`curl -X DELETE https://app.snapserve.ai/api/agents/123 \\
  -H "Authorization: Bearer $SNAPSERVE_API_KEY"`}
        />
      </Endpoint>
    </div>
  );
}
