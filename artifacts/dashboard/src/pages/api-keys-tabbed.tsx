/**
 * /app/api-keys — tabbed page (shown as "Developers" in the nav)
 * Tabs: API keys | Webhooks
 */
import { PageTabs } from "@/components/page-tabs";
import ApiKeysPage from "@/pages/api-keys";
import WebhooksPage from "@/pages/webhooks";

export default function ApiKeysTabPage() {
  return (
    <PageTabs
      defaultTab="api-keys"
      tabs={[
        {
          key: "api-keys",
          label: "API keys",
          content: <ApiKeysPage />,
        },
        {
          key: "webhooks",
          label: "Webhooks",
          content: <WebhooksPage />,
        },
      ]}
    />
  );
}
