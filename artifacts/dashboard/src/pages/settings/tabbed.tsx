/**
 * /app/settings — Workspace | Team
 */
import { StripeTabPage } from "@/components/stripe-tab-page";
import Settings from "./index";
import TeamPage from "@/pages/team";

export default function SettingsTabPage() {
  return (
    <StripeTabPage
      title="Workspace"
      description="Workspace profile and team access."
      defaultTab="workspace"
      tabs={[
        { key: "workspace", label: "Workspace", content: <Settings /> },
        { key: "team", label: "Team", content: <TeamPage /> },
      ]}
    />
  );
}
