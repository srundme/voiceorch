/**
 * /app/campaigns — tabbed page
 * Tabs: Active (existing campaigns list) | Scheduled (AutomaticCalls) | Lead sources (MetaLeads)
 *
 * Deep-link routes like /app/campaigns/:id, /app/campaigns/:id/batches/* are handled
 * separately in App.tsx and do NOT use this tabbed wrapper.
 */
import { PageTabs } from "@/components/page-tabs";
import CampaignsPage from "./index";
import AutomaticCallsPage from "@/pages/automatic-calls/index";
import MetaLeadsPage from "@/pages/meta-leads";

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
          label: "Scheduled",
          content: <AutomaticCallsPage />,
        },
        {
          key: "lead-sources",
          label: "Lead sources",
          content: <MetaLeadsPage />,
        },
      ]}
    />
  );
}
