import { Link } from "wouter";
import {
  BookOpen,
  Code2,
  MessageCircle,
  Plug,
  Rocket,
  Sparkles,
} from "lucide-react";
import { Callout, DocCard, PageHeader } from "../DocsUi";
import { CodeBlock } from "../CodeBlock";

export default function IntroductionPage() {
  return (
    <div>
      <PageHeader
        breadcrumb="Get started"
        title="SnapServe documentation"
        updated="23 Aug 2026"
        description="Build Indic-first AI voice agents for phone, WhatsApp, webcall, and meetings. Configure in the dashboard, then drive calls from your own product with the REST API."
      />

      <p>
        SnapServe runs the live conversation (speech in, LLM, speech out, tools). You own the UI,
        leads, CRM, and business logic. These docs cover the dashboard product and the public API
        on <code>https://app.snapserve.ai/api</code>.
      </p>

      <Callout variant="warn" title="Use these hosts — nothing else">
        App: <code>https://app.snapserve.ai</code>. Docs: <code>https://app.snapserve.ai/docs</code>.
        API: <code>https://app.snapserve.ai/api</code>. There is no{" "}
        <code>api.snapserve.ai</code> or <code>docs.snapserve.ai</code> — those hostnames 404.
      </Callout>

      <h2 id="start">Start here</h2>
      <div className="not-prose grid grid-cols-1 sm:grid-cols-2 gap-3 my-6">
        <DocCard
          href="/docs/vibe"
          title="Create an agent in Vibe"
          description="Chat, edit, connect, and test on one page"
          icon={<Sparkles />}
        />
        <DocCard
          href="/docs/what-you-can-build"
          title="What you can build"
          description="Inbound, outbound, WhatsApp, meetings, campaigns"
          icon={<Rocket />}
        />
        <DocCard
          href="/docs/connections"
          title="Connections"
          description="WhatsApp, email, calendar, forms, and ads"
          icon={<Plug />}
        />
        <DocCard
          href="/docs/whatsapp"
          title="WhatsApp"
          description="Text chatbot, templates, and WhatsApp calling"
          icon={<MessageCircle />}
        />
        <DocCard
          href="/docs/quick-start"
          title="Quick Start (API)"
          description="Bearer sk_live_… and your first outbound call"
          icon={<Code2 />}
        />
        <DocCard
          href="/docs/api-reference"
          title="API Reference"
          description="Agents, calls, transcripts, phones, wallet"
          icon={<BookOpen />}
        />
      </div>

      <Callout variant="info" title="Two tracks">
        <strong>Learn the product</strong> in the sidebar (Vibe, agents, WhatsApp, campaigns).{" "}
        <strong>Integrate</strong> with <Link href="/docs/quick-start">Quick Start</Link> and the{" "}
        <Link href="/docs/api-reference">API Reference</Link>. Dashboard login uses a session
        cookie; servers use API keys — do not mix them.
      </Callout>

      <h2 id="how-a-call-works">How a call works</h2>
      <ol>
        <li>Caller speaks → STT (Sarvam, Deepgram, …)</li>
        <li>LLM decides what to say and which tools to run</li>
        <li>TTS speaks (Cartesia, Sarvam Bulbul, …)</li>
        <li>Telephony (Vobiz / Twilio / Plivo), webcall, or a meeting bot plays audio</li>
      </ol>
      <p>
        Full building blocks: <Link href="/docs/platform-concepts">Platform concepts</Link>.
      </p>

      <h2 id="base-url">API base URL</h2>
      <CodeBlock language="text" code={`https://app.snapserve.ai/api`} />
      <p>
        Auth: <code>Authorization: Bearer sk_live_…</code> —{" "}
        <Link href="/docs/authentication">Authentication</Link>.
      </p>

      <h2 id="guides">Popular guides</h2>
      <ul>
        <li>
          <Link href="/docs/vibe">Vibe builder</Link> — recommended first agent
        </li>
        <li>
          <Link href="/docs/whatsapp">WhatsApp</Link> — chatbot vs calling vs templates
        </li>
        <li>
          <Link href="/docs/calendar">Bookings calendar</Link> — Google Calendar on the call
        </li>
        <li>
          <Link href="/docs/outbound-calls">Calls &amp; history</Link> — transcript and summary
        </li>
        <li>
          <Link href="/docs/webhooks">Event subscriptions</Link> — push results to your backend
        </li>
        <li>
          <Link href="/docs/compliance">Compliance</Link> — TRAI, IRDAI, WhatsApp Business
        </li>
        <li>
          <Link href="/docs/faq">FAQ</Link>
        </li>
      </ul>

      <p className="not-prose mt-8 text-sm text-slate-500">
        Something missing? Email{" "}
        <a className="text-slate-900 underline underline-offset-2 hover:text-slate-700" href="mailto:support@snapserve.ai">
          support@snapserve.ai
        </a>
        .
      </p>
    </div>
  );
}
