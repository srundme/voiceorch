import { Link } from "wouter";
import { Callout, Endpoint, PageHeader } from "../DocsUi";
import { CodeBlock } from "../CodeBlock";

export default function WalletDocsPage() {
  return (
    <div>
      <PageHeader
        breadcrumb="Phone & Wallet"
        title="Wallet"
        description="Prepaid INR balance. Amounts in *Cents fields are paise (1 INR = 100 paise)."
        copyText={`GET https://app.snapserve.ai/api/wallet
GET https://app.snapserve.ai/api/wallet/transactions?limit=50`}
      />

      <Callout variant="info">
        Platform fee is flat <strong>₹5 / minute</strong>. Top-ups are card-only (+18% GST) in the
        dashboard — most apps only read balance.
      </Callout>

      <Endpoint id="get" method="get" path="/wallet" title="Get balance" opId="getWallet">
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
          <code>50000</code> paise = <strong>₹500.00</strong> (~100 minutes at ₹5/min).
        </p>
      </Endpoint>

      <h2 id="transactions">Transactions</h2>
      <CodeBlock
        language="bash"
        code={`curl "https://app.snapserve.ai/api/wallet/transactions?limit=50" \\
  -H "Authorization: Bearer $SNAPSERVE_API_KEY"`}
      />

      <h2 id="topup">Top-ups</h2>
      <p>
        Operators add funds in the SnapServe dashboard with <strong>card</strong> checkout
        (Razorpay). Payable = wallet credit + <strong>18% GST</strong>.
      </p>

      <h2 id="402">Insufficient funds</h2>
      <p>
        Outbound dials may fail with <code>402</code> when balance is too low. Prompt the account
        owner to top up. See <Link href="/docs/errors">Errors</Link>.
      </p>
    </div>
  );
}
