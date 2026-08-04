/**
 * /app/api-keys — API keys | Webhooks
 */
import { StripeTabPage } from "@/components/stripe-tab-page";
import ApiKeysPage from "@/pages/api-keys";
import WebhooksPage from "@/pages/webhooks";

export default function ApiKeysTabPage() {
  return (
    <StripeTabPage
      title="Developers"
      description="API keys and outbound webhooks for your workspace."
      defaultTab="api-keys"
      tabs={[
        { key: "api-keys", label: "API keys", content: <ApiKeysPage /> },
        { key: "webhooks", label: "Webhooks", content: <WebhooksPage /> },
      ]}
    />
  );
}
