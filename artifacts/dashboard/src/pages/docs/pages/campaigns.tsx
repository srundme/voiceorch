import { CodeBlock } from "../CodeBlock";
import { Link } from "wouter";

export default function CampaignsPage() {
  return (
    <div>
      <h1>Campaigns</h1>
      <p>
        Campaigns let you run outbound voice calls at scale. Upload a lead list, configure your
        dial logic, and SnapServe queues and places calls automatically — tracking outcomes for
        every lead.
      </p>

      <h2 id="concepts">Key concepts</h2>
      <div className="my-6 overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs uppercase bg-white/5 text-muted-foreground border-b border-border">
            <tr>
              <th className="px-4 py-3 font-semibold">Concept</th>
              <th className="px-4 py-3 font-semibold">Description</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["Campaign", "A named outbound calling project with a linked agent and dial configuration."],
              ["Batch", "A set of leads dialed in a single run. A campaign can have multiple batches — useful for staggered rollouts."],
              ["Lead", "A single contact to call, with phone number, name, and optional custom variables."],
              ["Retry config", "How many times and how soon to retry failed or no-answer leads."],
              ["Variables", "Per-lead key-value data injected into the agent's system prompt via {{variable}} placeholders."],
            ].map(([c, d]) => (
              <tr key={c} className="border-b border-white/5 hover:bg-white/5">
                <td className="px-4 py-3 font-medium whitespace-nowrap">{c}</td>
                <td className="px-4 py-3 text-muted-foreground">{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 id="creating-a-campaign">Creating a campaign</h2>
      <ol>
        <li>Open <strong>Campaigns</strong> in the sidebar and click <strong>New Campaign</strong>.</li>
        <li>Give the campaign a name (e.g. "Q3 Demo Follow-ups").</li>
        <li>Select the agent that will handle calls. The agent must be active and have a telephony provider configured.</li>
        <li>Configure dial settings:
          <ul>
            <li><strong>Caller ID</strong> — the phone number to dial from (must be provisioned in your telephony provider).</li>
            <li><strong>Max retries</strong> — how many times to retry failed or no-answer calls.</li>
            <li><strong>Retry delay</strong> — minutes to wait between retry attempts.</li>
            <li><strong>Call window</strong> — time-of-day range to place calls (respects the lead's timezone if provided).</li>
          </ul>
        </li>
        <li>Click <strong>Create Campaign</strong>.</li>
      </ol>

      <h2 id="adding-leads">Adding leads</h2>
      <p>
        Leads are added per batch. After creating a campaign, click <strong>New Batch</strong> and
        upload a CSV file. The required columns are:
      </p>
      <CodeBlock language="text" code={`phone,name
+919876543210,Priya Sharma
+919123456789,Rahul Verma`} />
      <p>
        Any additional columns become per-lead variables available for injection into the agent's
        system prompt:
      </p>
      <CodeBlock language="text" code={`phone,name,company,product_interest
+919876543210,Priya Sharma,Acme Corp,enterprise
+919123456789,Rahul Verma,TechStart,starter`} />
      <p>
        In the agent's system prompt, reference these as:
      </p>
      <CodeBlock language="text" code={`You are calling {{name}} from {{company}}.
They expressed interest in the {{product_interest}} plan.`} />

      <h2 id="lead-lifecycle">Lead lifecycle</h2>
      <p>Each lead moves through the following states:</p>
      <div className="my-6 p-5 rounded-xl border border-border bg-white/[0.02] font-mono text-sm">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span className="px-2 py-1 rounded bg-white/5 text-foreground">pending</span>
          <span>→</span>
          <span className="px-2 py-1 rounded bg-white/5 text-foreground">dialing</span>
          <span>→</span>
          <span className="px-2 py-1 rounded bg-emerald-500/10 text-emerald-400">completed</span>
          <span className="text-muted-foreground/40">or</span>
          <span className="px-2 py-1 rounded bg-red-500/10 text-red-400">failed</span>
          <span className="text-muted-foreground/40">or</span>
          <span className="px-2 py-1 rounded bg-yellow-500/10 text-yellow-400">no-answer</span>
        </div>
        <div className="mt-3 text-xs text-muted-foreground/60">
          failed and no-answer leads are retried based on your retry config.
        </div>
      </div>
      <div className="my-6 overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs uppercase bg-white/5 text-muted-foreground border-b border-border">
            <tr>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Meaning</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["pending", "Queued, not yet dialed"],
              ["dialing", "Call is currently being placed or in progress"],
              ["completed", "Call connected and ended normally (agent completed its objective)"],
              ["failed", "Call failed to connect (busy, invalid number, carrier error)"],
              ["no-answer", "Number rang but was not answered within the timeout"],
              ["do-not-call", "Lead opted out during a previous call — will never be retried"],
            ].map(([s, d]) => (
              <tr key={s} className="border-b border-white/5 hover:bg-white/5">
                <td className="px-4 py-3 font-mono text-xs">{s}</td>
                <td className="px-4 py-3 text-muted-foreground">{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 id="batch-controls">Batch controls</h2>
      <p>You can pause, resume, or cancel a batch at any time from the campaign detail page. When paused:</p>
      <ul>
        <li>Calls already in progress finish normally.</li>
        <li>No new calls are initiated until you resume.</li>
        <li>The batch state is preserved — pending leads remain queued.</li>
      </ul>

      <h2 id="analytics">Analytics</h2>
      <p>Campaign analytics show:</p>
      <ul>
        <li><strong>Connection rate</strong> — percentage of leads that answered</li>
        <li><strong>Completion rate</strong> — percentage of connected calls that reached the agent's objective</li>
        <li><strong>Average call duration</strong> — seconds per connected call</li>
        <li><strong>Outcome breakdown</strong> — pie chart of completed / failed / no-answer / pending</li>
        <li><strong>Per-lead call log</strong> — link to the full transcript for each call</li>
      </ul>

      <h2 id="api">API</h2>
      <CodeBlock language="text" code={`GET    /api/campaigns                          List campaigns
POST   /api/campaigns                          Create campaign
GET    /api/campaigns/:id                      Get campaign details
PATCH  /api/campaigns/:id                      Update campaign
DELETE /api/campaigns/:id                      Delete campaign

GET    /api/campaigns/:id/batches              List batches
POST   /api/campaigns/:id/batches              Create batch (upload leads)
GET    /api/campaigns/:id/batches/:batchId     Get batch
PATCH  /api/campaigns/:id/batches/:batchId     Update batch (pause/resume/cancel)`} />

      <p>
        See the <Link href="/docs/managing-leads" className="text-primary hover:underline">Managing Leads guide</Link> for
        CSV format details and bulk operations.
      </p>
    </div>
  );
}
