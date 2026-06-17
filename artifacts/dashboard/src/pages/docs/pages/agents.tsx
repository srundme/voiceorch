import { Link } from "wouter";
import { CodeBlock } from "../CodeBlock";

export default function AgentsPage() {
  return (
    <div>
      <h1>Agent Overview</h1>
      <p>
        An agent is the core building block in SnapServe. It defines a complete voice pipeline:
        how speech is transcribed, how the language model reasons, how responses are spoken, and
        which tools the agent can invoke during a conversation.
      </p>

      <h2 id="the-pipeline">The pipeline</h2>
      <p>
        Every call through an agent follows the same data flow:
      </p>
      <div className="my-6 p-5 rounded-xl border border-border bg-white/[0.02] font-mono text-sm">
        <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
          <span className="text-foreground font-semibold">Telephony / WebCall</span>
          <span className="text-muted-foreground/40">→</span>
          <span className="text-foreground font-semibold">ASR</span>
          <span className="text-muted-foreground/40">→</span>
          <span className="text-foreground font-semibold">LLM</span>
          <span className="text-muted-foreground/40">→</span>
          <span className="text-foreground font-semibold">TTS</span>
          <span className="text-muted-foreground/40">→</span>
          <span className="text-foreground font-semibold">Telephony / WebCall</span>
        </div>
        <div className="mt-3 text-xs text-muted-foreground/60">
          Tools and knowledge base are called between LLM and TTS, mid-response.
        </div>
      </div>
      <ul>
        <li>
          <strong>Telephony / WebCall</strong> — audio in and audio out. Inbound calls arrive via
          Twilio, Plivo, or Vonage webhooks. WebCall uses the browser's WebRTC microphone.
        </li>
        <li>
          <strong>ASR (Automatic Speech Recognition)</strong> — converts the caller's audio stream
          to text in real time. Partial transcripts are streamed to the LLM as the caller speaks
          to minimize latency.
        </li>
        <li>
          <strong>LLM (Language Model)</strong> — receives the system prompt, full conversation
          history, retrieved knowledge, and the latest transcript. Streams back a response token
          by token.
        </li>
        <li>
          <strong>Tools</strong> — if the LLM emits a tool call, execution pauses, the tool runs,
          and the result is injected back into context before the response continues.
        </li>
        <li>
          <strong>TTS (Text-to-Speech)</strong> — converts the LLM text stream to audio. The first
          audio chunk is played to the caller as soon as the first sentence is synthesized.
        </li>
      </ul>

      <h2 id="core-settings">Core settings</h2>
      <div className="my-6 overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs uppercase bg-white/5 text-muted-foreground border-b border-border">
            <tr>
              <th className="px-4 py-3 font-semibold">Setting</th>
              <th className="px-4 py-3 font-semibold">Description</th>
              <th className="px-4 py-3 font-semibold">Default</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["Name", "Human-readable label for the agent", "Required"],
              ["System prompt", "LLM instructions. Supports {{variable}} injection.", "Required"],
              ["Language", "Primary call language. Affects TTS voice selection.", "en"],
              ["ASR provider", "Speech-to-text engine", "Required"],
              ["LLM provider", "Language model", "Required"],
              ["TTS provider", "Text-to-speech engine", "Required"],
              ["Voice", "TTS voice ID or name, provider-specific", "Provider default"],
              ["Silence timeout", "Seconds of caller silence before hang-up (0 = never)", "30"],
              ["Max call duration", "Hard cap on call length in seconds (0 = unlimited)", "0"],
              ["Status", "active or inactive. Inactive agents reject inbound calls.", "inactive"],
            ].map(([s, d, def]) => (
              <tr key={s} className="border-b border-white/5 hover:bg-white/5">
                <td className="px-4 py-3 font-medium font-mono text-xs">{s}</td>
                <td className="px-4 py-3 text-muted-foreground">{d}</td>
                <td className="px-4 py-3 text-muted-foreground/60">{def}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 id="variable-injection">Variable injection</h2>
      <p>
        System prompts support <code>{`{{variable_name}}`}</code> placeholders. These are replaced
        at call time with values from:
      </p>
      <ul>
        <li>Campaign lead data (when calling from a campaign)</li>
        <li>Inbound call metadata passed by the telephony provider</li>
        <li>Custom variables passed via the API when creating a call programmatically</li>
      </ul>
      <CodeBlock language="text" code={`You are calling {{lead_name}} at {{company_name}}.
The caller expressed interest in {{product_interest}}.
Always refer to them by their first name.`} />

      <h2 id="agent-status">Agent status</h2>
      <p>
        Agents are either <code>active</code> or <code>inactive</code>.
      </p>
      <ul>
        <li>
          <strong>Active</strong> — the agent accepts inbound calls and can be targeted in outbound
          campaigns and API-initiated calls.
        </li>
        <li>
          <strong>Inactive</strong> — the agent rejects inbound calls with a "not in service" tone.
          Use inactive status during setup and testing.
        </li>
      </ul>
      <p>Toggle status via the switch in the agent list, or via the API:</p>
      <CodeBlock language="bash" code={`curl -X PATCH https://app.snapserve.ai/api/agents/<id>/toggle \\
  -H "Authorization: Bearer <token>"`} />

      <h2 id="knowledge-base">Knowledge base</h2>
      <p>
        Attach knowledge sources to an agent to give it access to documents, FAQs, product
        manuals, or any structured text. During a call, relevant passages are retrieved using
        full-text search and injected into the LLM context automatically.
      </p>
      <p>
        See the <Link href="/docs/knowledge-base" className="text-primary hover:underline">Knowledge Base guide</Link> for
        setup instructions.
      </p>

      <h2 id="tools">Tools</h2>
      <p>
        Tools let the agent take actions mid-call: book appointments, check availability, transfer
        the call, hang up, or call an external webhook.
      </p>
      <p>
        See the <Link href="/docs/tools" className="text-primary hover:underline">Tools & Functions guide</Link> for
        the full tool reference.
      </p>

      <h2 id="versions">Versions</h2>
      <p>
        Every time you save changes to an agent configuration, a version snapshot is created
        automatically. You can review and roll back to any prior version from the agent's
        detail page. Versions capture the full configuration including provider selection,
        system prompt, and tool settings.
      </p>

      <h2 id="calls">Calls and transcripts</h2>
      <p>
        All calls — inbound, outbound, and WebCall — are logged with:
      </p>
      <ul>
        <li>Full turn-by-turn transcript</li>
        <li>Call duration and status (completed, failed, no-answer)</li>
        <li>ASR confidence and detected language</li>
        <li>Tool calls made during the call and their results</li>
        <li>Webhook delivery status</li>
      </ul>
      <p>Transcripts are searchable from the Calls Log page.</p>
    </div>
  );
}
