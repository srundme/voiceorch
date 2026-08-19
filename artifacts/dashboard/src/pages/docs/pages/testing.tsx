import { Link } from "wouter";
import { Callout, PageHeader } from "../DocsUi";

export default function TestingPage() {
  return (
    <div>
      <PageHeader
        breadcrumb="Build agents"
        title="Test an agent"
        updated="18 Aug 2026"
        description="Prove the prompt, tools, and voice before you spend wallet minutes on a campaign."
      />

      <p>
        From <Link href="/docs/vibe">Vibe</Link> → <strong>Test</strong>, or open{" "}
        <a href="https://app.snapserve.ai/app/test-simulator" target="_blank" rel="noreferrer">
          Test simulator
        </a>
        .
      </p>

      <h2 id="webcall">Webcall</h2>
      <p>
        Browser audio to the same agent stack (STT → LLM → TTS) without a phone number. Use this to
        check greeting, barge-in, language, and tool calls. Share a webcall link when you need a
        stakeholder to try the agent without KYC.
      </p>

      <h2 id="outbound">Outbound test</h2>
      <p>
        Place one PSTN call to your phone. Requires an assigned number, an active agent, and wallet
        balance (₹5/min). This is a real call — it bills like production.
      </p>

      <h2 id="tools">Tool simulator</h2>
      <p>
        Fire booking, HTTP, WhatsApp, or transfer tools without a live conversation. Use it to
        confirm arguments, calendar IDs, and webhook URLs before customers hit them.
      </p>

      <Callout variant="warn" title="WhatsApp and meetings are separate tests">
        WhatsApp text/calling is tested on the{" "}
        <Link href="/docs/whatsapp">WhatsApp</Link> page (test message / test call). Meeting bots
        are tested by joining a Meet/Zoom/Teams link —{" "}
        <Link href="/docs/meetings">Meetings</Link>.
      </Callout>

      <h2 id="history">After the call</h2>
      <p>
        Open History for transcript, summary, disposition, and recording. Same fields as{" "}
        <Link href="/docs/outbound-calls">Calls &amp; history</Link> and{" "}
        <code>call.completed</code> webhooks.
      </p>
    </div>
  );
}
