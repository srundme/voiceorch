import { CodeBlock } from "../CodeBlock";
import { Link } from "wouter";

export default function WalletDocsPage() {
  return (
    <div>
      <h1>Wallet</h1>
      <p>
        Usage is prepaid. Your app should check balance before bursting outbound volume, and
        surface low-balance states to operators. Money is stored as <strong>paise</strong>{" "}
        (1 INR = 100 paise) in fields named <code>*Cents</code> for historical reasons.
      </p>

      <h2 id="get">Get balance</h2>
      <CodeBlock
        language="bash"
        code={`curl https://app.snapserve.ai/api/wallet \\
  -H "Authorization: Bearer $SNAPSERVE_API_KEY"`}
      />
      <CodeBlock
        language="json"
        code={`{
  "balanceCents": 50000,
  "balanceInr": 500,
  "currency": "INR",
  "freeCreditsGranted": true
}`}
      />
      <p>
        <code>50000</code> paise = <strong>₹500.00</strong>. At ₹5/min that is about 100 minutes.
      </p>

      <h2 id="transactions">Transactions</h2>
      <CodeBlock
        language="bash"
        code={`curl "https://app.snapserve.ai/api/wallet/transactions?limit=50" \\
  -H "Authorization: Bearer $SNAPSERVE_API_KEY"`}
      />

      <h2 id="topup">Top-ups</h2>
      <p>
        Users add funds in the SnapServe dashboard with <strong>card</strong> checkout (Razorpay).
        Payable amount = wallet credit + <strong>18% GST</strong>. Your integration typically does
        not implement checkout — only reads balance and usage.
      </p>

      <h2 id="rates">Call rates</h2>
      <ul>
        <li>Platform fee: flat <strong>₹5 / minute</strong> (managed and BYOP).</li>
        <li>
          Rates endpoint: <code>GET /billing/rates</code> (
          <Link href="/docs/pricing">Pricing</Link>).
        </li>
      </ul>

      <h2 id="402">Insufficient funds</h2>
      <p>
        Outbound dials may fail when the wallet cannot cover the call. Detect{" "}
        <code>402</code> / error messages and prompt the account owner to top up. See{" "}
        <Link href="/docs/errors">Errors</Link>.
      </p>
    </div>
  );
}
