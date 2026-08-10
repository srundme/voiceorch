import type { ReactNode } from "react";
import { Link } from "wouter";
import { PageHeader } from "../DocsUi";

const FAQS: { q: string; a: ReactNode }[] = [
  {
    q: "Why did my outbound call fail with 401?",
    a: (
      <>
        Missing or wrong key. Use <code>Authorization: Bearer sk_live_…</code> from{" "}
        <Link href="/docs/authentication">Authentication</Link>. Session JWTs are for the browser
        dashboard only.
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
