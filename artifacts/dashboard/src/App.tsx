import { useEffect, useRef, useState } from "react";
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
import PrivacyPage from "@/pages/privacy";
import TermsPage from "@/pages/terms";
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

function SignInPage() {
  const { signIn } = useAuth();
  const [, navigate] = useLocation();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const body: Record<string, string> = { email, password };
      if (mode === "register" && name.trim()) body.name = name.trim();
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json() as { token?: string; error?: string };
      if (!res.ok || !data.token) {
        setError(data.error ?? "Something went wrong. Please try again.");
      } else {
        signIn(data.token);
        navigate("/app");
      }
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-[420px] max-w-full rounded-2xl border border-zinc-800 bg-zinc-950/80 p-10 backdrop-blur-xl">
        <div className="flex flex-col items-center text-center">
          <img src={`${basePath}/logo.svg`} alt="SnapServe" className="mb-6 h-10 w-10" />
          <h1 className="text-xl font-semibold text-white">
            {mode === "login" ? "Welcome back" : "Create your account"}
          </h1>
          <p className="mt-2 text-sm text-zinc-400">
            {mode === "login"
              ? "Sign in to manage your voice agents."
              : "New here? You'll get $5 free credit to start building."}
          </p>
        </div>

        {error && (
          <div className="mt-6 rounded-lg border border-red-900/50 bg-red-950/40 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-3">
          {mode === "register" && (
            <input
              type="text"
              placeholder="Your name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm text-white placeholder-zinc-500 outline-none focus:border-zinc-500"
            />
          )}
          <input
            type="email"
            placeholder="Email address"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm text-white placeholder-zinc-500 outline-none focus:border-zinc-500"
          />
          <input
            type="password"
            placeholder="Password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm text-white placeholder-zinc-500 outline-none focus:border-zinc-500"
          />
          <Button
            type="submit"
            disabled={loading}
            className="mt-2 w-full bg-white font-semibold text-zinc-900 hover:bg-zinc-100 disabled:opacity-60"
          >
            {loading ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-zinc-500">
          {mode === "login" ? (
            <>
              No account?{" "}
              <button
                onClick={() => { setMode("register"); setError(null); }}
                className="text-zinc-300 underline underline-offset-2 hover:text-white"
              >
                Sign up free
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                onClick={() => { setMode("login"); setError(null); }}
                className="text-zinc-300 underline underline-offset-2 hover:text-white"
              >
                Sign in
              </button>
            </>
          )}
        </p>
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
          <Route path="/privacy" component={PrivacyPage} />
          <Route path="/terms" component={TermsPage} />
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
