import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { Layout } from "@/components/layout";

import NotFound from "@/pages/not-found";
import Login from "@/pages/login";
import Overview from "@/pages/overview";
import CallAnalyticsPage from "@/pages/call-analytics";
import UsersList from "@/pages/users";
import WorkspacesPage from "@/pages/customers/workspaces";
import PartnersPage from "@/pages/partners";
import UserDetail from "@/pages/user-detail";
import Finance from "@/pages/finance";
import Recharges from "@/pages/recharges";
import PhonePurchases from "@/pages/phone-purchases";
import Platform from "@/pages/platform";
import Growth from "@/pages/growth";
import BoardPulse from "@/pages/board/pulse";
import BoardGrowth from "@/pages/board/growth";
import BoardRetention from "@/pages/board/retention";
import BoardMoat from "@/pages/board/moat";
import BoardUnitEconomics from "@/pages/board/unit-economics";
import SignupsReport from "@/pages/reports/signups.tsx";
import EmailsReport from "@/pages/reports/emails.tsx";
import ManagedKeys from "@/pages/managed-keys";
import ManagedNumbers from "@/pages/managed-numbers";
import IntakeAgentPage from "@/pages/intake-agent";
import Voices from "@/pages/voices";
import PlatformSettings from "@/pages/settings";
import DpdpPage from "@/pages/dpdp";
import PromptTemplatePage from "@/pages/prompt-template";
import SystemPromptTemplatesPage from "@/pages/system-prompt-templates";
import AllAgentsPage from "@/pages/all-agents";
import AdminAgentEdit from "@/pages/admin-agent-edit";
import SchedulingPage from "@/pages/scheduling";
import GcalConnectionsPage from "@/pages/gcal-connections";
import CallPricingPage from "@/pages/call-pricing";
import HealthChecklistPage from "@/pages/health";
import AmbientSoundsPage from "@/pages/ambient-sounds";
import AuditLogsPage from "@/pages/audit-logs";
import DeploymentsPage from "@/pages/deployments";
import EmailsPage from "@/pages/emails";
import AnalyticsHub from "@/pages/hubs/analytics";
import MoneyHub from "@/pages/hubs/money";
import ControlHub from "@/pages/hubs/control";
import DailyPnlPage from "@/pages/analytics/daily-pnl";
import SaasOverviewPage from "@/pages/analytics/saas-overview";
import UnitEconomicsPage from "@/pages/analytics/unit-economics";
import {
  UserGrowthPage,
  ActivationPage,
  RetentionCohortsPage,
  AgentAnalyticsPage,
  ProviderAnalyticsPage,
} from "@/pages/analytics/saas";
import CostPricingOverviewPage from "@/pages/cost-pricing/overview";
import ProviderCostsPage from "@/pages/cost-pricing/provider-costs";
import CustomerPricingPage from "@/pages/cost-pricing/customer-pricing";
import { CostHistoryPage, PricingHistoryPage } from "@/pages/cost-pricing/history";
import ProfitSimulatorPage from "@/pages/cost-pricing/simulator";
import ProvidersControlPage from "@/pages/product/providers";
import ProductHubPage from "@/pages/product/overview";
import ProductIntegrationsPage from "@/pages/product/integrations";
import VoiceLivePage from "@/pages/voice/live";
import VoiceCall360Page from "@/pages/voice/call-360";
import VoiceFailuresPage from "@/pages/voice/failures";
import VoiceCallQualityPage from "@/pages/voice/call-quality";
import WalletsPage from "@/pages/revenue/wallets";
import AdminSettingsPage from "@/pages/settings/admin-settings";

import UsageOverviewPage from "@/pages/usage/overview";
import ServicePage from "@/pages/usage/service";
import UsageUsersPage from "@/pages/usage/users";
import UsageWorkspacesPage from "@/pages/usage/workspaces";
import UsageHistoryPage from "@/pages/usage/history";
import PricingPage from "@/pages/usage/pricing";
import AllocationsPage from "@/pages/usage/allocations";
import OperationsAlertsPage from "@/pages/operations/alerts";
import OperationsHealthPage from "@/pages/operations/health";

import EventsPage from "@/pages/events";
import EventDetailPage from "@/pages/events/[id]";
import VoiceathonEventsPage from "@/pages/voiceathon";
import VoiceathonEventDetailPage from "@/pages/voiceathon/[id]";
import NewVoiceathonEventPage from "@/pages/voiceathon/new";
import BookInternsPage from "@/pages/book-interns";
import LandingLeadsPage from "@/pages/landing-leads";
import TeamGuidesPage from "@/pages/team-guides";
import FamilyCompaniesPage from "@/pages/family/companies";
import FamilyCompanyDetailPage from "@/pages/family/company-detail";
import PolicyKBPage from "@/pages/family/policy-kb";
import FamilyAgentsPage from "@/pages/family/agents";
import FamilyAgentNewPage from "@/pages/family/agent-new";
import FamilyAgentDetailPage from "@/pages/family/agent-detail";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

function ProtectedRoute({ component: Component, ...rest }: { component: any; path?: string }) {
  const token = localStorage.getItem("adminToken");
  if (!token) {
    window.location.href = `${import.meta.env.BASE_URL}login`;
    return null;
  }
  return (
    <Route {...rest}>
      {(params) => (
        <Layout>
          <Component params={params} />
        </Layout>
      )}
    </Route>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <ProtectedRoute path="/" component={Overview} />
      <ProtectedRoute path="/analytics/daily-pnl" component={DailyPnlPage} />
      <ProtectedRoute path="/analytics/unit-economics" component={UnitEconomicsPage} />
      <ProtectedRoute path="/analytics/users" component={UserGrowthPage} />
      <ProtectedRoute path="/analytics/activation" component={ActivationPage} />
      <ProtectedRoute path="/analytics/retention" component={RetentionCohortsPage} />
      <ProtectedRoute path="/analytics/agents" component={AgentAnalyticsPage} />
      <ProtectedRoute path="/analytics/providers" component={ProviderAnalyticsPage} />
      <ProtectedRoute path="/analytics/hub" component={AnalyticsHub} />
      <ProtectedRoute path="/analytics" component={SaasOverviewPage} />
      <ProtectedRoute path="/cost-pricing/provider-costs" component={ProviderCostsPage} />
      <ProtectedRoute path="/cost-pricing/customer-pricing" component={CustomerPricingPage} />
      <ProtectedRoute path="/cost-pricing/cost-history" component={CostHistoryPage} />
      <ProtectedRoute path="/cost-pricing/pricing-history" component={PricingHistoryPage} />
      <ProtectedRoute path="/cost-pricing/simulator" component={ProfitSimulatorPage} />
      <ProtectedRoute path="/cost-pricing" component={CostPricingOverviewPage} />
      <ProtectedRoute path="/money" component={MoneyHub} />
      <ProtectedRoute path="/control" component={ControlHub} />
      <ProtectedRoute path="/call-analytics" component={CallAnalyticsPage} />
      <ProtectedRoute path="/users" component={UsersList} />
      <ProtectedRoute path="/partners" component={PartnersPage} />
      <ProtectedRoute path="/customers/workspaces" component={WorkspacesPage} />
      <ProtectedRoute path="/users/:clerkId" component={UserDetail} />
      <ProtectedRoute path="/users/:clerkId/agents/:agentId" component={AdminAgentEdit} />
      <ProtectedRoute path="/finance" component={Finance} />
      <ProtectedRoute path="/revenue/wallets" component={WalletsPage} />
      <ProtectedRoute path="/revenue/phone-numbers" component={PhonePurchases} />
      <ProtectedRoute path="/recharges" component={Recharges} />
      <ProtectedRoute path="/phone-purchases" component={PhonePurchases} />
      <ProtectedRoute path="/platform" component={Platform} />
      <ProtectedRoute path="/voice/live" component={VoiceLivePage} />
      <ProtectedRoute path="/voice/failures" component={VoiceFailuresPage} />
      <ProtectedRoute path="/voice/call-quality" component={VoiceCallQualityPage} />
      <ProtectedRoute path="/voice/calls/:callId" component={VoiceCall360Page} />
      <ProtectedRoute path="/growth" component={Growth} />
      <ProtectedRoute path="/board/pulse" component={BoardPulse} />
      <ProtectedRoute path="/board/growth" component={BoardGrowth} />
      <ProtectedRoute path="/board/retention" component={BoardRetention} />
      <ProtectedRoute path="/board/moat" component={BoardMoat} />
      <ProtectedRoute path="/board/unit-economics" component={BoardUnitEconomics} />
      <ProtectedRoute path="/reports/signups" component={SignupsReport} />
      <ProtectedRoute path="/reports/emails" component={EmailsReport} />
      <ProtectedRoute path="/managed-keys" component={ManagedKeys} />
      <ProtectedRoute path="/managed-numbers" component={ManagedNumbers} />
      <ProtectedRoute path="/demos/intake-agent" component={IntakeAgentPage} />
      <ProtectedRoute path="/product/providers" component={ProvidersControlPage} />
      <ProtectedRoute path="/product/voices" component={Voices} />
      <ProtectedRoute path="/product/prompt-templates" component={PromptTemplatePage} />
      <ProtectedRoute path="/product/system-prompts" component={SystemPromptTemplatesPage} />
      <ProtectedRoute path="/product/ambient-sounds" component={AmbientSoundsPage} />
      <ProtectedRoute path="/product/integrations/gcal" component={GcalConnectionsPage} />
      <ProtectedRoute path="/product/integrations" component={ProductIntegrationsPage} />
      <ProtectedRoute path="/product" component={ProductHubPage} />
      <ProtectedRoute path="/voices" component={Voices} />

      <ProtectedRoute path="/usage" component={UsageOverviewPage} />
      <ProtectedRoute path="/usage/stt" component={() => <ServicePage service="stt" />} />
      <ProtectedRoute path="/usage/tts" component={() => <ServicePage service="tts" />} />
      <ProtectedRoute path="/usage/llm" component={() => <ServicePage service="llm" />} />
      <ProtectedRoute path="/usage/users" component={UsageUsersPage} />
      <ProtectedRoute path="/usage/workspaces" component={UsageWorkspacesPage} />
      <ProtectedRoute path="/usage/history" component={UsageHistoryPage} />
      <ProtectedRoute path="/usage/pricing" component={PricingPage} />
      <ProtectedRoute path="/usage/allocations" component={AllocationsPage} />
      <ProtectedRoute path="/usage/alerts" component={OperationsAlertsPage} />
      <ProtectedRoute path="/operations/alerts" component={OperationsAlertsPage} />
      <ProtectedRoute path="/operations/health" component={OperationsHealthPage} />
      <ProtectedRoute path="/operations/deployments" component={DeploymentsPage} />
      <ProtectedRoute path="/operations/emails" component={EmailsPage} />
      <ProtectedRoute path="/operations/audit" component={AuditLogsPage} />

      <ProtectedRoute path="/prompt-template" component={PromptTemplatePage} />
      <ProtectedRoute path="/system-prompt-templates" component={SystemPromptTemplatesPage} />
      <ProtectedRoute path="/all-agents" component={AllAgentsPage} />
      <ProtectedRoute path="/scheduling" component={SchedulingPage} />
      <ProtectedRoute path="/gcal-connections" component={GcalConnectionsPage} />
      <ProtectedRoute path="/call-pricing" component={CallPricingPage} />
      <ProtectedRoute path="/health" component={HealthChecklistPage} />
      <ProtectedRoute path="/ambient-sounds" component={AmbientSoundsPage} />
      <ProtectedRoute path="/settings/admin" component={AdminSettingsPage} />
      <ProtectedRoute path="/settings" component={PlatformSettings} />
      <ProtectedRoute path="/dpdp" component={DpdpPage} />
      <ProtectedRoute path="/audit-logs" component={AuditLogsPage} />
      <ProtectedRoute path="/deployments" component={DeploymentsPage} />
      <ProtectedRoute path="/emails" component={EmailsPage} />

      {/* Workshops */}
      <ProtectedRoute path="/events/:id" component={EventDetailPage} />
      <ProtectedRoute path="/events" component={EventsPage} />

      {/* Voice-a-thons */}
      <ProtectedRoute path="/voiceathon/new" component={NewVoiceathonEventPage} />
      <ProtectedRoute path="/voiceathon/:id" component={VoiceathonEventDetailPage} />
      <ProtectedRoute path="/voiceathon" component={VoiceathonEventsPage} />

      {/* Engineering Programme */}
      <ProtectedRoute path="/book-interns" component={BookInternsPage} />
      <ProtectedRoute path="/landing-leads" component={LandingLeadsPage} />
      <ProtectedRoute path="/team-guides" component={TeamGuidesPage} />

      {/* Family module */}
      <ProtectedRoute path="/family/companies" component={FamilyCompaniesPage} />
      <ProtectedRoute path="/family/companies/:companyId/policies/:policyId" component={PolicyKBPage} />
      <ProtectedRoute path="/family/companies/:companyId" component={FamilyCompanyDetailPage} />
      <ProtectedRoute path="/family/agents/new" component={FamilyAgentNewPage} />
      <ProtectedRoute path="/family/agents/:id" component={FamilyAgentDetailPage} />
      <ProtectedRoute path="/family/agents" component={FamilyAgentsPage} />

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ThemeProvider defaultTheme="dark" storageKey="admin-ui-theme">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
