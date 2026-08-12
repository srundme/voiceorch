import { lazy, Suspense } from "react";
import { useRoute } from "wouter";
import { DocsLayout } from "./DocsLayout";
import IntroductionPage from "./pages/introduction";
import WhatYouCanBuildPage from "./pages/what-you-can-build";
import PlatformConceptsPage from "./pages/platform-concepts";
import QuickStartPage from "./pages/quick-start";
import AuthenticationPage from "./pages/authentication";
import AgentsPage from "./pages/agents";
import VariablesPage from "./pages/variables";
import KnowledgeBasePage from "./pages/knowledge-base";
import CalendarPage from "./pages/calendar";
import MeetingsPage from "./pages/meetings";
import OutboundCallsPage from "./pages/outbound-calls";
import CampaignsPage from "./pages/campaigns";
import WebhooksPage from "./pages/webhooks";
import PhoneNumbersPage from "./pages/phone-numbers";
import WalletPage from "./pages/wallet";
import SdksPage from "./pages/sdks";
import ClaudeSkillPage from "./pages/claude-skill";
import ErrorsPage from "./pages/errors";
import PricingPage from "./pages/pricing";
import FaqPage from "./pages/faq";
import ChangelogPage from "./pages/changelog";

const ApiReference = lazy(() => import("./api/ApiReference"));

function ApiReferenceFallback() {
  return (
    <div className="min-h-screen bg-white flex items-center justify-center text-muted-foreground text-sm">
      Loading API reference…
    </div>
  );
}

/** Old slugs → current learning pages */
const LEGACY_REDIRECTS: Record<string, string> = {
  "agent-builder": "agents",
  "prompting-guide": "agents",
  "tools": "agents",
  "providers": "platform-concepts",
  "asr-providers": "platform-concepts",
  "llm-providers": "platform-concepts",
  "tts-providers": "platform-concepts",
  "telephony-providers": "phone-numbers",
  "managing-leads": "campaigns",
  "scheduling": "calendar",
  "google-calendar": "calendar",
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
    case "introduction":
      Content = IntroductionPage;
      break;
    case "what-you-can-build":
      Content = WhatYouCanBuildPage;
      break;
    case "platform-concepts":
      Content = PlatformConceptsPage;
      break;
    case "quick-start":
      Content = QuickStartPage;
      break;
    case "authentication":
      Content = AuthenticationPage;
      break;
    case "agents":
      Content = AgentsPage;
      break;
    case "variables":
      Content = VariablesPage;
      break;
    case "knowledge-base":
      Content = KnowledgeBasePage;
      break;
    case "calendar":
      Content = CalendarPage;
      break;
    case "meetings":
      Content = MeetingsPage;
      break;
    case "outbound-calls":
      Content = OutboundCallsPage;
      break;
    case "campaigns":
      Content = CampaignsPage;
      break;
    case "webhooks":
      Content = WebhooksPage;
      break;
    case "phone-numbers":
      Content = PhoneNumbersPage;
      break;
    case "wallet":
      Content = WalletPage;
      break;
    case "sdks":
      Content = SdksPage;
      break;
    case "claude-skill":
      Content = ClaudeSkillPage;
      break;
    case "errors":
      Content = ErrorsPage;
      break;
    case "pricing":
      Content = PricingPage;
      break;
    case "faq":
      Content = FaqPage;
      break;
    case "changelog":
      Content = ChangelogPage;
      break;
    default:
      Content = () => (
        <div className="py-20 text-center">
          <h1 className="text-2xl font-semibold mb-2">Page not found</h1>
          <p className="text-muted-foreground">
            The documentation page you are looking for does not exist.
          </p>
        </div>
      );
  }

  return (
    <DocsLayout section={section}>
      <Content />
    </DocsLayout>
  );
}
