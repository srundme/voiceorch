import { Link } from "wouter";
import { Callout, PageHeader } from "../DocsUi";

export default function CampaignsPage() {
  return (
    <div>
      <PageHeader
        breadcrumb="Calls & campaigns"
        title="Campaigns"
        updated="18 Aug 2026"
        description="Dashboard auto-dialer for PSTN. Upload or stream leads, pace concurrent calls from your wallet, retry no-answers, and push hot dispositions to CRM — not a WhatsApp blast."
      />

      <Callout variant="info">
        Building your own product? Prefer{" "}
        <Link href="/docs/quick-start">POST /calls/outbound</Link> plus your CRM. Campaigns are for
        in-house sales ops on the SnapServe UI.
      </Callout>

      <h2 id="flow">Typical flow</h2>
      <ol>
        <li>
          Create a campaign, pick an <strong>active</strong> agent and a from-number (assigned DID).
        </li>
        <li>Choose a lead source and map columns to agent <Link href="/docs/variables">variables</Link>.</li>
        <li>
          Set concurrency (max <strong>10</strong>), calling hours, retries, and optional AMD
          (voicemail detection on the agent).
        </li>
        <li>Start / activate. SnapServe paces dials while wallet balance lasts.</li>
        <li>
          Watch the batch: connected, no-pickup, DNC, callbacks. Transfer matching dispositions to
          webhook or Sheets.
        </li>
      </ol>

      <h2 id="sources">Lead sources</h2>
      <div className="not-prose my-4 overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-sm text-left">
          <thead className="text-[11px] uppercase tracking-wider bg-slate-50 text-muted-foreground border-b border-slate-200">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Source</th>
              <th className="px-4 py-2.5 font-semibold">Mode</th>
              <th className="px-4 py-2.5 font-semibold">How leads arrive</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["CSV upload", "Batch", "One file → one or more batches. Map phone, name, email, extras."],
              ["Google Sheets", "Batch / auto", "Connect under Connections, then dial from rows."],
              ["Website form", "Continuous", "Form intake POST → new lead → dial when the campaign is active."],
              ["Meta Lead Ads", "Continuous", "Facebook / Instagram leads into the campaign."],
              ["CRM (e.g. Zoho)", "Continuous", "CRM-driven intake when connected."],
            ].map(([a, b, c]) => (
              <tr key={a} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-3 font-medium">{a}</td>
                <td className="px-4 py-3 text-muted-foreground">{b}</td>
                <td className="px-4 py-3 text-muted-foreground">{c}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        Wire Sheets, website, and Meta under <Link href="/docs/connections">Connections</Link> first.
        Continuous sources keep accepting leads while the campaign is active; CSV is a finite batch.
      </p>

      <h2 id="pacing">Pacing, hours, retries</h2>
      <ul>
        <li>
          <strong>Concurrent calls</strong> — platform ceiling <code>10</code> per campaign.
        </li>
        <li>
          <strong>Calling hours</strong> — optional window + timezone. TRAI-enabled agents also
          block quiet hours at dial time. <Link href="/docs/compliance">Compliance</Link>.
        </li>
        <li>
          <strong>Retries</strong> — <code>maxAttempts</code> (default 1) and{" "}
          <code>retryDelayMinutes</code> (default 60) for no-answer / busy. DNC and completed
          conversations are not redialed.
        </li>
        <li>
          <strong>Delay between dials</strong> — <code>callDelaySeconds</code> spaces the queue.
        </li>
        <li>
          <strong>AMD</strong> — voicemail detection is an <em>agent</em> setting, used on every
          campaign dial for that agent.
        </li>
      </ul>

      <h2 id="ownership">What campaigns own vs the agent</h2>
      <ul>
        <li>
          <strong>Campaign:</strong> lead list, queue, retries, hours, concurrency,{" "}
          <strong>lead transfer</strong> (webhook and/or Google Sheet when disposition matches).
        </li>
        <li>
          <strong>Agent:</strong> prompt, voice, tools, outcomes taxonomy,{" "}
          <strong>after-call WhatsApp / email</strong>, IRDAI/TRAI flags.{" "}
          <Link href="/docs/agents">Agents</Link>.
        </li>
      </ul>
      <Callout variant="warn" title="Not a WhatsApp campaign">
        Campaigns dial <strong>PSTN</strong> only. WhatsApp templates and the chatbot are not a bulk
        campaign product. After-call WhatsApp is configured on the agent Outcomes tab after{" "}
        <Link href="/docs/whatsapp">WhatsApp</Link> is connected.
      </Callout>

      <h2 id="caller-memory">Caller memory on the next dial</h2>
      <p>
        After a request changes (refund, shipment, reschedule), write the new status onto the lead
        so the agent answers follow-ups from current ground truth — not last week’s transcript.
        Use the lead <strong>Memory</strong> tab (or Overview). Notes also sync automatically.
        Guide: <Link href="/docs/caller-memory">Caller memory updates</Link>.
      </p>

      <h2 id="transfer">Lead transfer</h2>
      <p>
        Configuration tab: when the AI disposition matches (for example Interested), POST the lead
        to your CRM URL and/or append a Sheets row. That is ops handoff — not a customer message.
        Do not confuse it with <Link href="/docs/webhooks">event subscriptions</Link> (every call)
        or form intake (website → SnapServe).
      </p>

      <h2 id="review">Review</h2>
      <p>
        Open the campaign → batch for live queue, recordings, and disposition slices. Create a
        redial batch from no-pickup. Export CSV from the campaigns list. Call-level transcript lives
        in <Link href="/docs/outbound-calls">Calls &amp; history</Link>.
      </p>

      <h2 id="api">API note</h2>
      <p>
        Campaign REST exists for the dashboard but is <strong>not</strong> in the public API
        Reference. Automate one-off or CRM-triggered dials with{" "}
        <Link href="/docs/api-reference/initiateOutboundCall">POST /calls/outbound</Link>.
        Personalization for those calls is your backend’s job unless you use campaign field
        mappings.
      </p>
    </div>
  );
}
