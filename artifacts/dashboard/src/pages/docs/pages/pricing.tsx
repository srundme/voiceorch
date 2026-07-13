import { Link } from "wouter";
import { CheckCircle2 } from "lucide-react";

export default function PricingPage() {
  return (
    <div>
      <h1>Pricing & Usage</h1>
      <p>
        SnapServe charges only for orchestration — the glue between your providers. You pay each
        AI provider (ASR, LLM, TTS) and telephony provider directly from your own API keys.
        SnapServe does not mark up or resell provider costs.
      </p>

      <h2 id="orchestration-fee">Orchestration fee</h2>
      <p>
        SnapServe charges a per-minute orchestration fee for every active call session —
        WebCall, inbound, and outbound. The fee covers:
      </p>
      <ul>
        <li>Real-time audio bridging and pipeline management</li>
        <li>ASR streaming orchestration</li>
        <li>LLM request routing and tool execution</li>
        <li>TTS synthesis and playback buffering</li>
        <li>Transcript logging, analytics, and storage</li>
        <li>Webhook delivery and retry logic</li>
      </ul>

      <h2 id="plans">Plans</h2>
      <div className="my-8 grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          {
            name: "Starter",
            price: "$49",
            period: "/month",
            minutes: "500 minutes included",
            agents: "Up to 5 agents",
            features: ["Email support", "Calls log + transcripts", "WebCall for testing", "Basic analytics", "2 webhook endpoints"],
          },
          {
            name: "Growth",
            price: "$149",
            period: "/month",
            minutes: "2,000 minutes included",
            agents: "Unlimited agents",
            highlight: true,
            features: ["Priority support", "Google Calendar sync", "Outbound campaigns", "Full analytics", "Unlimited webhooks", "Knowledge base"],
          },
          {
            name: "Enterprise",
            price: "Custom",
            period: "",
            minutes: "Unlimited minutes",
            agents: "Unlimited agents",
            features: ["Dedicated CSM", "SLA guarantees", "SSO / SAML", "Dedicated infra", "Custom integrations", "Volume discounts"],
          },
        ].map(plan => (
          <div key={plan.name} className={`rounded-xl border p-6 ${plan.highlight ? "border-primary/40 bg-primary/5" : "border-border bg-white/[0.02]"}`}>
            {plan.highlight && <div className="text-xs font-semibold text-primary uppercase tracking-wider mb-3">Most popular</div>}
            <p className="font-semibold text-lg mb-1">{plan.name}</p>
            <div className="flex items-baseline gap-1 mb-4">
              <span className="text-3xl font-bold">{plan.price}</span>
              <span className="text-muted-foreground text-sm">{plan.period}</span>
            </div>
            <p className="text-sm text-muted-foreground mb-1">{plan.minutes}</p>
            <p className="text-sm text-muted-foreground mb-5">{plan.agents}</p>
            <ul className="space-y-2">
              {plan.features.map(f => (
                <li key={f} className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <h2 id="overage">Overage</h2>
      <p>
        Minutes used beyond your plan's included allocation are billed at the overage rate:
      </p>
      <div className="my-6 overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs uppercase bg-white/5 text-muted-foreground border-b border-border">
            <tr>
              <th className="px-4 py-3 font-semibold">Plan</th>
              <th className="px-4 py-3 font-semibold">Included minutes</th>
              <th className="px-4 py-3 font-semibold">Overage rate</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["Starter", "500 min/month", "$0.12 / min"],
              ["Growth", "2,000 min/month", "$0.09 / min"],
              ["Enterprise", "Unlimited", "Negotiated"],
            ].map(([p, m, r]) => (
              <tr key={p} className="border-b border-white/5 hover:bg-white/5">
                <td className="px-4 py-3 font-medium">{p}</td>
                <td className="px-4 py-3 text-muted-foreground">{m}</td>
                <td className="px-4 py-3 font-mono text-xs text-foreground/80">{r}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 id="wallet">Wallet</h2>
      <p>
        Your SnapServe wallet holds prepaid credit. Orchestration fees are deducted from the wallet
        in real time as calls run. New accounts receive a $5 welcome credit on first sign-in.
      </p>
      <p>Top up your wallet from the <strong>Wallet</strong> page in the sidebar, or via the API:</p>
      <div className="my-4 p-4 rounded-xl border border-border bg-white/[0.02] text-sm text-muted-foreground">
        Wallet balance is charged for the orchestration fee only. Provider API costs (Deepgram,
        OpenAI, ElevenLabs, Twilio, etc.) are billed directly to your accounts with those providers
        — SnapServe has no visibility into those charges.
      </div>

      <h2 id="provider-costs">Estimating total call cost</h2>
      <p>
        A typical 5-minute support call in English (Deepgram Nova-3 + GPT-4o-mini + ElevenLabs)
        costs approximately:
      </p>
      <div className="my-6 overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs uppercase bg-white/5 text-muted-foreground border-b border-border">
            <tr>
              <th className="px-4 py-3 font-semibold">Component</th>
              <th className="px-4 py-3 font-semibold">Provider</th>
              <th className="px-4 py-3 font-semibold">Est. cost per 5-min call</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["ASR", "Deepgram Nova-3", "~$0.022"],
              ["LLM", "OpenAI GPT-4o-mini", "~$0.002"],
              ["TTS", "ElevenLabs Starter", "~$0.011"],
              ["Telephony (inbound)", "Twilio India", "~$0.020"],
              ["Orchestration", "SnapServe (Growth plan)", "~$0.008"],
              ["Total", "—", "~$0.063 / call"],
            ].map(([c, p, e]) => (
              <tr key={c} className={`border-b border-white/5 hover:bg-white/5 ${c === "Total" ? "font-semibold" : ""}`}>
                <td className="px-4 py-3">{c}</td>
                <td className="px-4 py-3 text-muted-foreground">{p}</td>
                <td className="px-4 py-3 font-mono text-xs text-foreground/80">{e}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground/60">
        Costs are estimates only. Actual costs depend on call duration, model usage, and provider
        pricing at the time of the call. Always check current provider pricing pages for accurate rates.
      </p>

      <h2 id="monitoring-usage">Monitoring usage</h2>
      <p>Track your usage from:</p>
      <ul>
        <li><strong>Dashboard</strong> — total calls today, weekly call volume chart</li>
        <li><strong>Wallet page</strong> — balance, top-up history, and per-day credit deductions</li>
        <li><strong>Analytics page</strong> — per-agent call volume, duration, and success rates</li>
        <li><strong>API</strong> — <code>GET /api/analytics</code> returns aggregate usage metrics</li>
      </ul>

      <h2 id="faq">Billing FAQ</h2>
      <dl className="space-y-4 mt-4">
        {[
          ["Is there a free tier?", "New accounts receive $5 welcome credit. This covers approximately 40–60 minutes of orchestrated calls depending on which providers you use."],
          ["When am I charged?", "Orchestration fees are deducted in real time from your wallet as calls run. There are no monthly invoices — you pay as you go from your prepaid balance."],
          ["What happens if my wallet runs out?", "New calls will be rejected until you top up. Active calls in progress will complete normally before the restriction applies."],
          ["Can I get a refund on unused wallet credit?", "Wallet credit is non-refundable. Choose your top-up amount carefully."],
          ["Do provider costs appear in SnapServe?", "No. Provider costs (Deepgram, OpenAI, ElevenLabs, Twilio, etc.) are billed directly to your accounts with those providers. SnapServe only charges the orchestration fee."],
        ].map(([q, a]) => (
          <div key={q}>
            <dt className="font-semibold text-sm mb-1">{q}</dt>
            <dd className="text-sm text-muted-foreground">{a}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
