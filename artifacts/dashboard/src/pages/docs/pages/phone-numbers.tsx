import { CodeBlock } from "../CodeBlock";
import { Link } from "wouter";

export default function PhoneNumbersPage() {
  return (
    <div>
      <h1>Phone Numbers</h1>
      <p>
        Phone numbers provide the caller ID for outbound calls and the DID for inbound agents.
        Buy SnapServe-managed Indian numbers in the dashboard (card payment), then assign them
        to agents via API.
      </p>

      <h2 id="pricing">Purchase pricing (India)</h2>
      <ul>
        <li>Base fee <strong>₹800</strong> + <strong>18% GST</strong> → pay <strong>₹944</strong> by card.</li>
        <li>Renews every 30 days at ₹800 + GST from your wallet.</li>
        <li>Indian numbers require completed <strong>KYC</strong> in the dashboard before purchase.</li>
      </ul>

      <h2 id="list">List your numbers</h2>
      <CodeBlock
        language="bash"
        code={`curl https://app.snapserve.ai/api/phone-numbers \\
  -H "Authorization: Bearer $SNAPSERVE_API_KEY"`}
      />

      <h2 id="assign">Assign to an agent</h2>
      <CodeBlock
        language="bash"
        code={`curl -X PATCH https://app.snapserve.ai/api/phone-numbers/789/assign \\
  -H "Authorization: Bearer $SNAPSERVE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "agentId": 123 }'`}
      />
      <p>
        After assign, outbound calls for that agent use the number as from-number (when the
        telephony path supports it).
      </p>

      <h2 id="purchase">Purchase via API</h2>
      <p>
        Inventory search and Razorpay checkout are available as{" "}
        <code>GET /phone-numbers/available</code>,{" "}
        <code>POST /phone-numbers/purchase/initiate</code>, and{" "}
        <code>POST /phone-numbers/purchase/confirm</code>. Most product apps still run purchase
        in the SnapServe UI (card checkout + KYC), then automate assign / routing via API.
      </p>

      <h2 id="release">Release</h2>
      <CodeBlock
        language="bash"
        code={`curl -X DELETE https://app.snapserve.ai/api/phone-numbers/789 \\
  -H "Authorization: Bearer $SNAPSERVE_API_KEY"`}
      />

      <p>
        Call placement: <Link href="/docs/outbound-calls">Outbound Calls</Link>.
      </p>
    </div>
  );
}
