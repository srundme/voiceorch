import { CodeBlock } from "../CodeBlock";

// Node.js/Python SDKs + Claude Skill reference for developers integrating with the API.
export default function SdksPage() {
  return (
    <div>
      <h1>SDKs &amp; Claude Skill</h1>
      <p>
        Build against the SnapServe API from Node.js or Python with official SDKs, or give an AI
        agent (like Claude) a ready-made skill that manages your agents and calls on your behalf.
        Both use the same developer API key as the raw REST API — create one in{" "}
        <strong>Dashboard → API Keys</strong>.
      </p>

      <h2 id="node">Node.js / TypeScript SDK</h2>
      <CodeBlock language="bash" code={`npm install @snapserve/sdk`} />
      <CodeBlock
        language="typescript"
        code={`import { SnapServe } from "@snapserve/sdk";

const snapserve = new SnapServe({ apiKey: process.env.SNAPSERVE_API_KEY! });

const agents = await snapserve.agents.list();
const call = await snapserve.calls.createOutbound({
  agentId: agents[0].id,
  toNumber: "+15551234567",
});

const stats = await snapserve.analytics.dashboard();`}
      />
      <p>
        Resource namespaces: <code>agents</code>, <code>calls</code>, <code>providers</code>,{" "}
        <code>phoneNumbers</code>, <code>analytics</code>, <code>webhookEndpoints</code>,{" "}
        <code>wallet</code>, <code>account</code>, <code>scheduling</code>. Anything not wrapped
        yet is reachable via <code>snapserve.request(method, path, options)</code>.
      </p>

      <h2 id="python">Python SDK</h2>
      <CodeBlock language="bash" code={`pip install snapserve`} />
      <CodeBlock
        language="python"
        code={`import os
from snapserve import SnapServe

client = SnapServe(api_key=os.environ["SNAPSERVE_API_KEY"])

agents = client.agents.list()
call = client.calls.create_outbound({
    "agentId": agents[0]["id"],
    "toNumber": "+15551234567",
})

stats = client.analytics.dashboard()`}
      />
      <p>
        Same resource surface with snake_case names: <code>phone_numbers</code>,{" "}
        <code>webhook_endpoints</code>, etc. Anything not wrapped yet is reachable via{" "}
        <code>client.request(method, path, ...)</code>.
      </p>

      <h2 id="errors">Errors</h2>
      <p>
        Failed requests raise/throw <code>SnapServeApiError</code> with the HTTP status and the
        parsed response body, in both SDKs.
      </p>

      <h2 id="claude-skill">Claude Skill</h2>
      <p>
        The SnapServe Claude Skill teaches Claude how to manage your voice agents, place calls,
        and read analytics using your API key — so you can ask Claude things like &ldquo;create an
        agent for my clinic&rdquo; or &ldquo;call this lead with my sales agent&rdquo; directly
        from a chat.
      </p>
      <p>To install it:</p>
      <ol>
        <li>Create an API key in <strong>Dashboard → API Keys</strong>.</li>
        <li>
          Download the skill package (a <code>SKILL.md</code> plus reference docs) and add it to
          your Claude Skills directory, or paste its contents into a custom Claude project.
        </li>
        <li>
          When Claude asks for credentials, provide your SnapServe API key — it is only used to
          authenticate requests to your own account and is never sent anywhere else.
        </li>
      </ol>
      <p>
        Once installed, Claude can list/create/update agents, place and end calls, manage provider
        keys, and read analytics — with destructive actions (deleting an agent, ending a live
        call) always confirmed with you first.
      </p>

      <h2 id="raw-api">Prefer raw HTTP?</h2>
      <p>
        Both SDKs are thin wrappers over the same REST API described in the{" "}
        <a href="/docs/api-reference">API Reference</a>. You can always call endpoints directly
        with <code>fetch</code>/<code>curl</code> using the same <code>sk_live_</code> key — see{" "}
        <a href="/docs/authentication#api-key-auth">Authentication</a>.
      </p>
    </div>
  );
}
