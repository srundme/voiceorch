/**
 * /app/providers — Voices | Provider keys | My clones
 */
import { useLocation, useSearch } from "wouter";
import { StripeTabPage } from "@/components/stripe-tab-page";
import VoicesPage from "@/pages/voices";
import ProvidersList from "./index";
import { useVoiceClones } from "./my-clones-panel";

export default function ProvidersTabPage() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const activeTab = new URLSearchParams(search).get("tab") ?? "voices";
  const showCloneActions = activeTab === "voices" || activeTab === "my-clones";

  const revealClones = () => {
    const sp = new URLSearchParams(search);
    sp.set("tab", "my-clones");
    navigate(`${window.location.pathname}?${sp.toString()}`);
  };

  const clones = useVoiceClones(revealClones);

  return (
    <>
      <StripeTabPage
        title="Providers"
        description="Voice library and LLM / TTS / STT provider keys."
        defaultTab="voices"
        tabActions={showCloneActions ? clones.buttons : undefined}
        tabs={[
          { key: "voices", label: "Voices", content: <VoicesPage /> },
          {
            key: "provider-keys",
            label: "Provider keys",
            content: <ProvidersList />,
          },
          {
            key: "my-clones",
            label: "My clones",
            content: (
              <div className="max-w-[1400px] mx-auto px-10 py-10 space-y-6">
                {clones.panel}
              </div>
            ),
          },
        ]}
      />
      {clones.dialogs}
    </>
  );
}
