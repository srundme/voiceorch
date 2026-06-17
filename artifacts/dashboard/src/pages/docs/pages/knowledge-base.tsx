import { CodeBlock } from "../CodeBlock";

export default function KnowledgeBasePage() {
  return (
    <div>
      <h1>Knowledge Base</h1>
      <p>
        The knowledge base lets you attach reference documents to an agent — product FAQs, pricing
        sheets, troubleshooting guides, or any structured text. During each call turn, relevant
        passages are retrieved and injected into the LLM context automatically.
      </p>

      <h2 id="how-it-works">How it works</h2>
      <ol>
        <li>You create a <strong>knowledge source</strong> and add text entries to it.</li>
        <li>You attach the knowledge source to one or more agents.</li>
        <li>During a call, after the caller's utterance is transcribed, SnapServe runs a full-text search against all entries in the agent's knowledge sources.</li>
        <li>The top matching entries (up to 3) are injected into the LLM context as a <code>system</code> message immediately before the model generates a response.</li>
        <li>The agent can answer based on the retrieved passages without having been pre-trained on the information.</li>
      </ol>

      <h2 id="creating-a-source">Creating a knowledge source</h2>
      <ol>
        <li>Go to <strong>Agents → Knowledge Base</strong> in the sidebar.</li>
        <li>Click <strong>New Knowledge Source</strong> and give it a name (e.g. "Product FAQ", "Pricing Sheet").</li>
        <li>Add entries using the text editor. Each entry is a discrete chunk of text — one Q&A pair, one product feature, one pricing tier.</li>
        <li>Save the source.</li>
        <li>Open an agent, go to the Knowledge Base tab, and attach the source.</li>
      </ol>

      <h2 id="structuring-entries">Structuring entries effectively</h2>
      <p>
        The retrieval system works best when entries are self-contained and specific. One topic per
        entry. Avoid large wall-of-text entries — split them into smaller, focused chunks.
      </p>

      <div className="my-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
          <p className="text-xs font-semibold text-red-400 mb-2 uppercase tracking-wider">Less effective</p>
          <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono">{`SnapServe Plans

SnapServe offers three plans. The Starter plan costs
$49/month and includes 500 minutes, 5 agents, and email
support. The Growth plan costs $149/month and includes
2000 minutes, unlimited agents, priority support, and
Google Calendar sync. The Enterprise plan is custom
pricing and includes unlimited minutes, SLA, SSO,
dedicated infrastructure, and a customer success manager.
API rate limits are 100 req/min on Starter, 500 on
Growth, and unlimited on Enterprise.`}</pre>
        </div>
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
          <p className="text-xs font-semibold text-emerald-400 mb-2 uppercase tracking-wider">More effective</p>
          <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono">{`Entry 1: Starter plan
$49/month. 500 call minutes included.
Up to 5 agents. Email support.
API: 100 requests/minute.

Entry 2: Growth plan
$149/month. 2,000 call minutes included.
Unlimited agents. Priority support.
Google Calendar sync included.
API: 500 requests/minute.

Entry 3: Enterprise plan
Custom pricing. Unlimited minutes.
SLA, SSO, dedicated infra.
Dedicated customer success manager.`}</pre>
        </div>
      </div>

      <h2 id="via-api">Managing via API</h2>
      <CodeBlock language="bash" code={`# Create a knowledge source
curl -X POST https://app.snapserve.ai/api/knowledge-sources \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{ "name": "Product FAQ" }'

# Add an entry
curl -X POST https://app.snapserve.ai/api/knowledge-sources/<sourceId>/entries \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "content": "What is SnapServe? SnapServe is an AI voice agent orchestration platform..."
  }'

# List entries in a source
curl https://app.snapserve.ai/api/knowledge-sources/<sourceId>/entries \\
  -H "Authorization: Bearer <token>"`} />

      <h2 id="retrieval-context">How retrieval context is injected</h2>
      <p>
        Retrieved knowledge is injected as a system message before each LLM call:
      </p>
      <CodeBlock language="text" code={`[System - Retrieved Knowledge]
Entry 1 (score: 0.94):
Growth plan: $149/month. 2,000 call minutes included. Unlimited agents. Priority support.

Entry 2 (score: 0.87):
Starter plan: $49/month. 500 call minutes. Up to 5 agents. Email support.

[Use the above information to answer the caller's question accurately.]`} />
      <p>
        The LLM is not required to use retrieved knowledge — it will only cite it if relevant to
        the current turn. Low-scoring retrievals are filtered out to avoid noisy context.
      </p>

      <h2 id="best-practices">Best practices</h2>
      <ul>
        <li>
          <strong>Keep entries under 200 words.</strong> Shorter, focused entries retrieve more
          accurately than long paragraphs.
        </li>
        <li>
          <strong>Phrase entries as answers, not just facts.</strong> "The Growth plan costs $149/month
          and includes 2,000 minutes" is better than "Growth: $149, 2000 min" because it reads more
          naturally when cited aloud.
        </li>
        <li>
          <strong>Mirror caller language.</strong> If callers ask "what does it cost?" use the word
          "cost" in entries, not "pricing" or "fee". Full-text search is exact and proximity-based.
        </li>
        <li>
          <strong>Update entries when information changes.</strong> Knowledge bases do not
          auto-update. Stale pricing or feature information will be retrieved and cited confidently.
        </li>
        <li>
          <strong>Tell the agent to rely on the knowledge base in your system prompt:</strong>
        </li>
      </ul>
      <CodeBlock language="text" code={`"Answer pricing questions based on the knowledge provided to you. 
If the knowledge base does not contain the answer, say you will follow up — do not guess."`} />
    </div>
  );
}
