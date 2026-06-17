import { useRoute } from "wouter";
import { DocsLayout } from "./DocsLayout";
import IntroductionPage from "./pages/introduction";
import QuickStartPage from "./pages/quick-start";
import AuthenticationPage from "./pages/authentication";
import AgentsPage from "./pages/agents";
import ProvidersPage from "./pages/providers";
import SchedulingPage from "./pages/scheduling";
import CampaignsPage from "./pages/campaigns";
import ApiReferencePage from "./pages/api-reference";
import ChangelogPage from "./pages/changelog";

export default function DocsPage() {
  const [, params] = useRoute("/docs/:section?");
  const section = params?.section || "introduction";

  let Content = IntroductionPage;
  switch (section) {
    case "introduction":
      Content = IntroductionPage;
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
    case "providers":
      Content = ProvidersPage;
      break;
    case "scheduling":
      Content = SchedulingPage;
      break;
    case "campaigns":
      Content = CampaignsPage;
      break;
    case "api-reference":
      Content = ApiReferencePage;
      break;
    case "changelog":
      Content = ChangelogPage;
      break;
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
