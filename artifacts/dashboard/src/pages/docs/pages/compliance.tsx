import { Link } from "wouter";
import { Callout, PageHeader } from "../DocsUi";

export default function CompliancePage() {
  return (
    <div>
      <PageHeader
        breadcrumb="Account & compliance"
        title="Compliance"
        updated="18 Aug 2026"
        description="India-first outbound: TRAI DND, IRDAI disclosure for insurance, DPDP-aware data collection, and WhatsApp Business rules. This is product behaviour — not legal advice."
      />

      <Callout variant="warn">
        You are responsible for consent, DND, and industry licences. SnapServe injects platform
        disclosures where configured; it does not replace your compliance program.
      </Callout>

      <h2 id="trai">TRAI / DND (outbound phone)</h2>
      <p>
        Outbound campaigns should respect Do Not Call lists and calling hours. Honour opt-out
        language on the call (the agent must stop and mark DNC). Campaign retries skip DNC
        dispositions. See <Link href="/docs/campaigns">Campaigns</Link>.
      </p>

      <h2 id="irdai">IRDAI (insurance voice)</h2>
      <p>
        When IRDAI checks are enabled on an agent, the saved system prompt is checked against
        disclosure guidelines. Outbound can be blocked until the prompt includes required
        disclosures (the agent is AI, who it represents, and so on). Turn this on in the agent
        builder when you sell or service insurance.
      </p>

      <h2 id="dpdp">DPDP / personal data</h2>
      <p>
        Collect only what the call needs. Do not ask WhatsApp or voice agents to capture full PAN,
        Aadhaar, or card numbers in chat. Publish a privacy policy. Webhook payloads include phone
        numbers and transcripts — treat them as personal data on your side.
      </p>

      <h2 id="whatsapp">WhatsApp Business</h2>
      <ul>
        <li>Contact people who opted in; honour STOP / unsubscribe.</li>
        <li>Free-form text only inside the 24-hour customer-service window.</li>
        <li>First message to a new contact must be a Meta-approved template.</li>
        <li>
          Use the chatbot as <em>that business’s</em> support or sales agent — not a general-purpose
          ChatGPT. <Link href="/docs/whatsapp">WhatsApp guide</Link>.
        </li>
        <li>Meta requires a human escalation path (phone, email, or in-chat handoff) on the profile.</li>
      </ul>

      <h2 id="recordings">Recordings &amp; transcripts</h2>
      <p>
        Calls may be recorded and transcribed for quality and dispositions. Tell callers when the
        law or your policy requires it. Access is limited to the workspace that owns the call.
      </p>
    </div>
  );
}
