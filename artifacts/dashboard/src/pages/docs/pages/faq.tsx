import type { ReactNode } from "react";
import { Link } from "wouter";
import { PageHeader } from "../DocsUi";

const FAQS: { q: string; a: ReactNode }[] = [
  {
    q: "What is the app URL and API base URL?",
    a: (
      <>
        App: <code>https://app.snapserve.ai</code>. Docs:{" "}
        <code>https://app.snapserve.ai/docs</code>. REST API:{" "}
        <code>https://app.snapserve.ai/api</code> with{" "}
        <code>Authorization: Bearer sk_live_…</code>.{" "}
        <code>api.snapserve.ai</code> and <code>docs.snapserve.ai</code> are not
        SnapServe hosts — they 404. Guide:{" "}
        <Link href="/docs/authentication">Authentication</Link>.
      </>
    ),
  },
  {
    q: "Where is support on the dashboard?",
    a: (
      <>
        In-app Jarvis is off while we rebuild it. Use{" "}
        <Link href="/docs/vibe">Vibe</Link> or the <Link href="/docs/agents">Agents builder</Link>.
      </>
    ),
  },
  {
    q: "Where do I start a first agent?",
    a: (
      <>
        Direct SnapServe: <Link href="/docs/vibe">Vibe</Link> (Chat → Agent → Connect → Test).
        Partner-managed workspaces use the classic <Link href="/docs/agents">Agents builder</Link>.
      </>
    ),
  },
  {
    q: "I assigned a call number — why isn’t WhatsApp working?",
    a: (
      <>
        A voice DID is not WhatsApp until you connect it on Connections → WhatsApp. If the
        number is already on Meta, paste WABA ID, Phone Number ID, and a System User token
        — you do not need a Vobiz channel just to send templates. Personal WhatsApp cannot
        share that number. Guide: <Link href="/docs/whatsapp">WhatsApp</Link>.
      </>
    ),
  },
  {
    q: "Will Meta block the WhatsApp chatbot?",
    a: (
      <>
        Not for a business answering its own customers on the official API. Meta blocks
        general-purpose ChatGPT-style bots and spam (blocks/reports). Stay inside the 24-hour
        window, use templates to start new threads, honour STOP.{" "}
        <Link href="/docs/whatsapp">WhatsApp</Link> · <Link href="/docs/compliance">Compliance</Link>.
      </>
    ),
  },
  {
    q: "Do I create the Vobiz channel in the Vobiz console?",
    a: (
      <>
        Usually no. If the number is already on Meta Cloud API, SnapServe talks to Meta
        only — skip Vobiz. Vobiz is used when SnapServe sells you the WhatsApp number or
        you turn on WhatsApp calling. <Link href="/docs/whatsapp">WhatsApp</Link>.
      </>
    ),
  },
  {
    q: "I pressed Start capture in Meta OTP but the code never appears",
    a: (
      <>
        Click <strong>Start capture</strong> and wait for <strong>listening…</strong>, then
        in Meta choose <strong>Voice call</strong> — not SMS (a SnapServe DID cannot
        receive SMS). The spoken 6-digit code shows on that page after Meta rings the
        number. The OTP call will not appear in Call History — capture answers it
        instead of your agent. If a player appears, listen and type the digits into Meta.
        If the number is already verified on your WABA, skip OTP and paste Phone Number ID + token on
        Connections. <Link href="/docs/whatsapp">WhatsApp</Link>.
      </>
    ),
  },
  {
    q: "Can I pass {{customer_name}} on POST /calls/outbound?",
    a: (
      <>
        No. That endpoint only accepts <code>agentId</code> and <code>toNumber</code>. Map columns
        in a <Link href="/docs/campaigns">campaign</Link>, or put stable copy in the prompt.{" "}
        <Link href="/docs/quick-start">Quick Start</Link>.
      </>
    ),
  },
  {
    q: "Why did my outbound call fail with 401?",
    a: (
      <>
        Missing or wrong key, or the request went to the wrong host. Use{" "}
        <code>https://app.snapserve.ai/api</code> with{" "}
        <code>Authorization: Bearer sk_live_…</code> from{" "}
        <Link href="/docs/authentication">Authentication</Link>. Session JWTs are for the
        browser dashboard only. <code>api.snapserve.ai</code> is not the API (it 404s).
      </>
    ),
  },
  {
    q: "Agent is draft — can I still call?",
    a: (
      <>
        The API may still dial draft agents, but for production toggle the agent to{" "}
        <strong>active</strong> in the builder so behavior is intentional and published.
      </>
    ),
  },
  {
    q: "Where are transcript and summary?",
    a: (
      <>
        On the call record: <Link href="/docs/api-reference/getCall">GET /calls/{"{id}"}</Link>{" "}
        fields <code>transcript</code>, <code>callSummary</code>, <code>successEvaluation</code>,{" "}
        <code>dispositionResult</code>. Also delivered on <code>call.completed</code> webhooks when
        configured.
      </>
    ),
  },
  {
    q: "How do I connect Google Calendar?",
    a: (
      <>
        Dashboard → Connections → Bookings calendar → connect Google → link that calendar on the
        agent’s booking tools. Full steps: <Link href="/docs/calendar">Bookings calendar</Link>.
        To <em>join</em> Meet/Zoom/Teams as a bot, use Meeting bots (
        <Link href="/docs/meetings">Meetings guide</Link>), not Bookings calendar.
      </>
    ),
  },
  {
    q: "How do variables work?",
    a: (
      <>
        Define names on the agent, use <code>{"{{name}}"}</code> in the prompt, map values from
        campaigns or your app. Guide: <Link href="/docs/variables">Variables</Link>.
      </>
    ),
  },
  {
    q: "How long until a purchased number can receive calls?",
    a: (
      <>
        It shows in the dashboard immediately after payment. The carrier can still treat it as a
        wrong number for <strong>5–30 minutes</strong> (rarely up to an hour) while routing
        updates. Assign it to the agent and dial <code>+91…</code>. If it is still unreachable,
        re-assign the number on Phone Numbers so inbound routing is linked again.
      </>
    ),
  },
  {
    q: "Why don’t teammates see the number I bought?",
    a: (
      <>
        They should — the workspace now lists the owner&apos;s numbers on shared agents. Teammates
        must not buy a second number. If they still see a purchase prompt, refresh or re-open the
        agent. See <Link href="/docs/team">Team workspace</Link>.
      </>
    ),
  },
  {
    q: "Why can’t I buy a phone number?",
    a: (
      <>
        Complete <strong>KYC</strong>, pay by <strong>card</strong> (₹599–₹699/mo by series + ₹100 setup + 18% GST), and have wallet
        funds for renewals. See <Link href="/docs/phone-numbers">Phone numbers</Link>.
      </>
    ),
  },
  {
    q: "What does costCents mean?",
    a: (
      <>
        Paise (INR × 100). Example: <code>700</code> = ₹7.00. Platform rate is ₹5/min.{" "}
        <Link href="/docs/pricing">Pricing</Link>.
      </>
    ),
  },
  {
    q: "UPI for top-up?",
    a: <>Not offered — card checkout via Razorpay only.</>,
  },
  {
    q: "How do I verify webhooks?",
    a: (
      <>
        HMAC of <code>{"{timestamp}.{rawBody}"}</code> vs <code>X-SnapServe-Signature</code>.{" "}
        <Link href="/docs/webhooks">Event subscriptions</Link>.
      </>
    ),
  },
  {
    q: "Can I use SnapServe from Claude?",
    a: (
      <>
        Yes — install the SnapServe Claude skill + MCP with your <code>sk_live_…</code> key. Guide:{" "}
        <Link href="/docs/claude-skill">Claude skill &amp; MCP</Link>.
      </>
    ),
  },
];

export default function FaqPage() {
  return (
    <div>
      <PageHeader
        breadcrumb="Reference"
        title="FAQ"
        description="Short answers to the issues builders hit most often."
      />
      {FAQS.map((item, i) => (
        <div key={i} className="mb-8">
          <h2 id={`q-${i}`}>{item.q}</h2>
          <p>{item.a}</p>
        </div>
      ))}
    </div>
  );
}
