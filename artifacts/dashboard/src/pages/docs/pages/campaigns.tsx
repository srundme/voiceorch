import { CodeBlock } from "../CodeBlock";

export default function CampaignsPage() {
  return (
    <div>
      <h1>Campaigns</h1>
      <p>Campaigns let you run outbound voice calling at scale — upload a lead list, configure your dial logic, and SnapServe handles the rest.</p>

      <h2>Creating a campaign</h2>
      <ol>
        <li>Go to Campaigns → New Campaign</li>
        <li>Select an agent to handle calls</li>
        <li>Configure retries, call timing, and timezone</li>
        <li>Upload leads (CSV with name, phone, and optional custom variables)</li>
        <li>Launch</li>
      </ol>

      <h2>Batches</h2>
      <p>Each campaign has batches — a batch is a set of leads dialed in a single run. You can queue multiple batches, pause mid-batch, and review outcomes per batch.</p>

      <h2>Lead lifecycle</h2>
      <p>Each lead goes through: <code>pending → dialing → completed / failed / no-answer</code>. Failed and no-answer leads are retried based on your retry config.</p>

      <h2>Analytics</h2>
      <p>Campaign analytics show connection rate, completion rate, average call duration, and outcome breakdown. Export data as CSV.</p>

      <h2>Variables</h2>
      <p>Pass custom per-lead variables that get injected into the agent's system prompt:</p>
      <CodeBlock code={`System prompt: "You are calling {{lead_name}} about their {{product_interest}} inquiry."
Lead row: { lead_name: "Priya", product_interest: "enterprise plan" }`} language="json" />
    </div>
  );
}
