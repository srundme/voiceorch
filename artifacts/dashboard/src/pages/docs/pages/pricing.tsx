import { Link } from "wouter";

export default function PricingPage() {
  return (
    <div>
      <h1>Pricing</h1>
      <p>
        SnapServe is <strong>prepaid INR</strong>. There are no monthly subscription tiers.
        You top up a wallet (card) and usage deducts as calls run.
      </p>

      <h2 id="rates">Platform rates</h2>
      <div className="my-4 overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs uppercase bg-white/5 text-muted-foreground border-b border-border">
            <tr>
              <th className="px-4 py-3 font-semibold">Item</th>
              <th className="px-4 py-3 font-semibold">Price</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["Welcome credit (new accounts)", "₹500 (no GST)"],
              ["Voice orchestration", "₹5 / minute (flat)"],
              ["Wallet top-up", "Chosen credit + 18% GST (card)"],
              ["Phone number (first month)", "₹800 + 18% GST = ₹944 (card)"],
              ["Phone number renewal (30 days)", "₹800 + GST from wallet"],
              ["Minimum top-up credit", "₹100"],
            ].map(([a, b]) => (
              <tr key={a} className="border-b border-white/5 hover:bg-white/5">
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
        Checkout is <strong>card only</strong> via Razorpay (UPI/QR are not offered). Top-up and
        number purchase happen in the SnapServe dashboard; your app reads balance/usage over the API.
      </p>
    </div>
  );
}
