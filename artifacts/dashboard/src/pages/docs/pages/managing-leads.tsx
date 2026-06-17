import { CodeBlock } from "../CodeBlock";

export default function ManagingLeadsPage() {
  return (
    <div>
      <h1>Managing Leads</h1>
      <p>
        Leads are the contacts in a campaign batch. This guide covers the CSV format, variable
        injection, lead statuses, bulk operations, and DNC (do-not-call) handling.
      </p>

      <h2 id="csv-format">CSV format</h2>
      <p>
        Upload leads as a CSV file when creating a batch. The minimum required columns are{" "}
        <code>phone</code> and <code>name</code>. All other columns become per-lead variables.
      </p>
      <CodeBlock language="text" code={`phone,name
+919876543210,Priya Sharma
+919123456789,Rahul Verma
+918765432109,Ananya Iyer`} />

      <h3>With custom variables</h3>
      <CodeBlock language="text" code={`phone,name,company,plan,signup_date,preferred_language
+919876543210,Priya Sharma,Acme Corp,enterprise,2026-05-15,Hindi
+919123456789,Rahul Verma,TechStart,starter,2026-06-01,English
+918765432109,Ananya Iyer,DataFlow,growth,2026-06-10,Tamil`} />

      <h3>Phone number format</h3>
      <p>
        All phone numbers must be in <strong>E.164 format</strong> with the country code prefix.
        Numbers without a + prefix or country code will fail to dial.
      </p>
      <div className="my-4 overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs uppercase bg-white/5 text-muted-foreground border-b border-border">
            <tr>
              <th className="px-4 py-3 font-semibold">Format</th>
              <th className="px-4 py-3 font-semibold">Example</th>
              <th className="px-4 py-3 font-semibold">Valid?</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["E.164 (correct)", "+919876543210", "Yes"],
              ["E.164 without +", "919876543210", "No — add the +"],
              ["Local format", "9876543210", "No — add country code"],
              ["With dashes", "+91-9876-543-210", "No — digits only after +"],
            ].map(([f, e, v]) => (
              <tr key={f} className="border-b border-white/5 hover:bg-white/5">
                <td className="px-4 py-3 text-muted-foreground">{f}</td>
                <td className="px-4 py-3 font-mono text-xs text-foreground/80">{e}</td>
                <td className={`px-4 py-3 text-xs font-medium ${v === "Yes" ? "text-emerald-400" : "text-red-400"}`}>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 id="variable-injection">Variable injection in system prompts</h2>
      <p>
        Any column in your CSV (beyond phone and name) is available as a template variable in the
        agent's system prompt using double curly braces:
      </p>
      <CodeBlock language="text" code={`# System prompt
You are calling {{name}} from {{company}}.
They are on the {{plan}} plan, signed up on {{signup_date}}.
Speak to them in {{preferred_language}} if they prefer it.

# What the LLM sees for Priya's call
You are calling Priya Sharma from Acme Corp.
They are on the enterprise plan, signed up on 2026-05-15.
Speak to them in Hindi if they prefer it.`} />

      <h2 id="lead-statuses">Lead statuses</h2>
      <div className="my-6 overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs uppercase bg-white/5 text-muted-foreground border-b border-border">
            <tr>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Description</th>
              <th className="px-4 py-3 font-semibold">Retried?</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["pending", "Queued, not yet dialed", "N/A"],
              ["dialing", "Call is being placed or in progress", "N/A"],
              ["completed", "Call connected and ended normally", "No"],
              ["failed", "Call failed to connect (busy, error)", "Yes, up to max_retries"],
              ["no-answer", "Number rang but was not answered", "Yes, up to max_retries"],
              ["do-not-call", "Opted out — never retried", "Never"],
            ].map(([s, d, r]) => (
              <tr key={s} className="border-b border-white/5 hover:bg-white/5">
                <td className="px-4 py-3 font-mono text-xs">{s}</td>
                <td className="px-4 py-3 text-muted-foreground">{d}</td>
                <td className={`px-4 py-3 text-xs ${r === "Never" ? "text-red-400" : r === "N/A" ? "text-muted-foreground/40" : "text-yellow-400"}`}>{r}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 id="dnc">Do-Not-Call (DNC) handling</h2>
      <p>
        If a caller says they don't want to be called again, your agent should invoke the{" "}
        <code>send_webhook</code> tool to notify your backend, which can then mark the lead via
        the API:
      </p>
      <CodeBlock language="bash" code={`# Mark a lead as do-not-call
curl -X PATCH https://app.snapserve.ai/api/campaigns/<campaignId>/leads/<leadId> \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{ "status": "do-not-call" }'`} />
      <p>
        Leads marked <code>do-not-call</code> are skipped in all future batches of any campaign,
        not just the current one.
      </p>

      <h2 id="retry-config">Retry configuration</h2>
      <p>Configure retries when creating a campaign:</p>
      <CodeBlock language="json" code={`{
  "name": "Q3 Follow-ups",
  "agentId": "ag_abc123",
  "maxRetries": 3,
  "retryDelayMinutes": 60,
  "callWindowStart": "09:00",
  "callWindowEnd": "18:00",
  "timezone": "Asia/Kolkata"
}`} />
      <ul>
        <li><strong>maxRetries</strong> — maximum number of retry attempts per lead (0–10). Default: 2.</li>
        <li><strong>retryDelayMinutes</strong> — minutes to wait between retry attempts. Default: 60.</li>
        <li><strong>callWindowStart / End</strong> — only place calls within this time window in the configured timezone. Leads outside the window are queued and dialed when the window opens.</li>
      </ul>

      <h2 id="bulk-api">Bulk operations via API</h2>
      <CodeBlock language="bash" code={`# Upload a CSV as a new batch
curl -X POST https://app.snapserve.ai/api/campaigns/<id>/batches \\
  -H "Authorization: Bearer <token>" \\
  -F "file=@leads.csv" \\
  -F "name=Batch 1"

# Get batch leads with statuses
curl https://app.snapserve.ai/api/campaigns/<id>/batches/<batchId> \\
  -H "Authorization: Bearer <token>"

# Pause a running batch
curl -X PATCH https://app.snapserve.ai/api/campaigns/<id>/batches/<batchId> \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{ "status": "paused" }'

# Resume a paused batch
curl -X PATCH https://app.snapserve.ai/api/campaigns/<id>/batches/<batchId> \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{ "status": "running" }'`} />
    </div>
  );
}
