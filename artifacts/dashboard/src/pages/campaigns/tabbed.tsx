/**
 * /app/campaigns — tabbed page (account-wide dial flows)
 * Tabs: Active | Sheet dial | From Website
 *
 * Prefer Agent → Reach for new setups. Deep-link routes like /app/campaigns/:id
 * are handled separately in App.tsx and do NOT use this tabbed wrapper.
 */
import { PageTabs } from "@/components/page-tabs";
import CampaignsPage from "./index";
import AutomaticCallsPage from "@/pages/automatic-calls/index";
import FromWebsitePage from "./from-website";

export default function CampaignsTabPage() {
  return (
    <PageTabs
      defaultTab="active"
      tabs={[
        {
          key: "active",
          label: "List dials",
          content: <CampaignsPage />,
        },
        {
          key: "scheduled",
          label: "Sheet dial",
          content: <AutomaticCallsPage />,
        },
        {
          key: "lead-sources",
          label: "From Website",
          content: <FromWebsitePage />,
        },
      ]}
    />
  );
}
