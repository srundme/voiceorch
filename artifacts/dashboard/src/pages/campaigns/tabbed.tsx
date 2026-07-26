/**
 * /app/campaigns — tabbed page
 * Tabs: Active | Automatic Calls (Google Sheets) | From Website (webhook + Meta/Instagram)
 *
 * Deep-link routes like /app/campaigns/:id, /app/campaigns/:id/batches/* are handled
 * separately in App.tsx and do NOT use this tabbed wrapper.
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
          label: "Active",
          content: <CampaignsPage />,
        },
        {
          key: "scheduled",
          label: "Automatic Calls",
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
