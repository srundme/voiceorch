import { CodeBlock } from "../CodeBlock";

export default function AuthenticationPage() {
  return (
    <div>
      <h1>Authentication</h1>
      <p>
        SnapServe uses Google OAuth for user authentication. There are no passwords. After signing in
        with Google, the platform issues a signed JWT that you use to authenticate all API requests.
      </p>

      <h2 id="signing-in">Signing in</h2>
      <ol>
        <li>Navigate to <strong>app.snapserve.ai</strong>.</li>
        <li>Click <strong>Sign in with Google</strong>.</li>
        <li>Approve the OAuth consent screen (only name and email are requested).</li>
        <li>
          You are redirected back. The platform issues a 30-day JWT and stores it in localStorage
          under the key <code>voiceorch:session</code>.
        </li>
      </ol>
      <p>
        First-time sign-in automatically provisions your account with a $5 welcome credit and a
        wallet. No further setup is required.
      </p>

      <h2 id="session-token">Session token</h2>
      <p>
        The session token is a signed HS256 JWT with a 30-day expiry. It contains your Google
        subject identifier, email, and display name. You can read it directly from the browser:
      </p>
      <CodeBlock language="javascript" code={`const token = localStorage.getItem("voiceorch:session");
console.log(token); // eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`} />

      <h2 id="api-requests">Making authenticated API requests</h2>
      <p>Include the token in every API request as a Bearer token in the Authorization header:</p>
      <CodeBlock language="http" code={`GET /api/agents HTTP/1.1
Host: app.snapserve.ai
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`} />

      <CodeBlock language="javascript" code={`const res = await fetch("https://app.snapserve.ai/api/agents", {
  headers: {
    "Authorization": \`Bearer \${token}\`,
    "Content-Type": "application/json",
  },
});`} />

      <CodeBlock language="python" code={`import requests

token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."

resp = requests.get(
    "https://app.snapserve.ai/api/agents",
    headers={"Authorization": f"Bearer {token}"}
)
agents = resp.json()["agents"]`} />

      <h2 id="sse-auth">Server-sent events (SSE)</h2>
      <p>
        EventSource connections cannot set custom headers. Pass the token as a query parameter
        instead:
      </p>
      <CodeBlock language="javascript" code={`const es = new EventSource(
  \`https://app.snapserve.ai/api/calls/\${callId}/stream?token=\${token}\`
);
es.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log(data.transcript);
};`} />

      <h2 id="token-expiry">Token expiry and re-authentication</h2>
      <p>
        Tokens are valid for 30 days from issue. After expiry, API calls return{" "}
        <code>401 Unauthorized</code>. To renew, visit the sign-in page and complete the Google
        OAuth flow again. A new token is issued and stored automatically.
      </p>
      <p>
        You can detect expiry in your application by checking the response status:
      </p>
      <CodeBlock language="javascript" code={`const res = await fetch("/api/agents", {
  headers: { Authorization: \`Bearer \${token}\` },
});

if (res.status === 401) {
  // Token expired — redirect to sign-in
  window.location.href = "/";
}`} />

      <h2 id="decoding-the-token">Decoding the token (optional)</h2>
      <p>
        The JWT payload can be decoded (not verified) client-side to read identity fields. Do not
        trust the decoded payload for security decisions — always validate server-side.
      </p>
      <CodeBlock language="javascript" code={`function decodeJWT(token) {
  const [, payload] = token.split(".");
  return JSON.parse(atob(payload));
}

const { sub, email, name, exp } = decodeJWT(token);
// sub   — Google account identifier
// email — user's Google email
// name  — display name
// exp   — expiry timestamp (Unix seconds)`} />

      <h2 id="admin-auth">Admin authentication</h2>
      <p>
        Platform admin endpoints (<code>/api/admin/*</code>) use a separate token passed via the{" "}
        <code>x-admin-token</code> request header. This token is set by the platform operator and
        is not available to regular users. Admin access is not part of the public API surface.
      </p>

      <h2 id="security">Security notes</h2>
      <ul>
        <li>
          <strong>HTTPS only</strong> — All API traffic is served over HTTPS. Never call the API
          over plain HTTP.
        </li>
        <li>
          <strong>Key storage</strong> — Provider API keys are encrypted with AES-256-GCM before
          being stored in the database. They are never returned in full via the API — only the last
          four characters are shown.
        </li>
        <li>
          <strong>No client-side key exposure</strong> — Provider keys are used server-side by the
          orchestration pipeline. They are never sent to the browser.
        </li>
      </ul>
    </div>
  );
}
