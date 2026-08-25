/**
 * /app/api-keys — API keys | Event subscriptions
 * Tab key stays "webhooks" for deep links (?tab=webhooks).
 */
import { StripeTabPage } from "@/components/stripe-tab-page";
import ApiKeysPage from "@/pages/api-keys";
import WebhooksPage from "@/pages/webhooks";
import { hostProductName } from "@/lib/white-label";

export default function ApiKeysTabPage() {
  const product = hostProductName();
  return (
    <StripeTabPage
      title="Developers"
      description={`API keys and workspace event subscriptions (${product} → your app).`}
      defaultTab="api-keys"
      tabs={[
        { key: "api-keys", label: "API keys", content: <ApiKeysPage /> },
        { key: "webhooks", label: "Event subscriptions", content: <WebhooksPage /> },
      ]}
    />
  );
}
