import { useEffect, useRef } from "react";
import { Switch, Route, Router as WouterRouter, useLocation, Redirect } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { AuthProvider, useAuth, SignedIn, SignedOut } from "@/lib/auth";
import { setAuthTokenGetter, setDefaultTimeoutMs, useGetOnboardingStatus } from "@workspace/api-client-react";
import { Toaster } from "@/components/ui/toaster";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeSync } from "@/components/theme-sync";

import { Layout } from "@/components/layout";
import { SnapServeLoader } from "@/components/logo";
import { VoiceAssistant } from "@/components/VoiceAssistant";
import LandingPage from "@/pages/landing";
import AssistantsPage from "@/pages/assistants";
import Dashboard from "@/pages/dashboard";
import AgentsList from "@/pages/agents/index";
import AgentNew from "@/pages/agents/new";
import AgentDetail from "@/pages/agents/[id]";
import AgentEdit from "@/pages/agents/edit";
import CallsList from "@/pages/calls/index";
import CallDetail from "@/pages/calls/[id]";
import ProvidersList from "@/pages/providers/index";
import Settings from "@/pages/settings/index";
import ConferencingPage from "@/pages/settings/Conferencing";
import KnowledgeBasePage from "@/pages/knowledge-base";
import WalletPage from "@/pages/wallet";
import ActivityPage from "@/pages/activity";
import PhoneNumbersPage from "@/pages/phone-numbers";
import WebhooksPage from "@/pages/webhooks";
import AgentAnalyticsPage from "@/pages/agent-analytics";
import AnalyticsPage from "@/pages/analytics";
import NotFound from "@/pages/not-found";
import OnboardingPage from "@/pages/onboarding";
import CampaignsPage from "@/pages/campaigns/index";
import CampaignDetailPage from "@/pages/campaigns/[id]";
import BatchDetailPage from "@/pages/campaigns/[id]/batches/[batchId]";
import BatchWizardPage from "@/pages/campaigns/batch-wizard";
import CampaignLeadProfilePage from "@/pages/campaigns/[id]/leads/[leadId]";
import SchedulingPage from "@/pages/scheduling/index";
import SchedulingCalendarsPage from "@/pages/scheduling/Calendars";
import SchedulingEventTypesPage from "@/pages/scheduling/EventTypes";
import SchedulingEventTypeDetailPage from "@/pages/scheduling/EventTypeDetail";
import SchedulingAvailabilityPage from "@/pages/scheduling/Availability";
import SchedulingBookingDetailPage from "@/pages/scheduling/Bookings";
import PublicBookingPage from "@/pages/book/[slug]";
import CancelBookingPage from "@/pages/book/cancel";
import RescheduleBookingPage from "@/pages/book/reschedule";
import UsagePage from "@/pages/usage";
import KycPage from "@/pages/kyc";
import ApiKeysPage from "@/pages/api-keys";
import MetaLeadsPage from "@/pages/meta-leads";
import TransfersPage from "@/pages/transfers";
import VoicesPage from "@/pages/voices";
import TestSimulatorPage from "@/pages/test-simulator";
import CommandCenterPage from "@/pages/command-center/index";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false },
  },
});

// Apply persisted request-timeout preference immediately on load.
const TIMEOUT_STORAGE_KEY = "voiceorch:requestTimeoutMs";
const _storedTimeout = localStorage.getItem(TIMEOUT_STORAGE_KEY);
if (_storedTimeout !== null) {
  setDefaultTimeoutMs(Number(_storedTimeout));
}

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function AuthTokenSync() {
  const { getToken } = useAuth();
  useEffect(() => {
    setAuthTokenGetter(() => getToken());
    return () => setAuthTokenGetter(null);
  }, [getToken]);
  return null;
}

function QueryClientCacheInvalidator() {
  const { userId } = useAuth();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
      qc.clear();
    }
    prevUserIdRef.current = userId;
  }, [userId, qc]);

  return null;
}

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09Z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.23 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z" />
    </svg>
  );
}

function SignInPage() {
  const { signIn } = useAuth();
  const authError =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("auth_error");

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-[420px] max-w-full rounded-2xl border border-zinc-800 bg-zinc-950/80 p-10 backdrop-blur-xl">
        <div className="flex flex-col items-center text-center">
          <img src={`${basePath}/logo.svg`} alt="SnapServe" className="mb-6 h-10 w-10" />
          <h1 className="text-xl font-semibold text-white">Welcome to SnapServe</h1>
          <p className="mt-2 text-sm text-zinc-400">
            Sign in to manage your voice agents. New here? You'll get $5 free credit to start building.
          </p>
        </div>

        {authError && (
          <div className="mt-6 rounded-lg border border-red-900/50 bg-red-950/40 px-4 py-3 text-sm text-red-300">
            We couldn't sign you in. Please try again.
          </div>
        )}

        <Button
          onClick={signIn}
          className="mt-8 flex w-full items-center justify-center gap-3 bg-zinc-100 font-semibold text-zinc-900 hover:bg-white"
        >
          <GoogleGlyph />
          Continue with Google
        </Button>
      </div>
    </div>
  );
}

function HomeRedirect() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <SnapServeLoader />;
  return isSignedIn ? <Redirect to="/app" /> : <LandingPage />;
}

function AppRoutes() {
  const [location] = useLocation();
  const { data: onboardingStatus, isLoading: onboardingLoading } = useGetOnboardingStatus();

  // Don't gate until we know the status
  if (onboardingLoading) {
    return <SnapServeLoader />;
  }

  // Redirect new users to onboarding (except if they're already there)
  const onOnboardingPage = location.startsWith("/app/onboarding");
  if (!onboardingStatus?.completed && !onOnboardingPage) {
    return <Redirect to="/app/onboarding" />;
  }

  return (
    <Layout>
      <VoiceAssistant />
      <Switch>
        <Route path="/app" component={() => <Redirect to="/app/command-center" />} />
        <Route path="/app/command-center" component={CommandCenterPage} />
        <Route path="/app/analytics" component={AnalyticsPage} />
        <Route path="/app/agents" component={AssistantsPage} />
        <Route path="/app/agents/new" component={AgentNew} />
        <Route path="/app/agents/:id/edit" component={AgentEdit} />
        <Route path="/app/agents/:id" component={AgentDetail} />
        <Route path="/app/calls" component={CallsList} />
        <Route path="/app/calls/:id" component={CallDetail} />
        <Route path="/app/knowledge-bases" component={KnowledgeBasePage} />
        <Route path="/app/providers" component={ProvidersList} />
        <Route path="/app/wallet" component={WalletPage} />
        <Route path="/app/activity" component={ActivityPage} />
        <Route path="/app/phone-numbers" component={PhoneNumbersPage} />
        <Route path="/app/webhooks" component={WebhooksPage} />
        <Route path="/app/analytics/agents/:id" component={AgentAnalyticsPage} />
        <Route path="/app/campaigns/:id/leads/:leadId" component={CampaignLeadProfilePage} />
        <Route path="/app/campaigns/:id/batches/new" component={BatchWizardPage} />
        <Route path="/app/campaigns/:id/batches/:batchId" component={BatchDetailPage} />
        <Route path="/app/campaigns/:id" component={CampaignDetailPage} />
        <Route path="/app/campaigns" component={CampaignsPage} />
        <Route path="/app/scheduling/bookings/:id" component={SchedulingBookingDetailPage} />
        <Route path="/app/scheduling/calendars" component={() => <SchedulingCalendarsPage />} />
        <Route path="/app/scheduling/event-types/:id" component={SchedulingEventTypeDetailPage} />
        <Route path="/app/scheduling/event-types" component={SchedulingEventTypesPage} />
        <Route path="/app/scheduling/availability" component={SchedulingAvailabilityPage} />
        <Route path="/app/scheduling" component={SchedulingPage} />
        <Route path="/app/settings/calendar" component={Settings} />
        <Route path="/app/settings/conferencing" component={Settings} />
        <Route path="/app/settings" component={Settings} />
        <Route path="/app/usage" component={UsagePage} />
        <Route path="/app/kyc" component={KycPage} />
        <Route path="/app/api-keys" component={ApiKeysPage} />
        <Route path="/app/meta-leads" component={MetaLeadsPage} />
        <Route path="/app/transfers" component={TransfersPage} />
        <Route path="/app/voices" component={VoicesPage} />
        <Route path="/app/test-simulator" component={TestSimulatorPage} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function ProtectedApp() {
  const { isLoaded } = useAuth();
  if (!isLoaded) return <SnapServeLoader />;
  return (
    <>
      <SignedIn>
        <Switch>
          {/* Onboarding is full-screen — no sidebar layout */}
          <Route path="/app/onboarding" component={OnboardingPage} />
          {/* All other /app/* routes go through the onboarding gate + Layout */}
          <Route path="/app/*?" component={AppRoutes} />
        </Switch>
      </SignedIn>
      <SignedOut>
        <Redirect to="/" />
      </SignedOut>
    </>
  );
}

function Router() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <AuthTokenSync />
        <QueryClientCacheInvalidator />
        <ThemeSync />
        <Switch>
          <Route path="/" component={HomeRedirect} />
          <Route path="/sign-in/*?" component={SignInPage} />
          <Route path="/sign-up/*?" component={SignInPage} />
          <Route path="/app/*?" component={ProtectedApp} />
          <Route path="/book/cancel" component={CancelBookingPage} />
          <Route path="/book/reschedule" component={RescheduleBookingPage} />
          <Route path="/book/:slug" component={PublicBookingPage} />
          <Route component={NotFound} />
        </Switch>
      </QueryClientProvider>
    </AuthProvider>
  );
}

function App() {
  return (
    <ThemeProvider defaultTheme="dark" storageKey="snapserve-ui-theme">
      <TooltipProvider>
        <WouterRouter base={basePath}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </ThemeProvider>
  );
}

export default App;
