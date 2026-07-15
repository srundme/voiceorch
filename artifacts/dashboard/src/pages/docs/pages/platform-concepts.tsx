import { Link } from "wouter";
import { PageHeader } from "../DocsUi";

export default function PlatformConceptsPage() {
  return (
    <div>
      <PageHeader
        breadcrumb="Get started"
        title="Platform concepts"
        description="The vocabulary you need before building agents or calling the API."
      />

      <h2 id="agent">Agent</h2>
      <p>
        A voice persona: system prompt, language, ASR/LLM/TTS (or BYOP), tools, optional knowledge
        base, phone number, and variables. Configure in{" "}
        <a href="https://app.snapserve.ai/app/agents" target="_blank" rel="noreferrer">
          Agents
        </a>
        . Toggle <strong>active</strong> before production calls.
      </p>

      <h2 id="call">Call</h2>
      <p>
        One phone conversation. SnapServe stores status, duration, cost (paise), transcript,
        summary, evaluation, and disposition. Retrieve with{" "}
        <Link href="/docs/api-reference/getCall">GET /calls/{"{id}"}</Link> or listen on webhooks.
      </p>

      <h2 id="phone">Phone number</h2>
      <p>
        Caller ID outbound and DID inbound. India numbers need KYC. Purchase is card checkout
        (₹800 + GST). <Link href="/docs/phone-numbers">Phone numbers guide</Link>.
      </p>

      <h2 id="wallet">Wallet</h2>
      <p>
        Prepaid INR balance. Usage deducts at <strong>₹5 / minute</strong>. Top up by card in the
        dashboard. <Link href="/docs/wallet">Wallet</Link>.
      </p>

      <h2 id="variables">Variables</h2>
      <p>
        Placeholders like <code>{"{{customer_name}}"}</code> in the prompt, filled per call from
        your API or campaign lead data. <Link href="/docs/variables">Variables</Link>.
      </p>

      <h2 id="tools">Tools</h2>
      <p>
        Functions the agent can call mid-conversation (book slot, transfer, HTTP webhook).
        Configured in the agent builder Tools tab.
      </p>

      <h2 id="knowledge">Knowledge base</h2>
      <p>
        Documents the agent can search during a call (RAG).{" "}
        <Link href="/docs/knowledge-base">Knowledge base</Link>.
      </p>

      <h2 id="webhooks">Webhooks</h2>
      <p>
        HTTPS callbacks to your app when calls start, complete, or fail.{" "}
        <Link href="/docs/webhooks">Webhooks</Link>.
      </p>

      <h2 id="api-key">API key</h2>
      <p>
        <code>sk_live_…</code> for server-to-server REST. Create under{" "}
        <a href="https://app.snapserve.ai/app/api-keys" target="_blank" rel="noreferrer">
          API Keys
        </a>
        . <Link href="/docs/authentication">Authentication</Link>.
      </p>
    </div>
  );
}
