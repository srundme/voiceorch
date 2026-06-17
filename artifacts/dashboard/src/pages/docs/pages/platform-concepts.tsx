import { Link } from "wouter";

export default function PlatformConceptsPage() {
  return (
    <div>
      <h1>Platform Concepts</h1>
      <p>
        This page explains how SnapServe's orchestration engine works — the lifecycle of a call,
        how the pipeline layers interact, and the data model behind agents, providers, and sessions.
      </p>

      <h2 id="orchestration-model">The orchestration model</h2>
      <p>
        SnapServe is a <em>bring-your-own-provider</em> orchestration layer. You configure which
        ASR, LLM, and TTS services an agent should use, and SnapServe's pipeline handles:
      </p>
      <ul>
        <li>Establishing and maintaining WebSocket connections to your telephony provider</li>
        <li>Streaming audio from the caller to ASR in real time (8 kHz µ-law for Twilio/Plivo/Vonage)</li>
        <li>Forwarding ASR partial and final transcripts to the LLM</li>
        <li>Detecting barge-in (caller speaking while agent talks) and cancelling in-flight TTS</li>
        <li>Executing tool calls when the LLM requests them and resuming the response</li>
        <li>Buffering and streaming TTS audio back to the caller as soon as the first sentence is ready</li>
        <li>Logging the full turn-by-turn transcript and call metadata</li>
      </ul>

      <h2 id="call-lifecycle">Call lifecycle</h2>
      <div className="my-6 space-y-3">
        {[
          { step: "1", title: "Call arrives", desc: "Telephony provider sends a webhook to SnapServe with the call SID and caller number. For WebCall, the browser opens a WebSocket directly." },
          { step: "2", title: "Session init", desc: "SnapServe loads the agent configuration — system prompt, provider keys, tool list, and knowledge base. A session object is created in memory." },
          { step: "3", title: "ASR handshake", desc: "A streaming WebSocket connection is opened to the configured ASR provider. Audio frames from the telephony bridge are forwarded as they arrive." },
          { step: "4", title: "First utterance", desc: "The agent speaks an opening greeting, synthesized by TTS, sent as audio back to the caller." },
          { step: "5", title: "Caller speaks", desc: "Audio is streamed to ASR. Partial transcripts arrive within ~200 ms. The final transcript triggers LLM inference." },
          { step: "6", title: "LLM response", desc: "The system prompt, conversation history, and any retrieved knowledge are sent to the LLM. Tokens stream back and are batched into sentences." },
          { step: "7", title: "Tool calls", desc: "If the LLM emits a tool call (e.g. book_appointment), the tool executes, and the result is injected back into context. The LLM continues generating." },
          { step: "8", title: "TTS synthesis", desc: "Each completed sentence is sent to TTS. Audio chunks are streamed back to the telephony bridge as they arrive — no waiting for the full response." },
          { step: "9", title: "Barge-in detection", desc: "If the ASR receives audio while TTS is playing, playback is interrupted and the new utterance is processed." },
          { step: "10", title: "Session end", desc: "The call ends when the agent calls end_call, the caller hangs up, silence timeout fires, or max duration is reached. Transcript and metadata are persisted." },
        ].map(({ step, title, desc }) => (
          <div key={step} className="flex gap-4 p-4 rounded-xl border border-border bg-white/[0.02]">
            <div className="w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">{step}</div>
            <div>
              <p className="font-semibold text-sm mb-0.5">{title}</p>
              <p className="text-sm text-muted-foreground">{desc}</p>
            </div>
          </div>
        ))}
      </div>

      <h2 id="latency">Latency budget</h2>
      <p>
        End-to-end latency — from the caller finishing a sentence to the first audio of the agent's
        response — breaks down roughly as:
      </p>
      <div className="my-6 overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs uppercase bg-white/5 text-muted-foreground border-b border-border">
            <tr>
              <th className="px-4 py-3 font-semibold">Stage</th>
              <th className="px-4 py-3 font-semibold">Typical latency</th>
              <th className="px-4 py-3 font-semibold">Notes</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["ASR final transcript", "150–300 ms", "Deepgram Nova is fastest"],
              ["LLM first token", "300–600 ms", "Depends on model and prompt length"],
              ["TTS first audio chunk", "100–200 ms", "Cartesia Sonic is lowest latency"],
              ["Network round trip", "30–80 ms", "India ↔ cloud region"],
              ["Total (typical)", "600–1200 ms", "Sub-second on warm sessions with fast providers"],
            ].map(([s, l, n]) => (
              <tr key={s} className="border-b border-white/5 hover:bg-white/5">
                <td className="px-4 py-3 font-medium">{s}</td>
                <td className="px-4 py-3 text-muted-foreground">{l}</td>
                <td className="px-4 py-3 text-muted-foreground/60">{n}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        To minimize latency: choose Deepgram Nova-3 for ASR, a small/fast LLM model (GPT-4o-mini,
        Claude Haiku, or DeepSeek V3), and Cartesia Sonic or Deepgram Aura for TTS.
      </p>

      <h2 id="data-model">Data model</h2>
      <p>The core entities and their relationships:</p>
      <div className="my-6 overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs uppercase bg-white/5 text-muted-foreground border-b border-border">
            <tr>
              <th className="px-4 py-3 font-semibold">Entity</th>
              <th className="px-4 py-3 font-semibold">Description</th>
              <th className="px-4 py-3 font-semibold">Belongs to</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["User", "An authenticated Google account. Every resource is scoped to a user.", "—"],
              ["Provider key", "An encrypted API key for ASR, LLM, TTS, or telephony. Multiple per user.", "User"],
              ["Agent", "A complete voice pipeline configuration. Can have many calls.", "User"],
              ["Agent version", "A snapshot of an agent's configuration at a point in time.", "Agent"],
              ["Call", "A single voice session. Contains transcript, duration, and status.", "Agent"],
              ["Knowledge source", "A named collection of text documents attached to an agent.", "Agent"],
              ["Campaign", "A named outbound calling project targeting a lead list.", "User + Agent"],
              ["Batch", "A set of leads dialed in one run. Multiple batches per campaign.", "Campaign"],
              ["Calendar", "A bookable resource with timezone and availability rules.", "User"],
              ["Event type", "A booking template (duration, slug). Multiple per calendar.", "Calendar"],
              ["Booking", "A confirmed appointment with attendee details.", "Event type"],
            ].map(([e, d, b]) => (
              <tr key={e} className="border-b border-white/5 hover:bg-white/5">
                <td className="px-4 py-3 font-medium">{e}</td>
                <td className="px-4 py-3 text-muted-foreground">{d}</td>
                <td className="px-4 py-3 text-muted-foreground/60">{b}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 id="multi-tenancy">Multi-tenancy</h2>
      <p>
        All data is strictly scoped by user. Provider keys, agents, calls, campaigns, calendars, and
        bookings belonging to one user are never accessible to another. Row-level access control is
        enforced at the API layer — every query includes a <code>userId</code> filter derived from
        the authenticated session token.
      </p>

      <h2 id="webhooks">Webhooks and integrations</h2>
      <p>
        SnapServe emits events for call lifecycle and scheduling actions via registered webhook
        endpoints. Use webhooks to push data into your CRM, trigger downstream automations, or sync
        call outcomes with your data warehouse.
      </p>
      <p>
        See <Link href="/docs/webhooks" className="text-primary hover:underline">Webhooks reference</Link> for the
        full event catalog.
      </p>

      <h2 id="key-security">Key security</h2>
      <p>
        Provider API keys are encrypted at rest using AES-256-GCM with a key derived from the
        platform's <code>SESSION_SECRET</code>. Keys are decrypted only in-process at call time
        and are never returned in full via the API. The last four characters are shown in the UI as
        a visual hint.
      </p>
    </div>
  );
}
