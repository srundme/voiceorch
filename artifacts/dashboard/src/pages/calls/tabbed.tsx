/**
 * /app/calls — tabbed page
 * Tabs: All calls | Callbacks | Transfers
 *
 * /app/calls/:id continues to route directly to CallDetail (no tabs).
 */
import { PageTabs } from "@/components/page-tabs";
import CallsList from "./index";
import CallbacksPage from "@/pages/callbacks";
import TransfersPage from "@/pages/transfers";

export default function CallsTabPage() {
  return (
    <PageTabs
      defaultTab="all-calls"
      tabs={[
        {
          key: "all-calls",
          label: "All calls",
          content: <CallsList />,
        },
        {
          key: "callbacks",
          label: "Callbacks",
          content: <CallbacksPage />,
        },
        {
          key: "transfers",
          label: "Transfers",
          content: <TransfersPage />,
        },
      ]}
    />
  );
}
