import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { Layout } from "@/components/layout";

import NotFound from "@/pages/not-found";
import Login from "@/pages/login";
import Overview from "@/pages/overview";
import UsersList from "@/pages/users";
import UserDetail from "@/pages/user-detail";
import Finance from "@/pages/finance";
import Platform from "@/pages/platform";
import Growth from "@/pages/growth";
import ManagedKeys from "@/pages/managed-keys";
import ManagedNumbers from "@/pages/managed-numbers";
import Voices from "@/pages/voices";
import PlatformSettings from "@/pages/settings";
import PromptTemplatePage from "@/pages/prompt-template";
import AllAgentsPage from "@/pages/all-agents";
import SchedulingPage from "@/pages/scheduling";
import CallPricingPage from "@/pages/call-pricing";
import HealthChecklistPage from "@/pages/health";
import AmbientSoundsPage from "@/pages/ambient-sounds";

import UsageOverviewPage from "@/pages/usage/overview";
import ServicePage from "@/pages/usage/service";
import UsageUsersPage from "@/pages/usage/users";
import UsageWorkspacesPage from "@/pages/usage/workspaces";
import UsageHistoryPage from "@/pages/usage/history";
import PricingPage from "@/pages/usage/pricing";
import AllocationsPage from "@/pages/usage/allocations";
import AlertsPage from "@/pages/usage/alerts";

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
      <ProtectedRoute path="/users" component={UsersList} />
      <ProtectedRoute path="/users/:clerkId" component={UserDetail} />
      <ProtectedRoute path="/finance" component={Finance} />
      <ProtectedRoute path="/platform" component={Platform} />
      <ProtectedRoute path="/growth" component={Growth} />
      <ProtectedRoute path="/managed-keys" component={ManagedKeys} />
      <ProtectedRoute path="/managed-numbers" component={ManagedNumbers} />
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
      <ProtectedRoute path="/usage/alerts" component={AlertsPage} />

      <ProtectedRoute path="/prompt-template" component={PromptTemplatePage} />
      <ProtectedRoute path="/all-agents" component={AllAgentsPage} />
      <ProtectedRoute path="/scheduling" component={SchedulingPage} />
      <ProtectedRoute path="/call-pricing" component={CallPricingPage} />
      <ProtectedRoute path="/health" component={HealthChecklistPage} />
      <ProtectedRoute path="/ambient-sounds" component={AmbientSoundsPage} />
      <ProtectedRoute path="/settings" component={PlatformSettings} />

      {/* Family module — 4 sub-sections */}
      <ProtectedRoute path="/family/companies" component={FamilyCompaniesPage} />
      <ProtectedRoute path="/family/companies/:companyId/policies/:policyId" component={PolicyKBPage} />
      <ProtectedRoute path="/family/companies/:companyId" component={FamilyCompanyDetailPage} />
      {/* All agent routes → same Vapi-style unified page */}
      <ProtectedRoute path="/family/agents/new" component={FamilyAgentsPage} />
      <ProtectedRoute path="/family/agents/:id" component={FamilyAgentsPage} />
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
