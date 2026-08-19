import { Link } from "wouter";
import { Callout, PageHeader } from "../DocsUi";

export default function VibePage() {
  return (
    <div>
      <PageHeader
        breadcrumb="Build agents"
        title="Vibe builder"
        updated="18 Aug 2026"
        description="The recommended way to create an agent. Chat to design it, then stay on the same page to edit, connect channels, and test."
      />

      <p>
        Open{" "}
        <a href="https://app.snapserve.ai/app/vibe" target="_blank" rel="noreferrer">
          Vibe
        </a>{" "}
        in the dashboard. After an agent exists, four tabs stay on one studio:
      </p>
      <ul>
        <li>
          <strong>Chat</strong> — describe the business, language, and call flow. Vibe writes the
          prompt, greeting, tools, and outcomes.
        </li>
        <li>
          <strong>Agent</strong> — full editor (prompt, voice, tools, outcomes). Same panel as{" "}
          <Link href="/docs/agents">Agents &amp; builder</Link>.
        </li>
        <li>
          <strong>Connect</strong> — phone number, knowledge, WhatsApp, calendar, CRM notify. Same
          hub as <Link href="/docs/connections">Connections</Link>.
        </li>
        <li>
          <strong>Test</strong> — webcall, outbound test, tool simulator.{" "}
          <Link href="/docs/testing">Test an agent</Link>.
        </li>
      </ul>

      <Callout variant="tip" title="Start here for a first agent">
        Tell Vibe who the agent is, what language they speak, and what a successful call looks like.
        Refine in chat, then switch to Agent / Connect / Test without leaving the page.
      </Callout>

      <h2 id="models">Which models Vibe uses</h2>
      <ul>
        <li>
          <strong>Builder chat</strong> — Sarvam <code>sarvam-105b</code> with high reasoning on the
          SnapServe managed key. This designs the agent; it is not the voice on the call.
        </li>
        <li>
          <strong>Live agent (default)</strong> — Sarvam <code>sarvam-105b-conversations</code> for
          phone, webcall, and WhatsApp chat replies. Change provider and model on the Agent tab.
        </li>
      </ul>

      <h2 id="partners">Partner / white-label workspaces</h2>
      <p>
        Managed partner clients do not see SnapServe branding or Vibe marketing. They create agents
        from the classic builder (<code>/app/agents?create=1</code>). Direct SnapServe hosts keep
        Vibe as the default studio.
      </p>

      <h2 id="next">Next</h2>
      <p>
        Attach a number and channels in <Link href="/docs/connections">Connections</Link>, then{" "}
        <Link href="/docs/testing">test</Link> before a campaign.
      </p>
    </div>
  );
}
