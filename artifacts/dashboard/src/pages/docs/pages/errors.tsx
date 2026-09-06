import { Link } from "wouter";
import { Callout, PageHeader } from "../DocsUi";
import { CodeBlock } from "../CodeBlock";

export default function ErrorsPage() {
  return (
    <div>
      <PageHeader
        breadcrumb="Reference"
        title="Errors"
        description='Failed requests return JSON { "error": "…" } (sometimes with code or issues). Treat non-2xx as failures.'
        copyText={`401 Unauthorized / Invalid or revoked API key
402 Insufficient wallet balance
404 Not found
429 Rate limited`}
      />

      <h2 id="status-codes">HTTP status codes</h2>
      <div className="not-prose my-4 overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-sm text-left">
          <thead className="text-[11px] uppercase tracking-wider bg-slate-50 text-muted-foreground border-b border-slate-200">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Status</th>
              <th className="px-4 py-2.5 font-semibold">Meaning</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["401", "Missing/invalid session or sk_live_ key"],
              ["400", "Validation failed — check issues[] or error string"],
              ["402", "Payment / wallet — often insufficient balance"],
              ["403", "Forbidden (suspended account, compliance block)"],
              ["404", "Resource not found, or you hit api.snapserve.ai / docs.snapserve.ai (use app.snapserve.ai)"],
              ["409", "Conflict (e.g. number already taken)"],
              ["429", "Rate limited — back off and retry"],
              ["5xx", "Server / upstream provider error — retry with jitter"],
            ].map(([s, m]) => (
              <tr key={s} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-3 font-mono text-xs text-slate-800">{s}</td>
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

      <Callout variant="tip">
        Prefer <Link href="/docs/webhooks">webhooks</Link> over tight polling loops to avoid{" "}
        <code>429</code>.
      </Callout>

      <h2 id="rate-limits">Rate limits</h2>
      <p>
        Authenticated traffic has a higher per-user allowance than anonymous IP limits. On{" "}
        <code>429</code>, wait and retry with backoff.
      </p>

      <h2 id="idempotency">Idempotency</h2>
      <p>
        Do not spam identical <code>POST /calls/outbound</code> on network timeouts without checking
        whether a call was already created (list recent calls or store your own idempotency key).
      </p>
    </div>
  );
}
