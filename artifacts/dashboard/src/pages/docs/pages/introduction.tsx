import { Link } from "wouter";

export default function IntroductionPage() {
  return (
    <div>
      <h1>SnapServe Developer Platform</h1>
      <p>
        SnapServe is an AI voice orchestration API. Build your own product — CRM dialer,
        support bot, appointment booker — and let SnapServe run the live phone conversation.
        You authenticate with an API key, create or reuse agents, place outbound (or receive
        inbound) calls, and get results over webhooks.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 my-8">
        {[
          { title: "Authentication", desc: "Create a sk_live_ key and call the API", href: "/docs/authentication" },
          { title: "Quick Start", desc: "List agents and place your first outbound call", href: "/docs/quick-start" },
          { title: "Outbound Calls", desc: "Create, poll, end, and disposition calls", href: "/docs/outbound-calls" },
          { title: "Webhooks", desc: "Receive call.completed and more in your app", href: "/docs/webhooks" },
          { title: "SDKs", desc: "Official Node.js and Python clients", href: "/docs/sdks" },
          { title: "API Reference", desc: "Full OpenAPI explorer with schemas", href: "/docs/api-reference" },
        ].map(card => (
          <Link
            key={card.href}
            href={card.href}
            className="block p-5 rounded-xl border border-border bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/20 transition-all group"
          >
            <p className="font-semibold text-foreground group-hover:text-primary transition-colors mb-1">{card.title}</p>
            <p className="text-sm text-muted-foreground">{card.desc}</p>
          </Link>
        ))}
      </div>

      <h2 id="base-url">Base URL</h2>
      <p>
        All REST requests go to:
      </p>
      <pre className="rounded-lg border border-border bg-[#0B0D12]/50 p-4 text-sm font-mono my-4">https://app.snapserve.ai/api</pre>
      <p>
        Authenticate every request with <code>Authorization: Bearer sk_live_…</code>.
        See <Link href="/docs/authentication">Authentication</Link>.
      </p>

      <h2 id="what-you-can-build">What you can build</h2>
      <ul>
        <li>
          <strong>Your own dialer UI</strong> — store leads in your database, call{" "}
          <code>POST /calls/outbound</code>, show live status from webhooks.
        </li>
        <li>
          <strong>Backend automations</strong> — trigger a voice call when a form fills,
          a ticket ages, or a CRM stage changes.
        </li>
        <li>
          <strong>Inbound assistants</strong> — buy or bring a number, assign it to an agent,
          handle callbacks in your app.
        </li>
      </ul>

      <h2 id="billing-in-brief">Billing in brief</h2>
      <p>
        Accounts are prepaid in <strong>INR</strong>. New accounts get <strong>₹500</strong> welcome
        credit. Platform fee is flat <strong>₹5 / minute</strong>. Wallet top-ups are charged by
        card (18% GST on top). Details: <Link href="/docs/pricing">Pricing</Link> and{" "}
        <Link href="/docs/wallet">Wallet</Link>.
      </p>

      <h2 id="not-in-these-docs">What these docs are not</h2>
      <p>
        This site is for <strong>API developers</strong>. Agent prompts, voice tuning, and the
        in-dashboard builder are product UX — configure those in the SnapServe app, then drive
        the agent from your application via the API.
      </p>
    </div>
  );
}
