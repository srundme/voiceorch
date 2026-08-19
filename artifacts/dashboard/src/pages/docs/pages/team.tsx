import { Link } from "wouter";
import { Callout, PageHeader } from "../DocsUi";

export default function TeamPage() {
  return (
    <div>
      <PageHeader
        breadcrumb="Account & compliance"
        title="Team workspace"
        updated="18 Aug 2026"
        description="Invite teammates to the same agents. Partner-managed clients never see SnapServe ads, docs, or support branding."
      />

      <h2 id="share">What is shared</h2>
      <p>
        A team invite shares <strong>agents</strong> and any <strong>phone numbers</strong> already
        on that workspace. Teammates can see and assign those numbers; they cannot buy or release
        them — purchase and billing stay on the owner account. Campaigns and wallet stay on the
        owner unless you explicitly work in that workspace. Sign-in uses an HttpOnly session cookie
        — do not put API keys in frontend JavaScript.
      </p>

      <h2 id="invite">Invites</h2>
      <p>
        Send an invite from workspace settings. The teammate opens the link with{" "}
        <code>?token=</code> and joins. They then see the shared agent list and can edit or test
        according to their role.
      </p>

      <h2 id="api">API keys vs dashboard</h2>
      <p>
        Dashboard users authenticate with the session cookie. Server integrations use{" "}
        <code>sk_live_…</code> — <Link href="/docs/authentication">Authentication</Link>. Do not mix
        them: a browser JWT is not a public API key.
      </p>

      <Callout variant="info" title="White-label partners">
        On a partner host, managed client workspaces must not show SnapServe documentation,
        SnapServe ads, or SnapServe support. Those users build agents in the classic builder, not
        the SnapServe-branded Vibe marketing surface. This docs site is only on{" "}
        <code>app.snapserve.ai</code>.
      </Callout>

      <h2 id="next">Next</h2>
      <p>
        Point teammates at <Link href="/docs/vibe">Vibe</Link> (direct SnapServe) or{" "}
        <Link href="/docs/agents">Agents &amp; builder</Link>.
      </p>
    </div>
  );
}
