import { Link } from "wouter";
import { Callout, Endpoint, PageHeader } from "../DocsUi";
import { CodeBlock } from "../CodeBlock";

export default function PhoneNumbersPage() {
  return (
    <div>
      <PageHeader
        breadcrumb="Phone & Wallet"
        title="Phone Numbers"
        description="Caller ID for outbound and DID for inbound. Buy Indian numbers in the dashboard (card), then assign via API."
        copyText={`GET   https://app.snapserve.ai/api/phone-numbers
PATCH https://app.snapserve.ai/api/phone-numbers/{id}/assign
DELETE https://app.snapserve.ai/api/phone-numbers/{id}`}
      />

      <Callout variant="info" title="India pricing">
        Monthly rental by series: <strong>80-series ₹599</strong>, <strong>79-series ₹699</strong>,
        <strong> others ₹659</strong> — plus a one-time ₹100 setup and 18% GST by card on first purchase.
        Renews every 30 days at the monthly rental + GST. KYC required before purchase.
      </Callout>

      <Endpoint
        id="list"
        method="get"
        path="/phone-numbers"
        title="List your numbers"
        opId="listPhoneNumbers"
      >
        <CodeBlock
          language="bash"
          code={`curl https://app.snapserve.ai/api/phone-numbers \\
  -H "Authorization: Bearer $SNAPSERVE_API_KEY"`}
        />
      </Endpoint>

      <Endpoint
        id="assign"
        method="patch"
        path="/phone-numbers/{id}/assign"
        title="Assign to agent"
        opId="assignPhoneNumber"
      >
        <CodeBlock
          language="bash"
          code={`curl -X PATCH https://app.snapserve.ai/api/phone-numbers/789/assign \\
  -H "Authorization: Bearer $SNAPSERVE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "agentId": 123 }'`}
        />
      </Endpoint>

      <h2 id="purchase">Purchase via API</h2>
      <p>
        <code>GET /phone-numbers/available</code>,{" "}
        <code>POST /phone-numbers/purchase/initiate</code>,{" "}
        <code>POST /phone-numbers/purchase/confirm</code>. Most apps still run purchase in the UI
        (card + KYC), then automate assign via API.
      </p>

      <Endpoint
        id="release"
        method="delete"
        path="/phone-numbers/{id}"
        title="Release number"
        opId="releasePhoneNumber"
      >
        <CodeBlock
          language="bash"
          code={`curl -X DELETE https://app.snapserve.ai/api/phone-numbers/789 \\
  -H "Authorization: Bearer $SNAPSERVE_API_KEY"`}
        />
      </Endpoint>

      <p>
        Next: <Link href="/docs/outbound-calls">Outbound Calls</Link>.
      </p>
    </div>
  );
}
