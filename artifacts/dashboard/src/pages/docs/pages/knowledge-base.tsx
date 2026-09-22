import { Link } from "wouter";
import { PageHeader } from "../DocsUi";

export default function KnowledgeBasePage() {
  return (
    <div>
      <PageHeader
        breadcrumb="Product guides"
        title="Knowledge base"
        description="Attach packs so the agent answers product and policy questions from your content on live calls — with Smart Knowledge (meaning match, ask-only retrieve, follow-up context)."
      />

      <h2 id="dashboard">In the dashboard</h2>
      <ol>
        <li>
          Open{" "}
          <a href="https://app.snapserve.ai/app/knowledge-bases" target="_blank" rel="noreferrer">
            Knowledge
          </a>
          .
        </li>
        <li>Create a pack (text, FAQ, file, or website).</li>
        <li>Attach it to one or more agents in the agent builder.</li>
        <li>Place a test call — factual questions should pull from your pack; “okay” / “thanks” should not.</li>
      </ol>

      <h2 id="smart">What Smart Knowledge does on a call</h2>
      <ul>
        <li>
          <strong>Meaning + keywords</strong> — hybrid search (semantic and full-text), not keyword-only.
        </li>
        <li>
          <strong>Ask-only retrieve</strong> — skips small talk and farewells; searches when the caller asks a fact.
        </li>
        <li>
          <strong>Follow-up context</strong> — keeps the product/topic so “what about transport?” stays on the right offering.
        </li>
      </ul>

      <h2 id="tips">Tips</h2>
      <ul>
        <li>Keep docs short and factual; prefer FAQs and clear plan names over huge PDFs.</li>
        <li>Re-upload when policies change — stale docs confuse callers.</li>
        <li>Use Test search on a pack to preview what the agent would see.</li>
      </ul>

      <h2 id="api">Via API</h2>
      <p>
        Use{" "}
        <Link href="/docs/api-reference/listKnowledgeSources">Knowledge Base endpoints</Link> to
        list/create/upload sources and{" "}
        <Link href="/docs/api-reference/attachKnowledgeSourceToAgent">attach</Link> them to agents.
      </p>
    </div>
  );
}
