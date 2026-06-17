import { CodeBlock } from "../CodeBlock";

function Section({ title, id, children }: { title: string; id: string; children: React.ReactNode }) {
  return (
    <div className="mt-10">
      <h2 id={id}>{title}</h2>
      {children}
    </div>
  );
}

function Endpoint({ method, path, desc, auth = true }: { method: string; path: string; desc: string; auth?: boolean }) {
  const colors: Record<string, string> = {
    GET: "text-emerald-400",
    POST: "text-blue-400",
    PATCH: "text-yellow-400",
    DELETE: "text-red-400",
    PUT: "text-orange-400",
  };
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-white/5 last:border-0">
      <span className={`font-mono text-xs font-bold w-12 shrink-0 pt-0.5 ${colors[method] ?? "text-muted-foreground"}`}>{method}</span>
      <span className="font-mono text-xs text-foreground/80 flex-1 pt-0.5">{path}</span>
      <span className="text-xs text-muted-foreground flex-1 hidden sm:block">{desc}</span>
      {!auth && <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground/50 shrink-0">public</span>}
    </div>
  );
}

export default function ApiReferencePage() {
  return (
    <div>
      <h1>API Reference</h1>
      <p>
        The SnapServe REST API is available at <code>https://app.snapserve.ai/api</code>. All
        endpoints require <code>Authorization: Bearer &lt;token&gt;</code> unless marked as{" "}
        <span className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-muted-foreground/50">public</span>.
        See <a href="/docs/authentication" className="text-primary hover:underline">Authentication</a> for token details.
      </p>

      <CodeBlock language="bash" code={`# Base URL
https://app.snapserve.ai/api

# All authenticated requests
curl https://app.snapserve.ai/api/agents \\
  -H "Authorization: Bearer <token>"

# Pagination (all list endpoints)
GET /api/agents?page=1&limit=20`} />

      <Section title="Agents" id="agents">
        <div className="my-4 rounded-xl border border-border overflow-hidden">
          <Endpoint method="GET"    path="/agents"                   desc="List all agents" />
          <Endpoint method="POST"   path="/agents"                   desc="Create a new agent" />
          <Endpoint method="GET"    path="/agents/:id"               desc="Get agent by ID" />
          <Endpoint method="PATCH"  path="/agents/:id"               desc="Update agent settings" />
          <Endpoint method="DELETE" path="/agents/:id"               desc="Delete agent" />
          <Endpoint method="PATCH"  path="/agents/:id/toggle"        desc="Toggle active/inactive status" />
          <Endpoint method="GET"    path="/agents/:id/versions"      desc="List configuration versions" />
        </div>
        <CodeBlock language="json" code={`// POST /api/agents — request body
{
  "name": "Support Bot",
  "systemPrompt": "You are a support agent for SnapServe...",
  "language": "en",
  "asrProvider": "deepgram",
  "asrModel": "nova-3",
  "llmProvider": "openai",
  "llmModel": "gpt-4o-mini",
  "ttsProvider": "elevenlabs",
  "ttsVoice": "rachel",
  "silenceTimeout": 30,
  "maxCallDuration": 600,
  "tools": ["book_appointment", "end_call"]
}`} />
      </Section>

      <Section title="Calls" id="calls">
        <div className="my-4 rounded-xl border border-border overflow-hidden">
          <Endpoint method="GET"    path="/calls"                    desc="List calls (filter by agent, date, status)" />
          <Endpoint method="GET"    path="/calls/:id"                desc="Get call details and full transcript" />
          <Endpoint method="PATCH"  path="/calls/:id/end"            desc="Programmatically end a live call" />
        </div>
        <CodeBlock language="json" code={`// GET /api/calls — query params
?agentId=ag_abc123
&status=completed          // completed | failed | no-answer | in-progress
&startDate=2026-06-01
&endDate=2026-06-30
&page=1
&limit=50

// Response
{
  "calls": [
    {
      "id": "ca_abc123",
      "agentId": "ag_xyz",
      "agentName": "Support Bot",
      "status": "completed",
      "duration": 142,
      "startedAt": "2026-06-17T09:30:00.000Z",
      "endedAt": "2026-06-17T09:32:22.000Z",
      "transcript": [
        { "role": "agent", "text": "Hi, how can I help you today?" },
        { "role": "user",  "text": "I need help with my account." }
      ]
    }
  ],
  "total": 248,
  "page": 1
}`} />
      </Section>

      <Section title="Providers" id="providers">
        <div className="my-4 rounded-xl border border-border overflow-hidden">
          <Endpoint method="GET"    path="/providers"                desc="List all provider keys (masked)" />
          <Endpoint method="POST"   path="/providers"                desc="Add a provider API key" />
          <Endpoint method="PATCH"  path="/providers/:id"            desc="Update provider label" />
          <Endpoint method="DELETE" path="/providers/:id"            desc="Remove a provider key" />
        </div>
        <CodeBlock language="json" code={`// POST /api/providers — request body
{
  "category": "asr",             // asr | llm | tts | telephony
  "provider": "deepgram",
  "apiKey": "sk-live-...",
  "label": "Production Deepgram" // optional
}

// Response — key is never returned in full
{
  "id": "pv_abc123",
  "category": "asr",
  "provider": "deepgram",
  "label": "Production Deepgram",
  "keyHint": "...x4F2"
}`} />
      </Section>

      <Section title="Scheduling — Calendars" id="scheduling-calendars">
        <div className="my-4 rounded-xl border border-border overflow-hidden">
          <Endpoint method="GET"    path="/scheduling/calendars"              desc="List calendars" />
          <Endpoint method="POST"   path="/scheduling/calendars"              desc="Create calendar" />
          <Endpoint method="GET"    path="/scheduling/calendars/:id"          desc="Get calendar" />
          <Endpoint method="PATCH"  path="/scheduling/calendars/:id"          desc="Update calendar" />
          <Endpoint method="DELETE" path="/scheduling/calendars/:id"          desc="Delete calendar" />
        </div>
      </Section>

      <Section title="Scheduling — Event Types" id="scheduling-event-types">
        <div className="my-4 rounded-xl border border-border overflow-hidden">
          <Endpoint method="GET"    path="/scheduling/event-types"            desc="List event types" />
          <Endpoint method="POST"   path="/scheduling/event-types"            desc="Create event type" />
          <Endpoint method="GET"    path="/scheduling/event-types/:id"        desc="Get event type" />
          <Endpoint method="PATCH"  path="/scheduling/event-types/:id"        desc="Update event type" />
          <Endpoint method="DELETE" path="/scheduling/event-types/:id"        desc="Delete event type" />
        </div>
        <CodeBlock language="json" code={`// POST /api/scheduling/event-types
{
  "calendarId": "cal_abc",
  "name": "30-min Product Demo",
  "slug": "demo",
  "durationMinutes": 30,
  "bufferMinutes": 10,
  "description": "Live walkthrough of SnapServe for your team."
}`} />
      </Section>

      <Section title="Scheduling — Public (no auth)" id="scheduling-public">
        <div className="my-4 rounded-xl border border-border overflow-hidden">
          <Endpoint method="GET"  path="/scheduling/public/event-types/:slug"  desc="Get event type by slug" auth={false} />
          <Endpoint method="GET"  path="/scheduling/public/slots"               desc="Get available time slots" auth={false} />
          <Endpoint method="POST" path="/scheduling/public/bookings"            desc="Create a booking" auth={false} />
        </div>
        <CodeBlock language="bash" code={`# Get available slots
GET /api/scheduling/public/slots?slug=demo&date=2026-06-18&timezone=Asia/Kolkata

# Create a booking
curl -X POST https://app.snapserve.ai/api/scheduling/public/bookings \\
  -H "Content-Type: application/json" \\
  -d '{
    "eventTypeId": "et_abc123",
    "startTime": "2026-06-18T09:30:00.000Z",
    "attendeeName": "Priya Sharma",
    "attendeeEmail": "priya@example.com",
    "timezone": "Asia/Kolkata"
  }'`} />
      </Section>

      <Section title="Campaigns" id="campaigns">
        <div className="my-4 rounded-xl border border-border overflow-hidden">
          <Endpoint method="GET"    path="/campaigns"                          desc="List campaigns" />
          <Endpoint method="POST"   path="/campaigns"                          desc="Create campaign" />
          <Endpoint method="GET"    path="/campaigns/:id"                      desc="Get campaign" />
          <Endpoint method="PATCH"  path="/campaigns/:id"                      desc="Update campaign" />
          <Endpoint method="DELETE" path="/campaigns/:id"                      desc="Delete campaign" />
          <Endpoint method="GET"    path="/campaigns/:id/batches"              desc="List batches" />
          <Endpoint method="POST"   path="/campaigns/:id/batches"              desc="Create batch (upload leads)" />
          <Endpoint method="GET"    path="/campaigns/:id/batches/:batchId"     desc="Get batch with leads" />
          <Endpoint method="PATCH"  path="/campaigns/:id/batches/:batchId"     desc="Update batch status" />
        </div>
      </Section>

      <Section title="Analytics" id="analytics">
        <div className="my-4 rounded-xl border border-border overflow-hidden">
          <Endpoint method="GET" path="/analytics"              desc="Platform-level call analytics" />
          <Endpoint method="GET" path="/analytics/agents/:id"   desc="Per-agent analytics" />
        </div>
        <CodeBlock language="json" code={`// GET /api/analytics — response
{
  "totalCalls": 1248,
  "callsToday": 47,
  "successRate": 0.83,
  "avgDurationSeconds": 142,
  "callsByDay": [
    { "date": "2026-06-17", "count": 47, "successCount": 39 }
  ],
  "statusBreakdown": {
    "completed": 1034,
    "failed": 98,
    "no-answer": 116
  }
}`} />
      </Section>

      <Section title="Webhooks" id="webhooks-api">
        <div className="my-4 rounded-xl border border-border overflow-hidden">
          <Endpoint method="GET"    path="/webhook-endpoints"          desc="List webhook endpoints" />
          <Endpoint method="POST"   path="/webhook-endpoints"          desc="Register a webhook endpoint" />
          <Endpoint method="PATCH"  path="/webhook-endpoints/:id"      desc="Update endpoint URL or events" />
          <Endpoint method="DELETE" path="/webhook-endpoints/:id"      desc="Remove webhook endpoint" />
        </div>
      </Section>

      <Section title="Wallet" id="wallet">
        <div className="my-4 rounded-xl border border-border overflow-hidden">
          <Endpoint method="GET"  path="/wallet"                 desc="Get wallet balance and transaction history" />
          <Endpoint method="POST" path="/wallet/topup"           desc="Add credit to wallet" />
        </div>
      </Section>

      <Section title="Knowledge Base" id="knowledge">
        <div className="my-4 rounded-xl border border-border overflow-hidden">
          <Endpoint method="GET"    path="/knowledge-sources"              desc="List knowledge sources" />
          <Endpoint method="POST"   path="/knowledge-sources"              desc="Create knowledge source" />
          <Endpoint method="DELETE" path="/knowledge-sources/:id"          desc="Delete knowledge source" />
          <Endpoint method="GET"    path="/knowledge-sources/:id/entries"  desc="List entries in a source" />
          <Endpoint method="POST"   path="/knowledge-sources/:id/entries"  desc="Add entry to a source" />
          <Endpoint method="DELETE" path="/knowledge-sources/:id/entries/:entryId" desc="Remove an entry" />
        </div>
      </Section>

      <Section title="Error responses" id="errors">
        <div className="my-6 overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs uppercase bg-white/5 text-muted-foreground border-b border-border">
              <tr>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Meaning</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["400 Bad Request", "Validation failed — check the error.details field for specifics"],
                ["401 Unauthorized", "Missing or expired session token"],
                ["403 Forbidden", "Valid token but insufficient permissions"],
                ["404 Not Found", "Resource does not exist or belongs to another user"],
                ["409 Conflict", "Duplicate resource or booking slot conflict"],
                ["422 Unprocessable", "Business logic rejection (e.g. agent is inactive)"],
                ["429 Too Many Requests", "Rate limit exceeded — back off and retry"],
                ["500 Internal Server Error", "Unexpected server error — report with request ID"],
              ].map(([s, d]) => (
                <tr key={s} className="border-b border-white/5 hover:bg-white/5">
                  <td className="px-4 py-3 font-mono text-xs">{s}</td>
                  <td className="px-4 py-3 text-muted-foreground">{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <CodeBlock language="json" code={`// Error response body
{
  "error": "Validation failed",
  "details": {
    "systemPrompt": "Required",
    "llmProvider": "Must be one of: openai, anthropic, deepseek, mistral, cohere"
  },
  "requestId": "req_abc123"
}`} />
      </Section>
    </div>
  );
}
