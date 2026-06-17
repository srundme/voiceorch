import { useRoute } from "wouter";
import { DocsLayout } from "./DocsLayout";
import IntroductionPage from "./pages/introduction";
import PlatformConceptsPage from "./pages/platform-concepts";
import QuickStartPage from "./pages/quick-start";
import AuthenticationPage from "./pages/authentication";
import AgentsPage from "./pages/agents";
import AgentBuilderPage from "./pages/agent-builder";
import PromptingGuidePage from "./pages/prompting-guide";
import ToolsPage from "./pages/tools";
import KnowledgeBasePage from "./pages/knowledge-base";
import ProvidersPage from "./pages/providers";
import AsrProvidersPage from "./pages/asr-providers";
import LlmProvidersPage from "./pages/llm-providers";
import TtsProvidersPage from "./pages/tts-providers";
import TelephonyProvidersPage from "./pages/telephony-providers";
import CampaignsPage from "./pages/campaigns";
import ManagingLeadsPage from "./pages/managing-leads";
import SchedulingPage from "./pages/scheduling";
import GoogleCalendarPage from "./pages/google-calendar";
import WebhooksPage from "./pages/webhooks";
import ApiReferencePage from "./pages/api-reference";
import PricingPage from "./pages/pricing";
import ChangelogPage from "./pages/changelog";

export default function DocsPage() {
  const [, params] = useRoute("/docs/:section?");
  const section = params?.section || "introduction";

  let Content: React.ComponentType;
  switch (section) {
    case "introduction":       Content = IntroductionPage; break;
    case "platform-concepts":  Content = PlatformConceptsPage; break;
    case "quick-start":        Content = QuickStartPage; break;
    case "authentication":     Content = AuthenticationPage; break;
    case "agents":             Content = AgentsPage; break;
    case "agent-builder":      Content = AgentBuilderPage; break;
    case "prompting-guide":    Content = PromptingGuidePage; break;
    case "tools":              Content = ToolsPage; break;
    case "knowledge-base":     Content = KnowledgeBasePage; break;
    case "providers":          Content = ProvidersPage; break;
    case "asr-providers":      Content = AsrProvidersPage; break;
    case "llm-providers":      Content = LlmProvidersPage; break;
    case "tts-providers":      Content = TtsProvidersPage; break;
    case "telephony-providers":Content = TelephonyProvidersPage; break;
    case "campaigns":          Content = CampaignsPage; break;
    case "managing-leads":     Content = ManagingLeadsPage; break;
    case "scheduling":         Content = SchedulingPage; break;
    case "google-calendar":    Content = GoogleCalendarPage; break;
    case "webhooks":           Content = WebhooksPage; break;
    case "api-reference":      Content = ApiReferencePage; break;
    case "pricing":            Content = PricingPage; break;
    case "changelog":          Content = ChangelogPage; break;
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
