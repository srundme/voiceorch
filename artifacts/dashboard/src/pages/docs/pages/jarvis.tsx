import { Link } from "wouter";
import { PageHeader } from "../DocsUi";

export default function JarvisPage() {
  return (
    <div>
      <PageHeader
        breadcrumb="Get started"
        title="Jarvis"
        updated="22 Aug 2026"
        description="The in-app Jarvis overlay has been removed. A new assistant plan is coming."
      />

      <p>
        Create an agent from <Link href="/docs/vibe">Vibe</Link> or the{" "}
        <Link href="/docs/agents">Agents builder</Link>.
      </p>
    </div>
  );
}
