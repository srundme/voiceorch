import { Link } from "wouter";
import { Callout, PageHeader } from "../DocsUi";
import { CodeBlock } from "../CodeBlock";

const COPY = `Authorization: Bearer sk_live_YOUR_KEY
Base URL: https://app.snapserve.ai/api`;

export default function AuthenticationPage() {
  return (
    <div>
      <PageHeader
        breadcrumb="Overview"
        title="Authentication"
        description={
          <>
            Server-to-server requests use a developer API key (<code className="text-slate-800">sk_live_…</code>
            ). Keys are shown once when created — store them in a secret manager.
          </>
        }
        copyText={COPY}
      />

      <h2 id="create-a-key">Create a key</h2>
      <ol>
        <li>
          Sign in at{" "}
          <a href="https://app.snapserve.ai" target="_blank" rel="noreferrer">
            app.snapserve.ai
          </a>
          .
        </li>
        <li>
          Open{" "}
          <a href="https://app.snapserve.ai/app/api-keys" target="_blank" rel="noreferrer">
            API Keys
          </a>{" "}
          in the dashboard.
        </li>
        <li>Create a key, copy the full value immediately.</li>
      </ol>
      <p>
        Up to <strong>5 active keys</strong> per account. Revoke unused keys.
      </p>

      <Callout variant="warn" title="Never expose sk_live_ in browsers">
        API keys authenticate as your full account. Use them only from your backend, workers, or
        secure server environments — not React, mobile apps, or public clients.
      </Callout>

      <h2 id="bearer-header">Authorization header</h2>
      <p>Every request needs:</p>
      <CodeBlock
        language="http"
        code={`Authorization: Bearer sk_live_YOUR_KEY
Content-Type: application/json`}
      />
      <CodeBlock
        language="bash"
        code={`export SNAPSERVE_API_KEY=sk_live_YOUR_KEY

curl https://app.snapserve.ai/api/agents \\
  -H "Authorization: Bearer $SNAPSERVE_API_KEY" \\
  -H "Content-Type: application/json"`}
      />

      <h2 id="errors">Auth errors</h2>
      <CodeBlock
        language="json"
        code={`{ "error": "Unauthorized" }
{ "error": "Invalid or revoked API key" }`}
      />
      <p>
        Both return HTTP <code>401</code>. See <Link href="/docs/errors">Errors</Link>.
      </p>

      <h2 id="dashboard-sessions">Dashboard sessions</h2>
      <p>
        The web app uses a separate session JWT after login. That path is for browsers only. Your
        application should always use <code>sk_live_</code>.
      </p>

      <h2 id="next">Next</h2>
      <p>
        Follow the <Link href="/docs/quick-start">Quick Start</Link> to list agents and place a call,
        or connect <Link href="/docs/claude-skill">Claude skill &amp; MCP</Link> to operate SnapServe
        from Claude Desktop / Claude Code.
      </p>
    </div>
  );
}
