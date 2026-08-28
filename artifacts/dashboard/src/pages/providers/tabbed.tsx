/**
 * /app/providers — Provider keys | Voices | My clones
 */
import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { Plus } from "lucide-react";
import { StripeTabPage } from "@/components/stripe-tab-page";
import { Button } from "@/components/ui/button";
import VoicesPage from "@/pages/voices";
import ProvidersList from "./index";
import { useVoiceClones } from "./my-clones-panel";

const DEFAULT_PROVIDERS_TAB = "provider-keys";

export default function ProvidersTabPage() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const tabParam = new URLSearchParams(search).get("tab");
  const activeTab = tabParam ?? DEFAULT_PROVIDERS_TAB;
  const showCloneActions = activeTab === "voices" || activeTab === "my-clones";
  const showProviderActions = activeTab === "provider-keys";
  const [addProviderOpen, setAddProviderOpen] = useState(false);

  // Bare /app/providers (no ?tab=) → Provider keys. Keeps side-nav and deep links consistent.
  useEffect(() => {
    if (tabParam) return;
    const sp = new URLSearchParams(search);
    sp.set("tab", DEFAULT_PROVIDERS_TAB);
    navigate(`${window.location.pathname}?${sp.toString()}`, { replace: true });
  }, [tabParam, search, navigate]);

  const revealClones = () => {
    const sp = new URLSearchParams(search);
    sp.set("tab", "my-clones");
    navigate(`${window.location.pathname}?${sp.toString()}`);
  };

  const clones = useVoiceClones(revealClones);

  const providerKeyActions = (
    <Button
      onClick={() => setAddProviderOpen(true)}
      className="gap-1.5 h-9 min-h-9 text-xs sm:text-[13px]"
      data-testid="button-add-provider"
    >
      <Plus className="h-3.5 w-3.5" />
      Add Provider
    </Button>
  );

  return (
    <>
      <StripeTabPage
        title="Providers"
        description="Voice library and LLM / TTS / STT provider keys."
        defaultTab={DEFAULT_PROVIDERS_TAB}
        tabActions={
          showCloneActions
            ? clones.buttons
            : showProviderActions
              ? providerKeyActions
              : undefined
        }
        tabs={[
          {
            key: "provider-keys",
            label: "Provider keys",
            content: (
              <ProvidersList
                hideInlineAddButton
                addOpen={addProviderOpen}
                onAddOpenChange={setAddProviderOpen}
              />
            ),
          },
          { key: "voices", label: "Voices", content: <VoicesPage /> },
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
