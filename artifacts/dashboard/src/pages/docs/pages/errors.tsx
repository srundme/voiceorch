import { CodeBlock } from "../CodeBlock";
import { Link } from "wouter";

export default function ErrorsPage() {
  return (
    <div>
      <h1>Errors</h1>
      <p>
        Failed requests return JSON <code>{`{ "error": "…" }`}</code> (sometimes with{" "}
        <code>code</code> or <code>issues</code>). Treat non-2xx as failures and log the body.
      </p>

      <h2 id="status-codes">HTTP status codes</h2>
      <div className="my-4 overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs uppercase bg-white/5 text-muted-foreground border-b border-border">
            <tr>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Meaning</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["401", "Missing/invalid session or sk_live_ key"],
              ["400", "Validation failed — check issues[] or error string"],
              ["402", "Payment / wallet — often insufficient balance"],
              ["403", "Forbidden (suspended account, compliance block)"],
              ["404", "Resource not found or not owned by this account"],
              ["409", "Conflict (e.g. number already taken)"],
              ["429", "Rate limited — back off and retry"],
              ["5xx", "Server / upstream provider error — retry with jitter"],
            ].map(([s, m]) => (
              <tr key={s} className="border-b border-white/5 hover:bg-white/5">
                <td className="px-4 py-3 font-mono text-xs">{s}</td>
                <td className="px-4 py-3 text-muted-foreground">{m}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 id="auth-errors">Auth examples</h2>
      <CodeBlock
        language="json"
        code={`{ "error": "Unauthorized" }
{ "error": "Invalid or revoked API key" }`}
      />

      <h2 id="rate-limits">Rate limits</h2>
      <p>
        Authenticated traffic has a higher per-user allowance than anonymous IP limits. On{" "}
        <code>429</code>, wait and retry; avoid tight polling loops — use{" "}
        <Link href="/docs/webhooks">webhooks</Link> for call completion.
      </p>

      <h2 id="idempotency">Idempotency</h2>
      <p>
        Do not spam identical <code>POST /calls/outbound</code> on network timeouts without
        checking whether a call was already created (list recent calls or store your own
        idempotency key in your database).
      </p>
    </div>
  );
}
