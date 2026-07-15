import { Link } from "wouter";
import { BookOpen, Code2, PhoneCall, Rocket, Webhook } from "lucide-react";
import { Callout, DocCard, PageHeader } from "../DocsUi";
import { CodeBlock } from "../CodeBlock";

const COPY = `SnapServe Developer Platform

Base URL: https://app.snapserve.ai/api
Auth: Authorization: Bearer sk_live_YOUR_KEY

Build dialers, automations, and inbound assistants on the SnapServe voice API.`;

export default function IntroductionPage() {
  return (
    <div>
      <PageHeader
        breadcrumb="Overview"
        title="SnapServe Documentation"
        description={
          <>
            Build apps that <strong className="text-zinc-200">place AI voice calls</strong>, handle
            webhooks, and manage agents — with copy-paste REST examples and official SDKs.
          </>
        }
        copyText={COPY}
      />

      <div className="not-prose grid grid-cols-1 sm:grid-cols-2 gap-3 my-8">
        <DocCard
          href="/docs/authentication"
          title="Authentication"
          description="Create a sk_live_ key and authorize every request"
          icon={<BookOpen />}
        />
        <DocCard
          href="/docs/quick-start"
          title="Quick Start"
          description="List agents and place your first outbound call"
          icon={<Rocket />}
        />
        <DocCard
          href="/docs/outbound-calls"
          title="Outbound Calls"
          description="Create, poll, end, disposition, and transfer"
          icon={<PhoneCall />}
        />
        <DocCard
          href="/docs/api-reference"
          title="API Reference"
          description="Full OpenAPI explorer with schemas & examples"
          icon={<Code2 />}
        />
      </div>

      <Callout variant="warn" title="You need an account">
        Sign up at{" "}
        <a href="https://app.snapserve.ai" target="_blank" rel="noreferrer">
          app.snapserve.ai
        </a>
        , create an agent in the dashboard, then generate an API key under{" "}
        <a href="https://app.snapserve.ai/app/api-keys" target="_blank" rel="noreferrer">
          API Keys
        </a>
        . New accounts get ₹500 welcome credit.
      </Callout>

      <h2 id="base-url">Base URL</h2>
      <p>All REST requests use:</p>
      <CodeBlock language="text" code={`https://app.snapserve.ai/api`} />
      <p>
        Authenticate with <code>Authorization: Bearer sk_live_…</code>. See{" "}
        <Link href="/docs/authentication">Authentication</Link>.
      </p>

      <h2 id="what-you-can-build">What you can build</h2>
      <ul>
        <li>
          <strong>Your own dialer</strong> — store leads in your DB, call{" "}
          <code>POST /calls/outbound</code>, show status from webhooks.
        </li>
        <li>
          <strong>Backend automations</strong> — trigger a voice call when a form fills or a CRM
          stage changes.
        </li>
        <li>
          <strong>Inbound assistants</strong> — assign a number to an agent and handle results in
          your app.
        </li>
      </ul>

      <h2 id="core-flow">Core flow</h2>
      <ol>
        <li>
          Authenticate with <code>sk_live_</code>.
        </li>
        <li>
          Pick an active <Link href="/docs/agents">agent</Link>.
        </li>
        <li>
          <Link href="/docs/outbound-calls">Start an outbound call</Link>.
        </li>
        <li>
          Receive <Link href="/docs/webhooks">call.completed</Link> on your HTTPS endpoint.
        </li>
      </ol>

      <h2 id="billing">Billing in brief</h2>
      <p>
        Prepaid <strong>INR</strong>. Welcome credit <strong>₹500</strong>. Platform fee{" "}
        <strong>₹5 / minute</strong>. Phone purchase <strong>₹800 + 18% GST</strong> (card). Details:{" "}
        <Link href="/docs/pricing">Pricing</Link> · <Link href="/docs/wallet">Wallet</Link>.
      </p>

      <div className="not-prose mt-10 flex flex-wrap gap-4 text-sm">
        <Link href="/docs/webhooks" className="inline-flex items-center gap-1.5 text-sky-300 hover:text-sky-200">
          <Webhook className="h-4 w-4" /> Webhooks guide
        </Link>
        <Link href="/docs/sdks" className="inline-flex items-center gap-1.5 text-sky-300 hover:text-sky-200">
          <Code2 className="h-4 w-4" /> Node & Python SDKs
        </Link>
      </div>
    </div>
  );
}
