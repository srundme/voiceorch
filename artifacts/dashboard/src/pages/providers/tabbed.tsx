/**
 * /app/providers — tabbed page (shown as "Voices and Providers" in the nav)
 * Tabs: Voices (voice library + cloning) | Provider keys (LLM / TTS / STT keys)
 */
import { PageTabs } from "@/components/page-tabs";
import VoicesPage from "@/pages/voices";
import ProvidersList from "./index";

export default function ProvidersTabPage() {
  return (
    <PageTabs
      defaultTab="voices"
      tabs={[
        {
          key: "voices",
          label: "Voices",
          content: <VoicesPage />,
        },
        {
          key: "provider-keys",
          label: "Provider keys",
          content: <ProvidersList />,
        },
      ]}
    />
  );
}
