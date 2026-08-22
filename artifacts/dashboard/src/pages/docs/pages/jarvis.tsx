import { Link } from "wouter";
import { Callout, PageHeader } from "../DocsUi";

export default function JarvisPage() {
  return (
    <div>
      <PageHeader
        breadcrumb="Get started"
        title="Jarvis"
        updated="22 Aug 2026"
        description="Speak to SnapServe support on the dashboard. Jarvis reads your workspace, recommends the next step, and does the job when you confirm."
      />

      <Callout variant="tip">
        The gold orb on Home is Jarvis — Karthikeyan's listed Cartesia voice, speaking friendly
        Tanglish. On the agent builder it docks as a right-edge tab so it does not cover controls.
      </Callout>

      <h2 id="talk">Talk to Jarvis</h2>
      <p>
        Open the orb. Jarvis greets you in Tanglish, then listens. Say what you want —{" "}
        <em>Priya collection agent create pannu</em> — and he builds it. Chrome or Edge for voice;
        typing works everywhere.
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

      <h2 id="jobs">Jobs it does while you talk</h2>
      <p>No confirm tap for create. Speak the job; Jarvis does it:</p>
      <ul>
        <li>Create a live agent (Tanglish prompt if you asked for Tamil)</li>
        <li>Draft a campaign on that agent</li>
        <li>Assign one of your voice numbers</li>
        <li>Publish or park an agent</li>
        <li>Open wallet, history, Connections when that is the next step</li>
      </ul>
      <p>
        Jarvis will not delete an agent, release a number, or start a live dial batch. Those stay
        on the page so you see the lead list and calling hours first.
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
