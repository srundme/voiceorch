import { Link } from "wouter";
import { PageHeader } from "../DocsUi";

export default function ChangelogPage() {
  return (
    <div>
      <PageHeader
        breadcrumb="Reference"
        title="Changelog"
        description="Notable documentation and API-consumer changes."
      />

      <h2 id="2026-08-24-mcp-full">2026-08-24 — Claude MCP: full product tools</h2>
      <ul>
        <li>
          Hosted connector <code>https://app.snapserve.ai/api/mcp</code> now exposes the full
          SnapServe tool set (campaigns, journeys, WhatsApp, Sheets automatic calls, knowledge,
          squads, webcall) rather than agents/calls/wallet only.
        </li>
        <li>
          Older tool names (<code>create_outbound_call</code>, <code>snapserve_api_request</code>,
          analytics aliases) still work.
        </li>
      </ul>

      <h2 id="2026-08-23-base-url">2026-08-23 — Published hosts (API + docs)</h2>
      <ul>
        <li>
          The only public API base is <code>https://app.snapserve.ai/api</code>.{" "}
          <code>api.snapserve.ai</code> is not a SnapServe API host (it 404s).
        </li>
        <li>
          Docs live at <code>https://app.snapserve.ai/docs</code>, not{" "}
          <code>docs.snapserve.ai</code>.
        </li>
        <li>
          Dashboard → API Keys curl sample now uses the live base URL.
        </li>
      </ul>

      <h2 id="2026-08-22-jarvis">2026-08-22 — Jarvis: Karthikeyan voice, colloquial Tamil, creates as you talk</h2>
      <ul>
        <li>
          In-app Jarvis UI has been removed (overlay and rail). A new assistant plan is incoming.
        </li>
        <li>
          Guide: <Link href="/docs/jarvis">Jarvis</Link>.
        </li>
      </ul>

      <h2 id="2026-08-20-voice-memory-address">2026-08-20 — Voice Memory: address the caller on match</h2>
      <ul>
        <li>
          When a voiceprint match lands, the agent now speaks immediately —{" "}
          <em>Hi Priya — good to hear from you again</em> — instead of waiting for the
          next LLM turn. If they are still talking, it waits for the pause, then takes
          the floor. Match without stored facts still greets them.
        </li>
      </ul>

      <h2 id="2026-08-20-builder-panels">2026-08-20 — Agent Builder: every tab is panels</h2>
      <ul>
        <li>
          Script, Sound, Actions, After the call, and Settings use the same filled panel:
          title inside the box, not floating above it. Welcome and Talk sit in one shape each;
          Fast / Balanced / Patient are equal cards; Actions groups (booking, messaging, recording)
          are stacked rows inside a panel instead of loose uppercase labels.
        </li>
        <li>
          The editor column sits on a muted page with a bordered sheet. At a glance is a
          checklist block, not three separate chips.
        </li>
      </ul>

      <h2 id="2026-08-20-builder-ux">2026-08-20 — Agent Builder: one column, aligned layout</h2>
      <ul>
        <li>
          Header, tabs, and every builder page now share the same left edge and page width.
          Tabs split <em>Build</em> (Overview → After the call) from <em>Review</em>
          (Activity, Settings, Versions). Script and Sound show ready/not-ready chips in the header.
        </li>
        <li>
          Overview sections are real panels now: title inside the box, equal-height Phone and
          Knowledge, trial line nested in Phone. Builder no longer flattens card corners.
        </li>
      </ul>

      <h2 id="2026-08-20-connections-vs-agent">2026-08-20 — Connections vs Agent Builder</h2>
      <ul>
        <li>
          Connections is the raw-material page: WhatsApp number, Brevo, Google Calendar.
          Agent Builder only <em>uses</em> those — turn on send, pick a Meta template,
          map it to an outcome, pick a meeting.
        </li>
        <li>
          After the call: each outcome rule can pick which approved WhatsApp template
          to send. Fast / Balanced / Patient stays on Sound. Settings no longer
          duplicates STT endpointing.
        </li>
      </ul>

      <h2 id="2026-08-20-agent-builder-actions">2026-08-20 — Agent Builder: Actions in one place</h2>
      <ul>
        <li>
          Tabs are job-named: Script, Sound, Actions, After the call, Activity.
          Voicemail moved onto After the call. Connecting WhatsApp / email / Google
          stays under Connections.
        </li>
        <li>
          After the call maps each outcome to an approved WhatsApp template. Fast /
          Balanced / Patient lives on Sound.
        </li>
      </ul>

      <h2 id="2026-08-20-agent-builder-sarvam-realtime-ui">2026-08-20 — Agent Builder: Sarvam realtime settings</h2>
      <ul>
        <li>
          Transcriber is a no-code screen: language, how speech is written, and
          brand terms. The language picker is the 23-code Sarvam table
          (<code>en-IN</code>, Odia as <code>or-IN</code>). Switch language during
          call still sends <code>language_code=auto</code>.
        </li>
        <li>
          Model/provider pickers and millisecond VAD sliders are gone from
          Transcriber. Fast / Balanced / Patient on Sound set turn-taking
          (<code>silence_duration_ms</code> 300 / 500 / 700). Settings no longer
          repeats those STT sliders.
        </li>
      </ul>

      <h2 id="2026-08-19-sarvam-stt-realtime">2026-08-19 — Sarvam STT: realtime partials</h2>
      <ul>
        <li>
          Live Sarvam STT now uses <code>saaras:v3-realtime</code> (
          <code>/speech-to-text-realtime/ws</code>): real <code>transcript.partial</code> events,
          millisecond VAD, and mid-call <code>config.update</code> without reconnecting.
          Saarika stays on the legacy finals-only socket.
        </li>
        <li>
          Indic script on an English-configured agent is treated as a language switch, not
          garbled audio — Tamil inbound is no longer answered with &quot;I didn&apos;t get that.&quot;
        </li>
        <li>
          Server VAD (<code>endpointing=vad</code>, <code>stream_type=fast</code>) owns turns.
          Barge-in uses <code>vad.speech_start</code> and early partials — not energy and not
          <code>transcript.final</code>. Language/mode changes go out as <code>config.update</code>.
          Call logs record Sarvam&apos;s billed <code>session.end.audio_duration_s</code>.
          Transcriber → Partial transcripts picks <code>fast</code> (default),
          <code>balanced</code>, or <code>simulated</code> (finals only).
          The socket now sends the full connect query: 8 kHz linear16,
          millisecond VAD, <code>return_timestamps</code>, and an optional
          terminology <code>prompt</code> for finals.
          Auto-detect uses the 24-code table (<code>or-IN</code> for Odia, not
          legacy <code>od-IN</code>) and reads <code>language</code> /
          <code>language_confidence</code> on transcripts.
        </li>
      </ul>

      <h2 id="2026-08-19-voice-memory-live-link">2026-08-19 — Voice Memory: recognize mid-call</h2>
      <ul>
        <li>
          Cross-number match runs at the first ~2.5s of caller speech, so the agent can use
          the previous number&apos;s memory while the call is still live. A ~5s refine and hangup
          re-embed still upgrade the stored print.
        </li>
        <li>
          On a new phone number, &quot;do you remember me?&quot; is no longer a hard deny while
          matching is still running. When a match lands, the agent cuts in to acknowledge
          (by name when known), even if this call started with an empty caller memory.
        </li>
      </ul>

      <h2 id="2026-08-19-gemini-live-ui">2026-08-19 — Gemini Live 3.1 in Agent Builder</h2>
      <ul>
        <li>
          Model → Voice stack lists <strong>Gemini Live 3.1</strong> again (native speech-to-speech).
          Classic STT + LLM + TTS stays the default. Live needs a Google API key on the workspace.
        </li>
      </ul>

      <h2 id="2026-08-19-voice-memory-score">2026-08-19 — Voice Memory: telephony scores</h2>
      <ul>
        <li>
          Cross-number voice match now uses ~5s of caller speech (or the full call at hangup),
          not the first 2.5s of short replies. Same-person 8 kHz scores around 0.42 now link
          when that voice is the only candidate.
        </li>
      </ul>

      <h2 id="2026-08-19-english-latch">2026-08-19 — Multilingual: Devanagari “English” requests</h2>
      <ul>
        <li>
          Callers who ask for English in Hindi script (<code>इंग्लिश मैडम</code>,{" "}
          <code>इंग्लिश में बात करो</code>) now switch the agent to English. Sarvam often
          writes “English” as <code>इंग्लिश</code>, which the previous detector missed.
        </li>
      </ul>

      <h2 id="2026-08-19-sonic-36">2026-08-19 — Cartesia Sonic 3.6 (beta)</h2>
      <ul>
        <li>
          Agent Builder → Voice now lists <strong>Sonic 3.6 (beta)</strong> for Cartesia. API id is{" "}
          <code>sonic-preview</code>. Existing agents stay on <code>sonic-3.5</code> unless you switch them.
        </li>
        <li>
          Beta: Cartesia can change 3.6 without notice. Flip back to Sonic 3.5 if a call sounds off.
        </li>
      </ul>

      <h2 id="2026-08-18-webhook-template">2026-08-18 — Custom post-call notify JSON</h2>
      <ul>
        <li>
          Agent Builder → Settings → Post-call notify accepts an optional JSON template so your backend
          can consume the call result without transforming the payload.
        </li>
        <li>
          Leave the template blank for the default SnapServe body. Workspace{" "}
          <a href="/docs/webhooks">event subscriptions</a> are unchanged. HMAC signs the body actually POSTed.
          Invalid JSON falls back to the default payload (<code>X-SnapServe-Payload: default</code>).
        </li>
      </ul>

      <h2 id="2026-08-18-caller-memory">2026-08-18 — Caller memory updates (API + campaigns)</h2>
      <ul>
        <li>
          <code>POST /agents/&#123;id&#125;/caller-memory/&#123;phone&#125;/facts</code> writes
          operator/CRM facts (<code>note</code>, <code>context</code>, <code>facts</code>) that the
          agent injects as ground truth on the next call.
        </li>
        <li>
          Campaigns: lead Notes sync to the same memory;{" "}
          <code>POST /campaigns/&#123;id&#125;/leads/&#123;leadId&#125;/memory</code> also merges
          fields into lead data for the next auto-dial.
        </li>
        <li>
          Guide: <a href="/docs/caller-memory">Caller memory updates</a>.{" "}
          <code>POST /calls/outbound</code> still has no <code>variables</code> body field. Public API
          Reference: <a href="/docs/api-reference/upsertCallerMemoryFacts">upsertCallerMemoryFacts</a>.
        </li>
      </ul>

      <h2 id="2026-08-18-docs">2026-08-18 — Docs coverage for the live product</h2>
      <ul>
        <li>
          New guides: <strong>Vibe builder</strong>, <strong>WhatsApp</strong> (text, calling,
          Meta rules), <strong>Connections</strong>, <strong>Test an agent</strong>,{" "}
          <strong>Team workspace</strong>, <strong>Compliance</strong>.
        </li>
        <li>Sidebar grouped by job (build, connect, calls, account) with prev/next and search.</li>
        <li>
          Vibe builder chat uses managed <code>sarvam-105b</code> with high reasoning; live agents
          still default to <code>sarvam-105b-conversations</code>.
        </li>
        <li>
          Deepened <strong>Quick Start</strong>, <strong>Campaigns</strong>, and{" "}
          <strong>Pricing</strong> — WhatsApp paise rate card, campaign sources/pacing, and honest
          outbound API body (no <code>variables</code> field).
        </li>
      </ul>

      <h2 id="2026-08-10-webhook-names">2026-08-10 — Rename the four “webhook” surfaces</h2>
      <ul>
        <li>
          <strong>Event subscriptions</strong> — Developers (was “Webhooks”)
        </li>
        <li>
          <strong>Post-call notify</strong> — Agent Settings (was “Webhooks” / CRM webhook)
        </li>
        <li>
          <strong>Form intake</strong> — Campaigns / Connections website (was “form webhook”)
        </li>
        <li>
          <strong>Lead transfer</strong> — Campaign push to CRM URL / Sheets (label clarified)
        </li>
        <li>
          <strong>Mid-call HTTP</strong> — Agent Tools custom function
        </li>
      </ul>

      <h2 id="2026-08-10-builder-analytics">2026-08-10 — Analytics inside Agent Builder</h2>
      <ul>
        <li>
          Agent Builder top-level <strong>Analytics</strong> tab — call volume, success, spend, latency
          for that agent (same data as <code>/app/analytics/agents/:id</code>).
        </li>
        <li>
          Settings → former Analytics sub-tab is <strong>Post-call notify</strong> (CRM URL for that agent).
        </li>
      </ul>

      <h2 id="2026-08-10-analytics-nav">2026-08-10 — Analytics in primary nav</h2>
      <ul>
        <li>
          Platform <strong>Analytics</strong> moved from sidebar More into the primary nav (with History).
        </li>
      </ul>

      <h2 id="2026-08-10-outcomes-ux">2026-08-10 — Outcomes tab &amp; naming clarity</h2>
      <ul>
        <li>
          Agent Builder: top-level <strong>Outcomes</strong> tab (taxonomy + after-call messages) — no longer
          buried under Settings → Analytics.
        </li>
        <li>
          Naming: Bookings calendar vs Meeting bots; mid-call WhatsApp (Tools) vs after-call (Outcomes);
          display name ≠ spoken brand callout on Prompt.
        </li>
        <li>Squads: edit members in-app; Callback disposition ≠ live handoff callout.</li>
      </ul>

      <h2 id="2026-08-10-clarity">2026-08-10 — Product clarity, meetings, playbook</h2>
      <ul>
        <li>
          <strong>Platform concepts</strong> — agent vs campaign vs Connections vs Outcomes /
          after-call messages vs lead transfer vs squads vs meetings.
        </li>
        <li>
          <strong>Meetings guide</strong> — paste link, calendar Join, booking dispatch, in-meeting
          tools; API Reference tag <strong>Meetings</strong>.
        </li>
        <li>
          <strong>Agents / Campaigns guides</strong> — Outcomes + after-call on agent; lead transfer
          on campaign.
        </li>
        <li>
          <strong>Voiceathon playbook</strong> — rewritten for Connections hub, disposition dynamics,
          meetings, and current nav (see repo <code>docs/voiceathon-participant-playbook.md</code>).
        </li>
      </ul>

      <h2 id="2026-07-30-claude">2026-07-30 — Claude skill &amp; MCP</h2>
      <ul>
        <li>
          <strong>Docs</strong> — new guide{" "}
          <a href="/docs/claude-skill">Claude skill &amp; MCP</a> for Claude Desktop / Claude Code
          (agents, campaigns, website webhooks, and more via live tools).
        </li>
        <li>
          <strong>MCP</strong> — <code>@snapserve/mcp</code> (<code>lib/snapserve-mcp</code>) with
          <code>SNAPSERVE_API_KEY</code> against <code>https://app.snapserve.ai/api</code>.
        </li>
      </ul>

      <h2 id="2026-07-15-docs">2026-07-15 — Docs restructure</h2>
      <ul>
        <li>
          <strong>Learning guides</strong> — what you can build, platform concepts, agents builder,
          variables, knowledge base, calendar, campaigns, FAQ.
        </li>
        <li>
          <strong>Curated API Reference</strong> — Bolna-style public surface only (agents, calls /
          transcript+summary, variables, webhooks, phones, wallet, knowledge, scheduling). Campaigns
          and admin APIs hidden from the sidebar.
        </li>
        <li>
          <strong>API key auth</strong> — <code>Bearer sk_live_…</code> on the public API.
        </li>
        <li>
          <strong>INR billing</strong> — ₹500 welcome, ₹5/min, phones ₹800+GST, card only.
        </li>
      </ul>
    </div>
  );
}
