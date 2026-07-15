import { CodeBlock } from "../CodeBlock";
import { Link } from "wouter";

export default function AuthenticationPage() {
  return (
    <div>
      <h1>Authentication</h1>
      <p>
        Server-to-server requests use a developer API key. Keys look like{" "}
        <code>sk_live_…</code> and are shown once when created.
      </p>

      <h2 id="create-a-key">Create a key</h2>
      <ol>
        <li>Sign in at <a href="https://app.snapserve.ai" target="_blank" rel="noreferrer">app.snapserve.ai</a>.</li>
        <li>Open <strong><a href="https://app.snapserve.ai/app/api-keys">API Keys</a></strong> in the dashboard sidebar.</li>
        <li>Create a key, copy the full value immediately, and store it in a secret manager.</li>
      </ol>
      <p>
        You can have up to <strong>5 active keys</strong> per account. Revoke keys you no longer use.
      </p>

      <h2 id="bearer-header">Authorization header</h2>
      <CodeBlock
        language="bash"
        code={`curl https://app.snapserve.ai/api/agents \\
  -H "Authorization: Bearer sk_live_YOUR_KEY" \\
  -H "Content-Type: application/json"`}
      />
      <p>
        Invalid or revoked keys return <code>401</code> with{" "}
        <code>{`{ "error": "Invalid or revoked API key" }`}</code>.
      </p>

      <h2 id="safety">Security practices</h2>
      <ul>
        <li>Never put <code>sk_live_</code> keys in frontend JavaScript or mobile apps.</li>
        <li>Prefer environment variables (<code>SNAPSERVE_API_KEY</code>) or a vault.</li>
        <li>Rotate keys if they leak — revoke the old key in the dashboard.</li>
      </ul>

      <h2 id="dashboard-sessions">Dashboard sessions</h2>
      <p>
        The web app uses a separate session JWT after Google / email login. That path is for
        browsers only. For your application, always use <code>sk_live_</code>.
      </p>

      <h2 id="next">Next</h2>
      <p>
        Follow the <Link href="/docs/quick-start">Quick Start</Link> to list agents and place a call.
      </p>
    </div>
  );
}
