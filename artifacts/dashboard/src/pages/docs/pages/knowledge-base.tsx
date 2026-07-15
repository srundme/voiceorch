import { Link } from "wouter";
import { PageHeader } from "../DocsUi";

export default function KnowledgeBasePage() {
  return (
    <div>
      <PageHeader
        breadcrumb="Product guides"
        title="Knowledge base"
        description="Upload documents so the agent can answer product/policy questions from your content during a call."
      />

      <h2 id="dashboard">In the dashboard</h2>
      <ol>
        <li>
          Open{" "}
          <a href="https://app.snapserve.ai/app/knowledge-bases" target="_blank" rel="noreferrer">
            Knowledge bases
          </a>
          .
        </li>
        <li>Create a source and upload files (or paste text).</li>
        <li>Attach the source to one or more agents in the agent builder.</li>
        <li>Test the agent — answers should cite your material when relevant.</li>
      </ol>

      <h2 id="tips">Tips</h2>
      <ul>
        <li>Keep docs short and factual; prefer FAQs and SKUs over huge PDFs.</li>
        <li>Re-upload when policies change — stale docs confuse callers.</li>
        <li>Combine with a clear system prompt: when to search KB vs escalate.</li>
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
