import { lazy, Suspense } from "react";
import { useRoute } from "wouter";
import { DocsLayout } from "./DocsLayout";
import IntroductionPage from "./pages/introduction";
import QuickStartPage from "./pages/quick-start";
import AuthenticationPage from "./pages/authentication";
import AgentsPage from "./pages/agents";
import OutboundCallsPage from "./pages/outbound-calls";
import WebhooksPage from "./pages/webhooks";
import PhoneNumbersPage from "./pages/phone-numbers";
import WalletPage from "./pages/wallet";
import SdksPage from "./pages/sdks";
import ErrorsPage from "./pages/errors";
import PricingPage from "./pages/pricing";
import ChangelogPage from "./pages/changelog";

const ApiReference = lazy(() => import("./api/ApiReference"));

function ApiReferenceFallback() {
  return (
    <div className="min-h-screen bg-[#0B0D12] flex items-center justify-center text-muted-foreground text-sm">
      Loading API reference…
    </div>
  );
}

/** Old product-doc slugs → nearest developer guide */
const LEGACY_REDIRECTS: Record<string, string> = {
  "platform-concepts": "introduction",
  "agent-builder": "agents",
  "prompting-guide": "agents",
  "tools": "agents",
  "knowledge-base": "agents",
  "providers": "introduction",
  "asr-providers": "introduction",
  "llm-providers": "introduction",
  "tts-providers": "introduction",
  "telephony-providers": "phone-numbers",
  "campaigns": "outbound-calls",
  "managing-leads": "outbound-calls",
  "scheduling": "introduction",
  "google-calendar": "introduction",
};

export default function DocsPage() {
  const [isApiRef, apiParams] = useRoute("/docs/api-reference/:op?");
  const [, params] = useRoute("/docs/:section?");

  if (isApiRef) {
    return (
      <Suspense fallback={<ApiReferenceFallback />}>
        <ApiReference operationId={apiParams?.op} />
      </Suspense>
    );
  }

  let section = params?.section || "introduction";
  if (LEGACY_REDIRECTS[section]) {
    section = LEGACY_REDIRECTS[section];
  }

  let Content: React.ComponentType;
  switch (section) {
    case "introduction":    Content = IntroductionPage; break;
    case "quick-start":     Content = QuickStartPage; break;
    case "authentication":  Content = AuthenticationPage; break;
    case "agents":          Content = AgentsPage; break;
    case "outbound-calls":  Content = OutboundCallsPage; break;
    case "webhooks":        Content = WebhooksPage; break;
    case "phone-numbers":   Content = PhoneNumbersPage; break;
    case "wallet":          Content = WalletPage; break;
    case "sdks":            Content = SdksPage; break;
    case "errors":          Content = ErrorsPage; break;
    case "pricing":         Content = PricingPage; break;
    case "changelog":       Content = ChangelogPage; break;
    default:
      Content = () => (
        <div className="py-20 text-center">
          <h1 className="text-2xl font-semibold mb-2">Page not found</h1>
          <p className="text-muted-foreground">The documentation page you are looking for does not exist.</p>
        </div>
      );
  }

  return (
    <DocsLayout section={section}>
      <Content />
    </DocsLayout>
  );
}
