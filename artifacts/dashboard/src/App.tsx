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
    <div style={{ minHeight: "100vh", background: "#0e0f14", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 16px" }}>
      <div style={{ width: 440, maxWidth: "100%", background: "#161720", borderRadius: 20, padding: "40px 36px 36px", boxShadow: "0 24px 64px rgba(0,0,0,0.5)" }}>

        {/* Icon */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 24 }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: "#162a1e", border: "1px solid rgba(74,222,128,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="13" cy="13" r="5" stroke="#4ade80" strokeWidth="1.6"/>
              <line x1="13" y1="2" x2="13" y2="7" stroke="#4ade80" strokeWidth="1.6" strokeLinecap="round"/>
              <line x1="13" y1="19" x2="13" y2="24" stroke="#4ade80" strokeWidth="1.6" strokeLinecap="round"/>
              <line x1="2" y1="13" x2="7" y2="13" stroke="#4ade80" strokeWidth="1.6" strokeLinecap="round"/>
              <line x1="19" y1="13" x2="24" y2="13" stroke="#4ade80" strokeWidth="1.6" strokeLinecap="round"/>
              <circle cx="13" cy="13" r="1.8" fill="#4ade80"/>
            </svg>
          </div>
        </div>

        {/* Heading */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <h1 style={{ fontWeight: 700, fontSize: "1.25rem", color: "#fff", letterSpacing: "-0.3px", marginBottom: 8 }}>
            {mode === "login" ? "Welcome back" : "Create your account"}
          </h1>
          <p style={{ fontSize: "0.875rem", color: "#5a5c6e", lineHeight: 1.5 }}>
            {mode === "login"
              ? "Sign in to manage your voice agents."
              : "New here? You'll get $5 free credit to start building."}
          </p>
        </div>

        {/* Error */}
        {error && (
          <div style={{ marginBottom: 16, padding: "10px 14px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 10, fontSize: "0.8rem", color: "#fca5a5" }}>
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {mode === "register" && (
            <input
              type="text"
              placeholder="Your name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{ width: "100%", background: "#1f2030", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "14px 16px", fontSize: "0.9rem", color: "#fff", outline: "none", transition: "border-color .15s" }}
              onFocus={e => { e.currentTarget.style.borderColor = "rgba(74,222,128,0.3)"; }}
              onBlur={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)"; }}
            />
          )}
          <input
            type="email"
            placeholder="Email address"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ width: "100%", background: "#1f2030", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "14px 16px", fontSize: "0.9rem", color: "#fff", outline: "none", transition: "border-color .15s" }}
            onFocus={e => { e.currentTarget.style.borderColor = "rgba(74,222,128,0.3)"; }}
            onBlur={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)"; }}
          />
          <input
            type="password"
            placeholder="Password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ width: "100%", background: "#1f2030", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: "14px 16px", fontSize: "0.9rem", color: "#fff", outline: "none", transition: "border-color .15s" }}
            onFocus={e => { e.currentTarget.style.borderColor = "rgba(74,222,128,0.3)"; }}
            onBlur={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)"; }}
          />
          <button
            type="submit"
            disabled={loading}
            style={{ marginTop: 6, width: "100%", background: loading ? "#d4d4d4" : "#fff", color: "#0e0f14", fontWeight: 700, fontSize: "0.9rem", padding: "14px 0", borderRadius: 12, border: "none", cursor: loading ? "not-allowed" : "pointer", transition: "background .15s", letterSpacing: "-0.1px" }}
            onMouseEnter={e => { if (!loading) e.currentTarget.style.background = "#e8e8e8"; }}
            onMouseLeave={e => { if (!loading) e.currentTarget.style.background = "#fff"; }}
          >
            {loading ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>

        {/* Footer */}
        <p style={{ marginTop: 22, textAlign: "center", fontSize: "0.85rem", color: "#44475a" }}>
          {mode === "login" ? (
            <>
              No account?{" "}
              <button
                onClick={() => { setMode("register"); setError(null); }}
                style={{ background: "none", border: "none", color: "#a0a3b8", cursor: "pointer", fontSize: "0.85rem", textDecoration: "underline", textUnderlineOffset: 3, padding: 0 }}
              >
                Sign up free
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                onClick={() => { setMode("login"); setError(null); }}
                style={{ background: "none", border: "none", color: "#a0a3b8", cursor: "pointer", fontSize: "0.85rem", textDecoration: "underline", textUnderlineOffset: 3, padding: 0 }}
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
  return <Redirect to={isSignedIn ? "/app" : "/sign-in"} />;
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
