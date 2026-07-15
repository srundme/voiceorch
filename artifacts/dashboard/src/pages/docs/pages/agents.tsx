import { CodeBlock } from "../CodeBlock";
import { Link } from "wouter";

export default function AgentsPage() {
  return (
    <div>
      <h1>Agents API</h1>
      <p>
        An <strong>agent</strong> is a voice persona: system prompt, language, ASR/LLM/TTS
        providers, and optional tools. Create agents in the dashboard for the richest editor,
        or manage them over the API from your application.
      </p>

      <h2 id="list">List agents</h2>
      <CodeBlock
        language="bash"
        code={`curl https://app.snapserve.ai/api/agents \\
  -H "Authorization: Bearer $SNAPSERVE_API_KEY"`}
      />

      <h2 id="get">Get one agent</h2>
      <CodeBlock
        language="bash"
        code={`curl https://app.snapserve.ai/api/agents/123 \\
  -H "Authorization: Bearer $SNAPSERVE_API_KEY"`}
      />

      <h2 id="create">Create an agent</h2>
      <p>
        Request bodies match the OpenAPI <code>CreateAgent</code> schema. Minimal fields typically
        include <code>name</code>, <code>systemPrompt</code>, language, and provider choices.
        Prefer creating the first agent in the UI, then use <code>GET</code> / <code>PATCH</code>{" "}
        from your app.
      </p>
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

      <h2 id="update">Update / toggle</h2>
      <CodeBlock
        language="bash"
        code={`# Partial update
curl -X PATCH https://app.snapserve.ai/api/agents/123 \\
  -H "Authorization: Bearer $SNAPSERVE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "systemPrompt": "Updated instructions…" }'

# Activate or pause
curl -X PATCH https://app.snapserve.ai/api/agents/123/toggle \\
  -H "Authorization: Bearer $SNAPSERVE_API_KEY"`}
      />

      <h2 id="delete">Delete</h2>
      <CodeBlock
        language="bash"
        code={`curl -X DELETE https://app.snapserve.ai/api/agents/123 \\
  -H "Authorization: Bearer $SNAPSERVE_API_KEY"`}
      />

      <h2 id="calling">Using an agent on a call</h2>
      <p>
        Pass <code>agentId</code> to <Link href="/docs/outbound-calls">outbound calls</Link>.
        The agent must be <code>active</code> and your wallet must cover the call at ₹5/min.
      </p>

      <p>
        Full schemas: <Link href="/docs/api-reference">API Reference</Link>.
      </p>
    </div>
  );
}
