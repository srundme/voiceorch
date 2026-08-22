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
        The black robot button on Home is Jarvis. On the agent builder it docks as a slim tab on
        the right edge so it does not cover form controls.
      </Callout>

      <h2 id="talk">Talk to Jarvis</h2>
      <p>
        Open the button, then tap the large microphone. Jarvis greets you, speaks the highest-leverage
        next step, and starts listening. You can also type. Chrome or Edge is required for voice;
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

      <h2 id="jobs">Jobs it can do</h2>
      <p>Confirm the card — Jarvis does not mutate the workspace without that tap:</p>
      <ul>
        <li>Open the right page (campaigns, wallet, history, Connections)</li>
        <li>Publish a draft agent or move it back to draft</li>
        <li>Create a campaign draft on an existing agent</li>
        <li>Assign one of your voice numbers to an agent</li>
        <li>Apply proposed agent setting fixes (latency, VAD, prompt trim)</li>
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
