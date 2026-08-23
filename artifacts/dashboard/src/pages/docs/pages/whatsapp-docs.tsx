import { Link } from "wouter";
import { Callout, PageHeader } from "../DocsUi";

export default function WhatsAppDocsPage() {
  return (
    <div>
      <PageHeader
        breadcrumb="Connect & channels"
        title="WhatsApp"
        updated="23 Aug 2026"
        description="Meta is enough to send templates. Vobiz is only if SnapServe sells you the number or you want WhatsApp calling."
      />

      <p>
        Open{" "}
        <a href="https://app.snapserve.ai/app/connections?setup=whatsapp" target="_blank" rel="noreferrer">
          Connections → WhatsApp
        </a>
        . If the number is already on Meta Cloud API, paste WABA ID, Phone Number ID, and a
        permanent System User token. SnapServe talks to Meta only — no carrier channel.
      </p>

      <h2 id="paths">Three paths</h2>
      <ol>
        <li>
          <strong>I already have Meta (default)</strong> — number already on your WABA. Paste
          WABA ID, Phone Number ID, and a permanent System User token. Connect saves the
          creds and fetches APPROVED templates. Voice “Send WhatsApp” and after-call
          templates go through Meta Graph. No Vobiz.
        </li>
        <li>
          <strong>Buy a WhatsApp number from SnapServe</strong> — separate inventory from voice
          DIDs. We provision the line through Vobiz. You still paste WABA + token once
          (Meta owns the WABA).
        </li>
        <li>
          <strong>Keep Wati / Gupshup / Zapier</strong> — SnapServe only posts to their webhook
          after a call. No in-app chatbot and no WhatsApp calling.
        </li>
      </ol>

      <Callout variant="info" title="Meta is enough to send">
        You do not need a Vobiz channel to send an approved template from a voice agent.
        Vobiz is only if we sell you the WhatsApp number or you turn on WhatsApp calling.
      </Callout>

      <h2 id="voice-did">Same number as calls</h2>
      <p>
        WhatsApp-enable a SnapServe voice DID still needs Meta IDs (Phone Number ID + token
        + WABA). Assigning the DID to an agent does <em>not</em> turn WhatsApp on. We do not
        create a Vobiz channel on this path unless you later enable WhatsApp calling.
      </p>
      <Callout variant="warn" title="Meta OTP on a SnapServe number">
        Click <strong>Start capture</strong> and wait for <strong>listening…</strong> before
        Meta rings. In Meta choose <strong>Voice call</strong> — SMS will never show on this
        page (the DID is a voice line). The 6-digit code appears after the call. If you
        already verified the number on your WABA, skip OTP and paste Phone Number ID + token.
      </Callout>

      <h2 id="text">Text chatbot</h2>
      <p>
        After an <strong>own Vobiz</strong> channel is live (bought-from-us number, or a
        channel you linked), turn on <strong>AI chatbot replies</strong> and pick the agent.
        A number that already has a Meta text bot cannot also use SnapServe as the inbound
        bot — Meta allows one webhook.
      </p>
      <ul>
        <li>Inbound order: request-a-call → brochure → chatbot.</li>
        <li>
          Free-form replies only inside Meta’s <strong>24-hour</strong> customer-service window
          (after the customer’s last inbound). First outreach to a new contact needs an{" "}
          <strong>approved template</strong>.
        </li>
        <li>
          Caps: about 30 chatbot replies per phone per 24 hours. <code>STOP</code> / unsubscribe
          stays silent.
        </li>
      </ul>

      <h2 id="calling">WhatsApp calling</h2>
      <p>
        Shown only after an own Vobiz channel exists. Enable Calling on the number in{" "}
        <strong>Meta Business Manager</strong> first, then toggle <strong>WhatsApp calling</strong>{" "}
        on the SnapServe WhatsApp page and pick the answering agent. This is 1:1 voice over
        WhatsApp, not a campaign.
      </p>

      <h2 id="campaigns">Not a WhatsApp campaign</h2>
      <p>
        Campaigns dial <strong>PSTN</strong>. WhatsApp is after-call templates, inbound chat, or a
        1:1 WhatsApp voice call. After-call WhatsApp / email rules live on the{" "}
        <strong>agent Outcomes</strong> tab, not on the campaign.
      </p>

      <h2 id="meta">Will Meta block the chatbot?</h2>
      <p>
        Official Business API automation is allowed. Meta’s 2026 rule bans{" "}
        <strong>general-purpose assistants</strong> (ChatGPT as the product on WhatsApp), not a
        clinic or shop answering its own customers. Keep the bot on-business, honour opt-out, and
        keep a human path (phone or email) on the WhatsApp profile. Quality rating still drops if
        people block or report you.
      </p>

      <h2 id="next">Next</h2>
      <p>
        Wire after-call templates on <Link href="/docs/agents">Agents</Link> → Outcomes. For
        email-only follow-up, use Brevo under <Link href="/docs/connections">Connections</Link> —
        Brevo is not WhatsApp.
      </p>
    </div>
  );
}
