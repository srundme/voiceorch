import { CodeBlock } from "../CodeBlock";

function ToolCard({ name, desc, params, example }: { name: string; desc: string; params: { name: string; type: string; required?: boolean; desc: string }[]; example: string }) {
  return (
    <div className="mt-8 rounded-xl border border-border bg-white/[0.02] overflow-hidden">
      <div className="px-5 py-4 border-b border-border bg-white/[0.02]">
        <p className="font-mono text-sm font-semibold text-foreground">{name}</p>
        <p className="text-sm text-muted-foreground mt-1">{desc}</p>
      </div>
      <div className="px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 mb-3">Parameters</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground/60 border-b border-white/5">
              <tr>
                <th className="pb-2 pr-4 text-left font-medium">Name</th>
                <th className="pb-2 pr-4 text-left font-medium">Type</th>
                <th className="pb-2 text-left font-medium">Description</th>
              </tr>
            </thead>
            <tbody>
              {params.map(p => (
                <tr key={p.name} className="border-b border-white/5 last:border-0">
                  <td className="py-2 pr-4 font-mono text-xs text-foreground/80">
                    {p.name}
                    {p.required && <span className="ml-1 text-[10px] text-red-400">*</span>}
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">{p.type}</td>
                  <td className="py-2 text-xs text-muted-foreground">{p.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/60 mb-2 mt-4">Example</p>
        <pre className="text-xs font-mono text-muted-foreground bg-black/20 rounded-lg p-3 overflow-x-auto">{example}</pre>
      </div>
    </div>
  );
}

export default function ToolsPage() {
  return (
    <div>
      <h1>Tools & Functions</h1>
      <p>
        Tools let your agent take actions mid-call. The LLM decides when to invoke a tool based on
        the conversation context and your system prompt instructions. After a tool executes, its
        result is injected back into the LLM context so the agent can continue the conversation
        naturally.
      </p>

      <h2 id="how-tools-work">How tools work</h2>
      <ol>
        <li>You enable one or more tools in the agent builder.</li>
        <li>The LLM generates a response and optionally includes a tool call (following the OpenAI function-calling format).</li>
        <li>SnapServe intercepts the tool call, executes it server-side, and returns the result.</li>
        <li>The result is appended to the conversation as a tool message.</li>
        <li>The LLM continues generating, incorporating the tool result.</li>
      </ol>
      <p>
        Tool calls happen within a single conversational turn — the caller does not experience a
        noticeable pause for fast tools (schedule lookups, webhooks). For tools involving external
        APIs, add a bridging phrase to your system prompt:
      </p>
      <CodeBlock language="text" code={`"When checking availability, say 'Let me check that for you' before calling the tool.
This gives the caller something to listen to while the lookup runs."`} />

      <h2 id="available-tools">Available tools</h2>

      <ToolCard
        name="check_availability"
        desc="Fetches available booking slots for a specific event type and date. Returns a list of open time slots in the calendar's configured timezone."
        params={[
          { name: "eventTypeSlug", type: "string", required: true, desc: "The slug of the event type to check (e.g. 'demo', 'support-call')." },
          { name: "date", type: "string (YYYY-MM-DD)", required: true, desc: "The date to check availability for." },
          { name: "timezone", type: "string", desc: "IANA timezone of the caller. Defaults to the calendar's timezone." },
        ]}
        example={`// LLM tool call
{
  "tool": "check_availability",
  "arguments": {
    "eventTypeSlug": "demo",
    "date": "2026-06-18",
    "timezone": "Asia/Kolkata"
  }
}

// Tool result
{
  "slots": ["09:00", "10:00", "14:00", "15:30"],
  "date": "2026-06-18",
  "timezone": "Asia/Kolkata"
}`}
      />

      <ToolCard
        name="book_appointment"
        desc="Books a slot on the scheduling calendar. Creates a confirmed booking, sends a confirmation email to the attendee, creates a Google Calendar event (if configured), and fires booking webhooks."
        params={[
          { name: "eventTypeSlug", type: "string", required: true, desc: "The slug of the event type to book." },
          { name: "date", type: "string (YYYY-MM-DD)", required: true, desc: "Date of the appointment." },
          { name: "time", type: "string (HH:MM)", required: true, desc: "Start time of the appointment in 24-hour format." },
          { name: "timezone", type: "string", required: true, desc: "IANA timezone for the date and time." },
          { name: "attendeeName", type: "string", required: true, desc: "Full name of the person being booked." },
          { name: "attendeeEmail", type: "string", required: true, desc: "Email address for the confirmation." },
          { name: "notes", type: "string", desc: "Optional notes to attach to the booking (e.g. call topics, company name)." },
        ]}
        example={`// LLM tool call
{
  "tool": "book_appointment",
  "arguments": {
    "eventTypeSlug": "demo",
    "date": "2026-06-18",
    "time": "15:00",
    "timezone": "Asia/Kolkata",
    "attendeeName": "Priya Sharma",
    "attendeeEmail": "priya@example.com",
    "notes": "Interested in enterprise plan. Team of 5."
  }
}

// Tool result
{
  "bookingId": "bk_abc123",
  "confirmationUrl": "https://app.snapserve.ai/book/confirm/bk_abc123",
  "startTime": "2026-06-18T09:30:00.000Z"
}`}
      />

      <ToolCard
        name="end_call"
        desc="Gracefully terminates the call. The agent's final TTS response is played before the call is disconnected. Always use this tool instead of stopping mid-sentence."
        params={[
          { name: "reason", type: "string", desc: "Optional reason code for analytics: completed | transferred | no_interest | error." },
        ]}
        example={`// LLM tool call
{
  "tool": "end_call",
  "arguments": { "reason": "completed" }
}`}
      />

      <ToolCard
        name="transfer_call"
        desc="Transfers the live call to another phone number. The caller is placed on hold briefly while the transfer is initiated via the telephony provider."
        params={[
          { name: "toNumber", type: "string (E.164)", required: true, desc: "The destination number in E.164 format (e.g. +919876543210)." },
          { name: "message", type: "string", desc: "A message the agent speaks to the caller before initiating the transfer." },
        ]}
        example={`{
  "tool": "transfer_call",
  "arguments": {
    "toNumber": "+919876543210",
    "message": "Let me transfer you to our billing team now."
  }
}`}
      />

      <ToolCard
        name="send_webhook"
        desc="Sends a POST request to a custom URL with call context and custom payload. Use this to push data to your CRM, trigger automations, or create support tickets mid-call."
        params={[
          { name: "url", type: "string (HTTPS)", required: true, desc: "The endpoint to POST to. Must be HTTPS." },
          { name: "payload", type: "object", desc: "Custom key-value data to include in the webhook body alongside call metadata." },
        ]}
        example={`{
  "tool": "send_webhook",
  "arguments": {
    "url": "https://hooks.example.com/crm/callback-request",
    "payload": {
      "callerName": "Priya Sharma",
      "reason": "pricing_question",
      "preferredCallbackTime": "tomorrow morning"
    }
  }
}

// Your endpoint receives:
{
  "callId": "ca_abc123",
  "agentId": "ag_xyz",
  "callerNumber": "+919876543210",
  "timestamp": "2026-06-17T09:30:00.000Z",
  "payload": {
    "callerName": "Priya Sharma",
    "reason": "pricing_question",
    "preferredCallbackTime": "tomorrow morning"
  }
}`}
      />

      <ToolCard
        name="send_sms"
        desc="Sends an SMS to the caller's phone number. Useful for sending confirmation codes, booking links, or follow-up information after the call."
        params={[
          { name: "message", type: "string", required: true, desc: "The SMS message body. Keep under 160 characters to avoid multi-part messages." },
          { name: "toNumber", type: "string (E.164)", desc: "Recipient number. Defaults to the caller's number if omitted." },
        ]}
        example={`{
  "tool": "send_sms",
  "arguments": {
    "message": "Your demo is confirmed for June 18 at 3 PM IST. Join link: https://meet.snapserve.ai/demo-priya"
  }
}`}
      />

      <h2 id="prompting-for-tools">Prompting for tools</h2>
      <p>
        Always tell the LLM explicitly when and how to use each enabled tool. Without explicit
        guidance the model may hesitate or use the wrong tool.
      </p>
      <CodeBlock language="text" code={`Tools you have available:

check_availability — use this when the caller asks about available slots.
  Always check before asking for their preferred time.

book_appointment — use this ONLY after the caller has confirmed a specific date and time.
  Confirm the details aloud: "So I'll book you in for Thursday June 18th at 3 PM IST — does that work?"
  Then call the tool. After booking, read out the booking confirmation.

end_call — always call this when saying goodbye. Never stop responding without calling it.

send_webhook — call this if the caller asks to speak to a human agent.
  Use payload: { "type": "human_escalation", "callerIntent": "<brief description>" }`} />

      <h2 id="tool-errors">Handling tool errors</h2>
      <p>
        If a tool call fails (network error, slot conflict, invalid data), the error is returned as
        the tool result. Instruct the LLM how to handle failures gracefully:
      </p>
      <CodeBlock language="text" code={`If a tool returns an error:
- For check_availability errors: say "I'm having trouble checking the calendar right now."
  Offer to have someone call them back, then use send_webhook to create a callback request.
- For book_appointment conflicts (slot taken): say "That slot was just taken. Here are some other options..."
  Then call check_availability for the same date to get fresh availability.
- Never mention "tool error" or technical details to the caller.`} />
    </div>
  );
}
