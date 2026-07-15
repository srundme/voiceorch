import { Link } from "wouter";
import { BookOpen, Calendar, Code2, PhoneCall, Rocket, Variable } from "lucide-react";
import { Callout, DocCard, PageHeader } from "../DocsUi";
import { CodeBlock } from "../CodeBlock";

export default function IntroductionPage() {
  return (
    <div>
      <PageHeader
        breadcrumb="Get started"
        title="SnapServe Documentation"
        description={
          <>
            SnapServe is an <strong className="text-zinc-200">AI voice agent platform</strong> —
            build agents in the dashboard, connect calendars and tools, then call the REST API from
            your own app.
          </>
        }
      />

      <div className="not-prose grid grid-cols-1 sm:grid-cols-2 gap-3 my-8">
        <DocCard
          href="/docs/what-you-can-build"
          title="What you can build"
          description="Inbound, outbound, booking, and apps on the API"
          icon={<Rocket />}
        />
        <DocCard
          href="/docs/agents"
          title="Agents & builder"
          description="Prompts, voice, tools, publish — dashboard walkthrough"
          icon={<BookOpen />}
        />
        <DocCard
          href="/docs/calendar"
          title="Calendar & booking"
          description="Connect Google Calendar and book on calls"
          icon={<Calendar />}
        />
        <DocCard
          href="/docs/api-reference"
          title="API Reference"
          description="Create agents, place calls, get transcripts"
          icon={<Code2 />}
        />
      </div>

      <Callout variant="info" title="Two tracks">
        <strong>Learn the product</strong> (sidebar → Product guides) for dashboard features.{" "}
        <strong>Build an integration</strong> with{" "}
        <Link href="/docs/quick-start">Quick Start</Link> and the curated{" "}
        <Link href="/docs/api-reference">API Reference</Link> (campaigns/admin noise removed).
      </Callout>

      <h2 id="base-url">API base URL</h2>
      <CodeBlock language="text" code={`https://app.snapserve.ai/api`} />
      <p>
        Auth: <code>Authorization: Bearer sk_live_…</code> —{" "}
        <Link href="/docs/authentication">Authentication</Link>.
      </p>

      <h2 id="learn-more">Popular guides</h2>
      <ul>
        <li>
          <Link href="/docs/variables">Variables</Link> — <code>{"{{customer_name}}"}</code> in
          prompts
        </li>
        <li>
          <Link href="/docs/outbound-calls">Calls &amp; history</Link> — transcript &amp; summary
        </li>
        <li>
          <Link href="/docs/webhooks">Webhooks</Link> — push results to your backend
        </li>
        <li>
          <Link href="/docs/faq">FAQ</Link>
        </li>
      </ul>

      <div className="not-prose mt-8 flex flex-wrap gap-4 text-sm">
        <Link href="/docs/platform-concepts" className="text-sky-300 hover:text-sky-200">
          Platform concepts →
        </Link>
        <Link href="/docs/variables" className="inline-flex items-center gap-1 text-sky-300 hover:text-sky-200">
          <Variable className="h-4 w-4" /> Variables
        </Link>
        <Link href="/docs/outbound-calls" className="inline-flex items-center gap-1 text-sky-300 hover:text-sky-200">
          <PhoneCall className="h-4 w-4" /> Calls
        </Link>
      </div>
    </div>
  );
}
