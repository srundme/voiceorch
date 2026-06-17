import { CodeBlock } from "../CodeBlock";
import { Link } from "wouter";

function FieldRow({ name, type, required, desc }: { name: string; type: string; required?: boolean; desc: string }) {
  return (
    <tr className="border-b border-white/5 hover:bg-white/5">
      <td className="px-4 py-3">
        <span className="font-mono text-xs text-foreground/80">{name}</span>
        {required && <span className="ml-1.5 text-[10px] text-red-400">required</span>}
      </td>
      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{type}</td>
      <td className="px-4 py-3 text-sm text-muted-foreground">{desc}</td>
    </tr>
  );
}

export default function AgentBuilderPage() {
  return (
    <div>
      <h1>Agent Builder</h1>
      <p>
        The agent builder is where you configure every aspect of a voice agent's pipeline. This page
        covers each field in detail — what it does, accepted values, and how it affects call behavior.
      </p>

      <h2 id="basic-info">Basic information</h2>
      <div className="my-4 overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs uppercase bg-white/5 text-muted-foreground border-b border-border">
            <tr>
              <th className="px-4 py-3">Field</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Description</th>
            </tr>
          </thead>
          <tbody>
            <FieldRow name="name" type="string" required desc="Human-readable label for this agent. Shown in call logs and campaign selection." />
            <FieldRow name="language" type="string" desc="IETF language tag of the primary call language (e.g. en, hi, ta, te, mr). Affects TTS voice selection and ASR language hints. Default: en." />
            <FieldRow name="status" type="active | inactive" desc="Inactive agents reject inbound calls. Activate an agent when it is ready for production." />
          </tbody>
        </table>
      </div>

      <h2 id="system-prompt">System prompt</h2>
      <p>
        The system prompt is the most important field. It defines the agent's persona, objectives,
        and constraints. It is prepended to every LLM request for the life of the call.
      </p>
      <CodeBlock language="text" code={`You are Riya, a friendly customer support agent for SnapServe.
Your job is to help users configure their voice agents and resolve billing issues.

Guidelines:
- Keep responses under 2 sentences. This is a phone call.
- Never use bullet points or markdown — speak naturally.
- If you don't know the answer, say "Let me check on that and call you back."
- Always confirm the caller's name at the start of the call.
- End calls politely when the issue is resolved.`} />
      <p>
        See the <Link href="/docs/prompting-guide" className="text-primary hover:underline">Prompting Guide</Link> for
        a detailed guide to writing effective voice agent prompts.
      </p>

      <h3 id="variable-injection">Variable injection</h3>
      <p>
        Use <code>{`{{variable_name}}`}</code> placeholders in the system prompt. At call time, these
        are replaced with:
      </p>
      <ul>
        <li>Campaign lead fields (name, phone, and any custom CSV columns)</li>
        <li>Metadata passed by the telephony provider on inbound calls</li>
        <li>Custom variables from programmatic call initiation via the API</li>
      </ul>
      <CodeBlock language="text" code={`You are calling {{lead_name}} from {{company_name}}.
They signed up for a demo on {{signup_date}}.
Their current plan is {{current_plan}}.`} />

      <h2 id="asr-tab">ASR — Speech-to-Text</h2>
      <div className="my-4 overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs uppercase bg-white/5 text-muted-foreground border-b border-border">
            <tr>
              <th className="px-4 py-3">Field</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Description</th>
            </tr>
          </thead>
          <tbody>
            <FieldRow name="asrProvider" type="string" required desc="deepgram | azure | whisper" />
            <FieldRow name="asrModel" type="string" desc="Provider-specific model name. Deepgram: nova-2, nova-3. Azure: en-US (locale). Whisper: whisper-1." />
            <FieldRow name="asrLanguage" type="string" desc="Override the ASR language independently from the agent language (e.g. hi-IN for Hindi speech recognition)." />
          </tbody>
        </table>
      </div>
      <p>
        <strong>Deepgram</strong> is recommended for Indian English, Hindi, Tamil, and other Indic
        languages — Nova-3 has the best accuracy. Azure is preferred for enterprise deployments with
        data residency requirements.
      </p>
      <p>
        See <Link href="/docs/asr-providers" className="text-primary hover:underline">ASR Providers</Link> for
        per-provider model listings and configuration notes.
      </p>

      <h2 id="llm-tab">LLM — Language Model</h2>
      <div className="my-4 overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs uppercase bg-white/5 text-muted-foreground border-b border-border">
            <tr>
              <th className="px-4 py-3">Field</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Description</th>
            </tr>
          </thead>
          <tbody>
            <FieldRow name="llmProvider" type="string" required desc="openai | anthropic | deepseek | mistral | cohere" />
            <FieldRow name="llmModel" type="string" desc="Model name. Defaults to the provider's recommended conversational model." />
            <FieldRow name="temperature" type="number" desc="0.0–1.0. Higher = more creative. Default: 0.7. For factual support bots use 0.2–0.4." />
            <FieldRow name="maxTokens" type="number" desc="Maximum tokens in each LLM response. Keep under 150 for voice — long responses feel unnatural. Default: 100." />
          </tbody>
        </table>
      </div>
      <p>
        For latency-sensitive agents, prefer smaller models: <strong>GPT-4o-mini</strong> (OpenAI),
        <strong>Claude Haiku</strong> (Anthropic), or <strong>DeepSeek V3</strong> (DeepSeek). These
        deliver first-token latency under 400 ms which keeps total call latency comfortable.
      </p>
      <p>
        See <Link href="/docs/llm-providers" className="text-primary hover:underline">LLM Providers</Link> for the
        full model list and cost comparison.
      </p>

      <h2 id="tts-tab">TTS — Text-to-Speech</h2>
      <div className="my-4 overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs uppercase bg-white/5 text-muted-foreground border-b border-border">
            <tr>
              <th className="px-4 py-3">Field</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Description</th>
            </tr>
          </thead>
          <tbody>
            <FieldRow name="ttsProvider" type="string" required desc="elevenlabs | cartesia | azure | aws_polly | openai | deepgram" />
            <FieldRow name="ttsVoice" type="string" desc="Voice ID or name. Provider-specific — see the voice picker in the builder for available options." />
            <FieldRow name="ttsSpeed" type="number" desc="Playback speed multiplier. 1.0 = normal. 1.1–1.2 sounds natural and slightly quicker." />
          </tbody>
        </table>
      </div>
      <p>
        Choose a voice that matches the agent's persona and the caller's expected language. ElevenLabs
        has the most natural-sounding voice library. Cartesia Sonic has the lowest synthesis latency.
        Deepgram Aura is a cost-effective option when you already have a Deepgram ASR key.
      </p>
      <p>
        See <Link href="/docs/tts-providers" className="text-primary hover:underline">TTS Providers</Link> for voice
        listings and language support.
      </p>

      <h2 id="telephony-tab">Telephony</h2>
      <div className="my-4 overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs uppercase bg-white/5 text-muted-foreground border-b border-border">
            <tr>
              <th className="px-4 py-3">Field</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Description</th>
            </tr>
          </thead>
          <tbody>
            <FieldRow name="telephonyProvider" type="string" desc="twilio | plivo | vonage. Required for real phone calls; not needed for WebCall." />
            <FieldRow name="callerIdNumber" type="string" desc="Outbound caller ID. Must be a number verified or purchased in your telephony provider dashboard." />
          </tbody>
        </table>
      </div>

      <h2 id="call-settings">Call settings</h2>
      <div className="my-4 overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs uppercase bg-white/5 text-muted-foreground border-b border-border">
            <tr>
              <th className="px-4 py-3">Field</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Description</th>
            </tr>
          </thead>
          <tbody>
            <FieldRow name="silenceTimeout" type="number" desc="Seconds of caller silence before the session ends. 0 = never time out. Default: 30." />
            <FieldRow name="maxCallDuration" type="number" desc="Hard cap on call length in seconds. 0 = unlimited. Recommended: 600 (10 min) for support bots." />
            <FieldRow name="openingGreeting" type="string" desc="Optional fixed opening line spoken by the agent when the call connects, bypassing the LLM for the first turn." />
          </tbody>
        </table>
      </div>

      <h2 id="tools-settings">Tools</h2>
      <p>
        Enable tools to let the agent take actions mid-call. See the{" "}
        <Link href="/docs/tools" className="text-primary hover:underline">Tools & Functions guide</Link> for
        detailed configuration of each tool.
      </p>
      <CodeBlock language="json" code={`// Available tools
[
  "book_appointment",    // Book a slot via the scheduling engine
  "check_availability",  // Fetch available slots for a date
  "end_call",            // Hang up the call
  "transfer_call",       // Transfer to another number
  "send_sms",            // Send an SMS to the caller's number
  "send_webhook",        // Call a custom HTTP endpoint with call context
  "check_calendar"       // Check if a time slot is free on a Google Calendar
]`} />

      <h2 id="knowledge">Knowledge base</h2>
      <p>
        Attach one or more knowledge sources to this agent. During each call turn, the agent's last
        utterance is used to retrieve relevant text chunks via full-text search. Retrieved chunks are
        injected into the LLM context immediately before the response.
      </p>
      <p>
        See the <Link href="/docs/knowledge-base" className="text-primary hover:underline">Knowledge Base guide</Link> for
        how to create and populate knowledge sources.
      </p>
    </div>
  );
}
