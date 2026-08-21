/**
 * /app/providers — Voices | Provider keys
 */
import { useLocation, useSearch } from "wouter";
import { StripeTabPage } from "@/components/stripe-tab-page";
import VoicesPage from "@/pages/voices";
import ProvidersList from "./index";
import { useVoiceClones } from "./my-clones-panel";

export default function ProvidersTabPage() {
  const [, navigate] = useLocation();
  const search = useSearch();

  const revealClones = () => {
    const sp = new URLSearchParams(search);
    sp.set("tab", "provider-keys");
    navigate(`${window.location.pathname}?${sp.toString()}`);
  };

  const clones = useVoiceClones(revealClones);

  return (
    <>
      <StripeTabPage
        title="Providers"
        description="Voice library and LLM / TTS / STT provider keys."
        defaultTab="voices"
        tabActions={clones.buttons}
        tabs={[
          { key: "voices", label: "Voices", content: <VoicesPage /> },
          {
            key: "provider-keys",
            label: "Provider keys",
            content: (
              <>
                <div className="max-w-[1400px] mx-auto px-10 pt-8">
                  {clones.panel}
                </div>
                <ProvidersList />
              </>
            ),
          },
        ]}
      />
      {clones.dialogs}
    </>
  );
}
