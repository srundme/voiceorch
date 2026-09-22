import { Link } from "wouter";
import { PageHeader } from "../DocsUi";

export default function KnowledgeBasePage() {
  return (
    <div>
      <PageHeader
        breadcrumb="Product guides"
        title="Contextual Knowledge"
        description="Attach packs so the agent answers product and policy questions from your content on live calls — at the right moment, and still on topic for follow-ups."
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
        <li>
          Place a test call — factual questions should use your pack; “okay” / “thanks” should not trigger a lookup.
        </li>
      </ol>

      <h2 id="contextual">What Contextual Knowledge does on a call</h2>
      <ul>
        <li>
          <strong>Right facts</strong> — finds answers in your packs even when the caller doesn’t use the exact wording.
        </li>
        <li>
          <strong>Right moment</strong> — looks up only when the caller asks something real, not on small talk.
        </li>
        <li>
          <strong>Right thread</strong> — stays on the same product or topic for follow-ups like “what about transport?”
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
