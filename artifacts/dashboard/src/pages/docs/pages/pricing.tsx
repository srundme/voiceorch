import { Link } from "wouter";
import { PageHeader } from "../DocsUi";

export default function PricingPage() {
  return (
    <div>
      <PageHeader
        breadcrumb="Phone & Wallet"
        title="Pricing"
        description="Prepaid INR only — no monthly subscription tiers. Top up a wallet (card) and usage deducts as calls run."
        copyText={`Welcome credit: ₹500
Voice orchestration: ₹5 / minute
Phone number: ₹599–₹699/mo by series + one-time ₹100 setup + 18% GST
Min top-up credit: ₹100`}
      />

      <h2 id="rates">Platform rates</h2>
      <div className="not-prose my-4 overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-sm text-left">
          <thead className="text-[11px] uppercase tracking-wider bg-slate-50 text-muted-foreground border-b border-slate-200">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Item</th>
              <th className="px-4 py-2.5 font-semibold">Price</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["Welcome credit (new accounts)", "₹500 (no GST)"],
              ["Voice orchestration", "₹5 / minute (flat)"],
              ["Wallet top-up", "Chosen credit + 18% GST (card)"],
              ["Phone number monthly rental", "80-series ₹599 · 79-series ₹699 · others ₹659 (+18% GST)"],
              ["Phone number first purchase", "Monthly rental + ₹100 setup + 18% GST (card)"],
              ["Phone number renewal (30 days)", "Same price as purchase, from wallet"],
              ["Minimum top-up credit", "₹100"],
            ].map(([a, b]) => (
              <tr key={a} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-3">{a}</td>
                <td className="px-4 py-3 text-muted-foreground">{b}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 id="math">Minutes math</h2>
      <ul>
        <li>₹500 credit ≈ <strong>100 minutes</strong> at ₹5/min.</li>
        <li>₹1,000 credit + GST: you pay ₹1,180; wallet gains ₹1,000 ≈ 200 minutes.</li>
      </ul>

      <h2 id="api">Read rates from the API</h2>
      <p>
        <code>GET /billing/rates</code> returns per-minute rates in paise. Wallet helpers:{" "}
        <Link href="/docs/wallet">Wallet</Link>.
      </p>

      <h2 id="payments">Payments</h2>
      <p>
        Checkout is <strong>card only</strong> via Razorpay. Top-up and number purchase happen in
        the dashboard; your app reads balance/usage over the API.
      </p>
    </div>
  );
}
