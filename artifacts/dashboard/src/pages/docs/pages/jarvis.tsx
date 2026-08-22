import { Link } from "wouter";
import { Callout, PageHeader } from "../DocsUi";

export default function JarvisPage() {
  return (
    <div>
      <PageHeader
        breadcrumb="Get started"
        title="Jarvis"
        updated="22 Aug 2026"
        description="Speak to SnapServe on the dashboard. Jarvis is a friend first — then the same Vibe Build when you want an agent."
      />

      <Callout variant="tip">
        The gold orb on Home is Jarvis — Karthikeyan's listed Cartesia voice, speaking friendly
        Tanglish. After first signup he opens on Home automatically. You can just talk. On the
        agent builder he docks as a right-edge tab so he does not cover controls.
      </Callout>

      <h2 id="can-do">What Jarvis can do</h2>
      <ul>
        <li>
          <strong>Friendly chat</strong> — greetings, how-are-you, jokes, “enna panra”, explain
          SnapServe. No job, no form.
        </li>
        <li>
          <strong>Build an agent</strong> — official{" "}
          <Link href="/docs/vibe">Vibe Build</Link> in the HUD (core → voice → flow → knowledge →
          features → dispositions → phone → save).
        </li>
        <li>
          <strong>Workspace jobs</strong> — draft a campaign, assign a number, publish or park an
          agent, open wallet / history / Connections.
        </li>
        <li>
          <strong>Recommend the next step</strong> from live workspace data (no agent, unused
          number, low wallet, failed calls).
        </li>
      </ul>
      <p>
        He will not delete an agent, release a number, or start a live dial batch. Those stay on
        the page.
      </p>

      <h2 id="talk">Talk to Jarvis</h2>
      <p>
        Open the orb (or let him open after signup). He greets you as a friend. Say{" "}
        <em>eppadi irukka</em> and he chats. Say <em>Priya collection agent create pannu</em> and
        he walks Vibe. Chrome or Edge for voice; typing works everywhere.
      </p>

      <h2 id="recommend">What it recommends</h2>
      <p>
        Recommendations come from your live workspace, not a generic checklist. Typical gaps:
      </p>
      <ul>
        <li>No agent yet</li>
        <li>No phone or WhatsApp channel</li>
        <li>A number that is not assigned to an agent</li>
        <li>No campaign for outbound</li>
        <li>Agent still in draft</li>
        <li>Low wallet</li>
        <li>Recent failed calls</li>
      </ul>
      <p>
        If the workspace is healthy, Jarvis asks you to test the agent before spending minutes.
      </p>

      <h2 id="jobs">Jobs while you talk</h2>
      <p>
        “Create / build an agent” goes through <Link href="/docs/vibe">Vibe Build</Link> inside
        the HUD. After an agent exists: campaign draft, assign a number, publish, or open the
        next page.
      </p>

      <h2 id="next">After a job</h2>
      <p>
        Campaign drafts still need leads — import CSV or connect a website form.{" "}
        <Link href="/docs/campaigns">Campaigns</Link>. Assigned numbers should get a test inbound
        or webcall. <Link href="/docs/testing">Test an agent</Link>.
      </p>
    </div>
  );
}
