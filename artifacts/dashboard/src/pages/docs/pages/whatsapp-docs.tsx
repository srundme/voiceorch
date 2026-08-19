import { Link } from "wouter";
import { Callout, PageHeader } from "../DocsUi";

export default function WhatsAppDocsPage() {
  return (
    <div>
      <PageHeader
        breadcrumb="Connect & channels"
        title="WhatsApp"
        updated="18 Aug 2026"
        description="Business WhatsApp for after-call templates, inbound text chatbot, and optional WhatsApp calling. Personal WhatsApp cannot share the number."
      />

      <p>
        Open{" "}
        <a href="https://app.snapserve.ai/app/connections?setup=whatsapp" target="_blank" rel="noreferrer">
          Connections → WhatsApp
        </a>
        . Pick <strong>one</strong> path. Meta holds the WABA; a BSP (Vobiz, Wati, Gupshup…) is who
        sends. You do not connect Meta and a BSP as two separate products.
      </p>

      <h2 id="paths">Four paths</h2>
      <ol>
        <li>
          <strong>Existing Business WhatsApp</strong> — number already on Meta Cloud API or a BSP
          that created a WABA. Paste WABA ID, Phone Number ID, and a permanent System User token.
        </li>
        <li>
          <strong>Same number as calls</strong> — WhatsApp-enable a SnapServe voice DID. Assigning
          the DID to an agent does <em>not</em> turn WhatsApp on by itself.
        </li>
        <li>
          <strong>Buy a new WhatsApp DID</strong> — separate inventory from voice numbers. SnapServe
          creates the Vobiz channel; you still need Meta WABA + token once.
        </li>
        <li>
          <strong>Keep Wati / Gupshup / Zapier</strong> — SnapServe only posts to their webhook after
          a call. No in-app chatbot and no WhatsApp calling.
        </li>
      </ol>

      <Callout variant="info" title="You do not need the Vobiz console">
        For paths 1–3 SnapServe creates the Vobiz channel when you finish the wizard. Paste an
        existing Vobiz channel ID only if you already created one there.
      </Callout>

      <h2 id="text">Text chatbot</h2>
      <p>
        After an <strong>own</strong> channel is live, turn on <strong>AI chatbot replies</strong>{" "}
        and pick the agent. Customers text the Business WhatsApp number; the agent answers in-thread
        with the same persona and knowledge as on calls (written, not spoken).
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
        On an own Vobiz channel only (paths 1–3). Enable Calling on the number in{" "}
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
