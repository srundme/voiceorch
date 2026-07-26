/**
 * /app/settings — tabbed page (renamed "General" in the nav)
 * Tabs: Workspace (existing settings page) | Team (existing team management page)
 */
import { PageTabs } from "@/components/page-tabs";
import Settings from "./index";
import TeamPage from "@/pages/team";

export default function SettingsTabPage() {
  return (
    <PageTabs
      defaultTab="workspace"
      tabs={[
        {
          key: "workspace",
          label: "Workspace",
          content: <Settings />,
        },
        {
          key: "team",
          label: "Team",
          content: <TeamPage />,
        },
      ]}
    />
  );
}
