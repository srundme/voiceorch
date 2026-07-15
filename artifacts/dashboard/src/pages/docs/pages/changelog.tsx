import { PageHeader } from "../DocsUi";

export default function ChangelogPage() {
  return (
    <div>
      <PageHeader
        breadcrumb="Reference"
        title="Changelog"
        description="Notable platform and documentation changes for API consumers."
      />

      <h2 id="2026-07-15">2026-07-15</h2>
      <ul>
        <li>
          <strong>Developer docs rebuild</strong> — <code>/docs</code> is focused on building apps
          against the SnapServe API (auth, outbound calls, webhooks, SDKs), with Bolna-style
          navigation, method badges, and copy-paste endpoint blocks.
        </li>
        <li>
          <strong>API key auth</strong> — <code>Authorization: Bearer sk_live_…</code> is honored on
          the public API (in addition to dashboard session JWTs).
        </li>
        <li>
          <strong>INR billing</strong> — wallet and pricing are INR (paise). Welcome credit ₹500;
          flat ₹5/min; phone numbers ₹800 + 18% GST; card checkout only.
        </li>
      </ul>

      <h2 id="earlier">Earlier</h2>
      <p>
        Agent builder, multi-provider orchestration, campaigns, scheduling, and telephony
        integrations shipped previously. Product UI changes are announced in-app; this page tracks
        API consumer impact.
      </p>
    </div>
  );
}
