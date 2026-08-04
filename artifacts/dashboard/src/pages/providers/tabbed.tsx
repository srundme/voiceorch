/**
 * /app/providers — Voices | Provider keys
 */
import { StripeTabPage } from "@/components/stripe-tab-page";
import VoicesPage from "@/pages/voices";
import ProvidersList from "./index";

export default function ProvidersTabPage() {
  return (
    <StripeTabPage
      title="Providers"
      description="Voice library and LLM / TTS / STT provider keys."
      defaultTab="voices"
      tabs={[
        { key: "voices", label: "Voices", content: <VoicesPage /> },
        { key: "provider-keys", label: "Provider keys", content: <ProvidersList /> },
      ]}
    />
  );
}
