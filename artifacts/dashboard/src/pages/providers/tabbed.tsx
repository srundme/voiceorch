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
        tabActions={clones.buttons}
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
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-4 sm:px-0">
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Create and manage custom voice clones using Cartesia Sonic or Sarvam Creative Studio.
                    </p>
                    <p className="text-[13px] mt-1 text-muted-foreground/60 max-w-[520px]">
                      Custom voice clones can be selected across all your AI voice agents and phone campaigns.
                    </p>
                  </div>
                </div>
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
