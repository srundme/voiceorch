import { Link } from "wouter";
import { Callout, PageHeader } from "../DocsUi";
import { CodeBlock } from "../CodeBlock";

function RateTable({
  rows,
}: {
  rows: { item: string; price: string; notes?: string }[];
}) {
  return (
    <div className="not-prose my-4 overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full text-sm text-left">
        <thead className="text-[11px] uppercase tracking-wider bg-slate-50 text-muted-foreground border-b border-slate-200">
          <tr>
            <th className="px-4 py-2.5 font-semibold">Item</th>
            <th className="px-4 py-2.5 font-semibold">Price</th>
            <th className="px-4 py-2.5 font-semibold">Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.item} className="border-b border-slate-100 last:border-0">
              <td className="px-4 py-3">{r.item}</td>
              <td className="px-4 py-3 whitespace-nowrap font-medium text-slate-800">{r.price}</td>
              <td className="px-4 py-3 text-muted-foreground">{r.notes ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PricingPage() {
  return (
    <div>
      <PageHeader
        breadcrumb="Reference"
        title="Pricing"
        updated="18 Aug 2026"
        description="Prepaid INR wallet — no monthly SaaS tiers. Card top-up (Razorpay), then usage deducts as voice, WhatsApp, and numbers run. Amounts in *Cents / paise are INR × 100."
        copyText={`Voice: ₹5 / answered minute
Own telephony: ₹1 / min off
WhatsApp (own Vobiz channel): templates ₹0.40–₹1.20 · free-form ₹0.25 · calling ₹1.50 / min
Phone DID: ₹599–₹699 / 30 days + ₹100 setup + 18% GST
Welcome credit: ₹75 (15 free minutes)`}
      />

      <Callout variant="info" title="Live rates">
        Dashboard and API can override WhatsApp message rates in platform settings. Figures below
        are the shipped defaults. Voice is a flat ₹5/min for both managed keys and BYOP.
      </Callout>

      <h2 id="voice">Voice (phone &amp; webcall)</h2>
      <RateTable
        rows={[
          { item: "Welcome credit (new accounts)", price: "₹75 (15 min)", notes: "No GST on the grant" },
          { item: "Orchestration (managed or BYOP LLM/STT/TTS)", price: "₹5.00 / min", notes: "Answered minutes, pro-rata" },
          { item: "Own telephony discount", price: "− ₹1.00 / min", notes: "Your Twilio / Plivo / Vobiz creds + fromNumber" },
          { item: "Partner-managed client", price: "Partner-set", notes: "Partner wallet; client does not pick SnapServe list price" },
        ]}
      />
      <p>
        New accounts get <strong>15 free minutes</strong> (₹75 at ₹5/min). A ₹1,000 top-up: you pay ₹1,180 (18% GST);
        wallet gains ₹1,000 ≈ 200 minutes. Failed / no-pickup legs that never connect are not
        charged as answered minutes.
      </p>

      <h2 id="numbers">Phone numbers</h2>
      <RateTable
        rows={[
          { item: "80-series DID", price: "₹599 / 30 days", notes: "Plus 18% GST on first card purchase" },
          { item: "79-series DID", price: "₹699 / 30 days", notes: "Plus 18% GST on first card purchase" },
          { item: "Other series", price: "₹659 / 30 days", notes: "Plus 18% GST on first card purchase" },
          { item: "Setup (first purchase)", price: "₹100", notes: "Once per number, + GST" },
          { item: "Renewal", price: "Same as rental", notes: "Debited from wallet every 30 days" },
        ]}
      />
      <p>
        High wallet balance (above ₹20,000) can pay the first purchase from wallet instead of a
        fresh card charge. KYC is required before buy.{" "}
        <Link href="/docs/phone-numbers">Phone numbers</Link>.
      </p>

      <h2 id="whatsapp">WhatsApp (own Vobiz channel)</h2>
      <p>
        Billed from the SnapServe wallet only when the channel is <strong>own</strong> (paths 1–3
        on <Link href="/docs/whatsapp">WhatsApp</Link>). Path 4 (Wati / Gupshup webhook) and
        Meta-only BYO BSP sends are <strong>not</strong> billed here — you pay that provider.
        Shared Instant WhatsApp is platform-subsidized and capped, not this rate card.
      </p>
      <RateTable
        rows={[
          { item: "Utility template", price: "₹0.40", notes: "40 paise · Meta-approved UTILITY" },
          { item: "Authentication template", price: "₹0.50", notes: "OTP / AUTHENTICATION" },
          { item: "Default / unknown template", price: "₹0.50", notes: "When category is missing" },
          { item: "Marketing template", price: "₹1.20", notes: "120 paise · MARKETING" },
          { item: "Free-form text or media", price: "₹0.25", notes: "Inside the 24-hour window only" },
          { item: "WhatsApp calling", price: "₹1.50 / min", notes: "Answered WhatsApp voice, not PSTN" },
        ]}
      />
      <p>
        Chatbot replies are free-form sends (₹0.25 each, plus the 30/phone/day cap). After-call
        templates use the template row that matches Meta’s category.
      </p>

      <h2 id="api">Read rates from the API</h2>
      <p>
        Session cookie or <code>sk_live_</code> — same auth as the rest of the API.
      </p>
      <CodeBlock
        language="http"
        code={`GET https://app.snapserve.ai/api/billing/rates
GET https://app.snapserve.ai/api/whatsapp/rates
GET https://app.snapserve.ai/api/wallet`}
      />
      <p>
        <code>/billing/rates</code> returns managed and BYOP voice tiers (both ₹5/min today).{" "}
        <code>/whatsapp/rates</code> returns the live WhatsApp paise card plus defaults. Wallet
        helpers: <Link href="/docs/wallet">Wallet</Link>.
      </p>

      <h2 id="payments">Payments</h2>
      <ul>
        <li>Checkout is <strong>card only</strong> (Razorpay). No UPI in-product.</li>
        <li>Minimum top-up credit: <strong>₹100</strong> + 18% GST on the payable.</li>
        <li>
          Outbound PSTN fails with <code>402</code> when wallet is empty.{" "}
          <Link href="/docs/errors">Errors</Link>.
        </li>
      </ul>
    </div>
  );
}
