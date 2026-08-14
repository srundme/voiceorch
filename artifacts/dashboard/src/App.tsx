import { useEffect, useRef, useState } from "react";
import { Switch, Route, Router as WouterRouter, useLocation, Redirect, Link } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { AuthProvider, useAuth, SignedIn, SignedOut, consumeSignOutReason } from "@/lib/auth";
import { DotGridBackground } from "@/components/ui/dot-grid-background";
import { setAuthTokenGetter, setDefaultTimeoutMs, setUnauthorizedHandler, useGetOnboardingStatus, useListAgents } from "@workspace/api-client-react";
import { Toaster } from "@/components/ui/toaster";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeSync } from "@/components/theme-sync";

import { Layout } from "@/components/layout";
import { recordInAppNavigation } from "@/lib/nav-history";
import { SnapServeLoader, PoweredBySarvam } from "@/components/logo";
import { VoiceAssistant } from "@/components/VoiceAssistant";

// ── Page imports ─────────────────────────────────────────────────────────────
// Tabbed wrappers (new routes)
import AgentsTabPage, { AgentBuilderPage } from "@/pages/agents/index";
import CampaignsTabPage   from "@/pages/campaigns/tabbed";
import CallsTabPage       from "@/pages/calls/tabbed";
import PhoneNumbersTabPage from "@/pages/phone-numbers-tabbed";
import SettingsTabPage    from "@/pages/settings/tabbed";
import ProvidersTabPage   from "@/pages/providers/tabbed";
import ApiKeysTabPage     from "@/pages/api-keys-tabbed";
import WalletTabPage      from "@/pages/wallet-tabbed";

// Individual / deep-link pages (unchanged)
import SquadsPage              from "@/pages/squads/index";
import MeetPage                from "@/pages/meet/index";
import CallsList               from "@/pages/calls/index";
import CallDetail              from "@/pages/calls/[id]";
import ProvidersList           from "@/pages/providers/index";
import Settings                from "@/pages/settings/index";
import ProfilePage             from "@/pages/settings/Profile";
import KnowledgeBasePage       from "@/pages/knowledge-base";
import WalletPage              from "@/pages/wallet";
import PhoneNumbersPage        from "@/pages/phone-numbers";
import WebhooksPage            from "@/pages/webhooks";
import WhatsAppPage            from "@/pages/whatsapp";
import CallbacksPage           from "@/pages/callbacks";
import AgentAnalyticsPage      from "@/pages/agent-analytics";
import AnalyticsPage           from "@/pages/analytics";
import NotFound                from "@/pages/not-found";
import PrivacyPage             from "@/pages/privacy";
import TermsPage               from "@/pages/terms";
import OnboardingPage          from "@/pages/onboarding";
import CampaignDetailPage      from "@/pages/campaigns/[id]";
import BatchDetailPage         from "@/pages/campaigns/[id]/batches/[batchId]";
import BatchWizardPage         from "@/pages/campaigns/batch-wizard";
import CampaignLeadProfilePage from "@/pages/campaigns/[id]/leads/[leadId]";
import SchedulingPage          from "@/pages/scheduling/index";
import SchedulingCalendarsPage     from "@/pages/scheduling/Calendars";
import SchedulingEventTypesPage    from "@/pages/scheduling/EventTypes";
import SchedulingEventTypeDetailPage from "@/pages/scheduling/EventTypeDetail";
import SchedulingAvailabilityPage  from "@/pages/scheduling/Availability";
import SchedulingBookingDetailPage from "@/pages/scheduling/Bookings";
import SchedulingConferencingPage  from "@/pages/scheduling/Conferencing";
import PublicBookingPage    from "@/pages/book/[slug]";
import WebcallJoinPage      from "@/pages/join/[token]";
import PartnerPage          from "@/pages/partner";
import PartnerClientPage    from "@/pages/partner-client";
import PartnerJoinPage      from "@/pages/partner-join";
import WorkshopFormPage     from "@/pages/workshop/[slug]";
import EventsPage           from "@/pages/events/index";
import EventTeamPortalPage  from "@/pages/events/team";
import PublicEventPage      from "@/pages/events/public";
import JudgePortalPage      from "@/pages/events/judge";
import CertificateVerifyPage from "@/pages/events/certificate-verify";
import CancelBookingPage    from "@/pages/book/cancel";
import RescheduleBookingPage from "@/pages/book/reschedule";
import UsagePage            from "@/pages/usage";
import KycPage              from "@/pages/kyc";
import ApiKeysPage          from "@/pages/api-keys";
import MetaLeadsPage        from "@/pages/meta-leads";
import ConnectionsPage      from "@/pages/connections/hub";
import AutomaticCallsPage   from "@/pages/automatic-calls/index";
import AutomaticCallsWizardPage from "@/pages/automatic-calls/wizard";
import AutomaticCallDetailPage  from "@/pages/automatic-calls/[id]";
import TransfersPage        from "@/pages/transfers";
import VoicesPage           from "@/pages/voices";
import TestSimulatorPage    from "@/pages/test-simulator";
import VibePage             from "@/pages/vibe";
import HomePage             from "@/pages/home/index";
import ChannelsRedirectPage from "@/pages/channels/index";
import CommandCenterRedirect from "@/pages/command-center/index";
import MemoryPage           from "@/pages/memory/index";
import DocsPage             from "@/pages/docs/index";
import TeamPage             from "@/pages/team";
import ImpersonatePage      from "@/pages/impersonate";
import { ImpersonationBanner } from "@/components/ImpersonationBanner";
import { initMetaPixel } from "@/lib/meta-pixel";

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

void initMetaPixel();

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function AuthTokenSync() {
  const { getToken } = useAuth();
  useEffect(() => {
    setAuthTokenGetter(() => getToken());
    return () => setAuthTokenGetter(null);
  }, [getToken]);
  return null;
}

function UnauthorizedSignOutSync() {
  const { signOut, isSignedIn } = useAuth();
  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (isSignedIn) signOut("revoked");
    });
    return () => setUnauthorizedHandler(null);
  }, [signOut, isSignedIn]);
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
  const [location, navigate] = useLocation();
  const [error, setError] = useState<string | null>(null);
  const isSignup = location.startsWith("/sign-up");

  useEffect(() => {
    const reason = consumeSignOutReason();
    if (reason === "revoked") {
      setError("You've been signed out because your account access has changed. Please contact support if you believe this is a mistake.");
    }
  }, []);

  return (
    <div className="relative min-h-[100dvh] w-full flex items-center justify-center overflow-hidden bg-black text-white">
      <DotGridBackground
        className="absolute inset-0 z-0 pointer-events-none"
        style={{ width: "100%", height: "100%" }}
      />
      <div
        className="absolute inset-0 z-[1] pointer-events-none"
        style={{
          background:
            "radial-gradient(circle at center, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.88) 100%)",
        }}
      />
      <div className="relative z-[2] w-full max-w-[400px] mx-4 flex flex-col items-center text-center rounded-2xl border border-white/[0.08] bg-[#0f0f12]/90 backdrop-blur-xl p-8 shadow-[0_24px_80px_rgba(0,0,0,0.8)] animate-in fade-in zoom-in-95 slide-in-from-bottom-2 duration-500">
        <div className="flex flex-col items-center gap-4 mb-6">
          <div className="flex flex-col gap-[6px] w-[46px]">
            <div className="h-[10px] w-full rounded-full bg-white" />
            <div className="h-[10px] w-[78%] rounded-full bg-white/60" />
            <div className="h-[10px] w-[58%] rounded-full bg-white/35" />
          </div>
          <div className="flex flex-col items-center gap-1.5">
            <span
              className="leading-none text-[15px] text-white"
              style={{ fontFamily: "system-ui, sans-serif", letterSpacing: "-0.02em" }}
            >
              <span style={{ fontWeight: 700 }}>Snap</span>
              <span style={{ fontWeight: 400, opacity: 0.55 }}>Serve</span>
            </span>
            <PoweredBySarvam variant="inline" className="justify-center text-white/45 [&_span]:text-white/45" />
          </div>
        </div>

        <h1 className="text-xl font-semibold tracking-tight mb-1.5">
          {isSignup ? "Create your account" : "Sign in to SnapServe"}
        </h1>
        <p className="text-sm text-white/45 mb-5 leading-relaxed">
          {isSignup ? "Get started with your voice agents." : "Sign in to manage your voice agents."}
        </p>

        <div className="inline-flex items-center gap-1.5 mb-6 px-3 py-1 rounded-full border border-purple-400/20 bg-purple-400/10 text-[0.7rem] font-medium tracking-wide text-purple-200">
          <Sparkles size={12} /> ₹500 free credit · ~100 minutes on us
        </div>

        {error && (
          <div className="w-full mb-4 px-3.5 py-2.5 rounded-lg border border-red-500/20 bg-red-500/[0.08] text-xs text-red-300 text-left">
            {error}
          </div>
        )}

        <a
          href={`/api/auth/google/connect?return_to=${encodeURIComponent(window.location.origin)}`}
          className="w-full flex items-center justify-center gap-2.5 rounded-lg bg-white text-black font-semibold text-sm py-3 transition-colors hover:bg-white/90"
        >
          <svg width="18" height="18" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.35-8.16 2.35-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            <path fill="none" d="M0 0h48v48H0z"/>
          </svg>
          {isSignup ? "Sign up with Google" : "Continue with Google"}
        </a>

        <div className="mt-6 text-sm text-white/50">
          {isSignup ? "Already have an account? " : "Don't have an account? "}
          <button
            type="button"
            onClick={() => navigate(isSignup ? "/sign-in" : "/sign-up")}
            className="text-white font-medium hover:underline underline-offset-2"
          >
            {isSignup ? "Sign in" : "Sign up"}
          </button>
        </div>

        <p className="mt-4 text-[0.72rem] text-white/35 leading-relaxed">
          By continuing, you agree to our{" "}
          <Link href="/terms" className="text-white/55 hover:text-white/80">Terms of Service</Link> and{" "}
          <Link href="/privacy" className="text-white/55 hover:text-white/80">Privacy Policy</Link>.
        </p>
      </div>
    </div>
  );
}

function HomeRedirect() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <SnapServeLoader />;
  if (isSignedIn) return <Redirect to="/app" />;
  return <SignInPage />;
}

function AppRoot() {
  const { data: agents, isLoading } = useListAgents({});
  if (isLoading) return <SnapServeLoader />;
  const list = Array.isArray(agents) ? agents : (agents as any)?.agents ?? [];
  // Accounts with no agents land in the builder, not Vibe. Vibe stays available
  // from the "Build with AI" entry points, but it is opt-in rather than the
  // forced first screen after signup.
  if (!list.length) return <Redirect to="/app/agents" />;
  return <Redirect to="/app/home" />;
}

/* ─── Client-side redirects for merged / renamed routes ─────────────────── */
function TabRedirect({ to }: { to: string }) {
  const [, navigate] = useLocation();
  useEffect(() => { navigate(to, { replace: true }); }, []);
  return null;
}

function AppRoutes() {
  const [location] = useLocation();
  const { data: onboardingStatus, isLoading: onboardingLoading } = useGetOnboardingStatus();

  // Restore a partner invite link stashed while the visitor was signed out.
  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(POST_LOGIN_REDIRECT_KEY);
      if (stored) {
        sessionStorage.removeItem(POST_LOGIN_REDIRECT_KEY);
        if (stored.includes("/app/partner-join") && !window.location.pathname.includes("/app/partner-join")) {
          window.location.replace(stored);
        }
      }
    } catch { /* sessionStorage unavailable */ }
  }, []);

  if (onboardingLoading) return <SnapServeLoader />;

  const onOnboardingPage = location.startsWith("/app/onboarding");
  // Partner invite acceptance must survive the onboarding gate — a fresh
  // signup can accept the invite first, then complete onboarding.
  const onPartnerJoinPage = location.startsWith("/app/partner-join");
  if (onboardingStatus?.completed === false && !onOnboardingPage && !onPartnerJoinPage) {
    return <Redirect to="/app/onboarding" />;
  }

  return (
    <Layout>
      <VoiceAssistant />
      <Switch>
        <Route path="/app" component={AppRoot} />
        <Route path="/app/home" component={HomePage} />
        {/* Call plans product surface removed — await Campaigns rebuild */}
        <Route path="/app/call-plans/:id/activity">
          <TabRedirect to="/app/home" />
        </Route>
        <Route path="/app/call-plans/:id">
          <TabRedirect to="/app/home" />
        </Route>
        <Route path="/app/call-plans">
          <TabRedirect to="/app/home" />
        </Route>
        {/* Legacy People / Leads → Campaigns */}
        <Route path="/app/people">
          <TabRedirect to="/app/campaigns" />
        </Route>
        <Route path="/app/automation">
          <TabRedirect to="/app/home" />
        </Route>
        {/* Channels product surface removed — redirect legacy links */}
        <Route path="/app/channels" component={ChannelsRedirectPage} />
        <Route path="/app/command-center" component={CommandCenterRedirect} />
        <Route path="/app/analytics" component={AnalyticsPage} />

        {/* ── Partner (reseller) hub ── */}
        <Route path="/app/partner-join" component={PartnerJoinPage} />
        <Route path="/app/partner/clients/:clerkId" component={PartnerClientPage} />
        <Route path="/app/partner" component={PartnerPage} />

        {/* ── Agents ── */}
        {/* /app/agents (list, tabbed) — must come BEFORE /app/agents/:id */}
        <Route path="/app/agents" component={AgentsTabPage} />
        <Route path="/app/agents/:id" component={AgentBuilderPage} />

        {/* ── Squads (list + detail; create opens with ?seedAgent=) ── */}
        <Route path="/app/squads/:id" component={SquadsPage} />
        <Route path="/app/squads" component={SquadsPage} />

        {/* ── Meeting bots — still reachable; nav entry folded into Connections ── */}
        <Route path="/app/meet" component={MeetPage} />

        {/* ── Team → settings?tab=team redirect ── */}
        <Route path="/app/team">
          <TabRedirect to="/app/settings?tab=team" />
        </Route>

        <Route path="/app/events*" component={() => { useLocation()[1]("/app/home", { replace: true }); return null; }} />

        {/* ── History (Phase 4 label) + legacy /app/calls ── */}
        <Route path="/app/history/:id" component={CallDetail} />
        <Route path="/app/history" component={CallsTabPage} />
        <Route path="/app/calls/:id" component={CallDetail} />
        <Route path="/app/calls" component={CallsTabPage} />

        {/* ── Callbacks → history?tab=callbacks redirect ── */}
        <Route path="/app/callbacks">
          <TabRedirect to="/app/history?tab=callbacks" />
        </Route>

        {/* ── Transfers → history?tab=transfers redirect ── */}
        <Route path="/app/transfers">
          <TabRedirect to="/app/history?tab=transfers" />
        </Route>

        <Route path="/app/knowledge-bases" component={KnowledgeBasePage} />

        {/* ── Providers (tabbed — Voices + Provider keys) ── */}
        <Route path="/app/providers" component={ProvidersTabPage} />

        {/* ── Voices → providers?tab=voices redirect ── */}
        <Route path="/app/voices">
          <TabRedirect to="/app/providers?tab=voices" />
        </Route>

        {/* ── Wallet (tabbed — Billing) ── */}
        <Route path="/app/wallet" component={WalletTabPage} />

        {/* ── Usage → wallet?tab=usage redirect ── */}
        <Route path="/app/usage">
          <TabRedirect to="/app/wallet?tab=usage" />
        </Route>

        <Route path="/app/memory" component={MemoryPage} />
        {/* Legacy Activity → History */}
        <Route path="/app/activity">
          <TabRedirect to="/app/history" />
        </Route>

        {/* ── Phone Numbers (tabbed) ── */}
        <Route path="/app/phone-numbers" component={PhoneNumbersTabPage} />

        {/* ── KYC → phone-numbers?tab=verification redirect ── */}
        <Route path="/app/kyc">
          <TabRedirect to="/app/phone-numbers?tab=verification" />
        </Route>

        <Route path="/app/connections" component={ConnectionsPage} />
        {/* WhatsApp page kept for Connections hub deep-link; removed from primary nav */}
        <Route path="/app/whatsapp" component={WhatsAppPage} />

        {/* ── Webhooks → api-keys?tab=webhooks redirect ── */}
        <Route path="/app/webhooks">
          <TabRedirect to="/app/api-keys?tab=webhooks" />
        </Route>

        <Route path="/app/analytics/agents/:id" component={AgentAnalyticsPage} />

        {/* ── Campaigns (tabbed + deep-link sub-routes) ── */}
        <Route path="/app/campaigns/:id/leads/:leadId" component={CampaignLeadProfilePage} />
        <Route path="/app/campaigns/:id/batches/new" component={BatchWizardPage} />
        <Route path="/app/campaigns/:id/batches/:batchId" component={BatchDetailPage} />
        <Route path="/app/campaigns/:id" component={CampaignDetailPage} />
        <Route path="/app/campaigns" component={CampaignsTabPage} />

        {/* ── Automatic Calls (detail/wizard live; list → Campaigns Sheets tab) ── */}
        <Route path="/app/automatic-calls/new" component={AutomaticCallsWizardPage} />
        <Route path="/app/automatic-calls/:id" component={AutomaticCallDetailPage} />
        <Route path="/app/automatic-calls" component={AutomaticCallsPage} />

        {/* ── Meta Leads → Connections Meta card ── */}
        <Route path="/app/meta-leads">
          <TabRedirect to="/app/connections?setup=meta" />
        </Route>

        {/* ── Scheduling ── */}
        <Route path="/app/scheduling/bookings/:id" component={SchedulingBookingDetailPage} />
        <Route path="/app/scheduling/calendars" component={() => <SchedulingCalendarsPage />} />
        <Route path="/app/scheduling/event-types/:id" component={SchedulingEventTypeDetailPage} />
        <Route path="/app/scheduling/event-types" component={SchedulingEventTypesPage} />
        <Route path="/app/scheduling/availability" component={SchedulingAvailabilityPage} />
        <Route path="/app/scheduling/conferencing" component={SchedulingConferencingPage} />
        <Route path="/app/scheduling" component={SchedulingPage} />

        {/* ── Settings (tabbed — General + Team) ── */}
        <Route path="/app/settings/profile" component={ProfilePage} />
        <Route path="/app/settings" component={SettingsTabPage} />

        {/* ── API Keys (tabbed — Developers) ── */}
        <Route path="/app/api-keys" component={ApiKeysTabPage} />

        <Route path="/app/test-simulator" component={TestSimulatorPage} />

        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

const POST_LOGIN_REDIRECT_KEY = "snapserve:post-login-redirect";

/** Preserve partner invite links across the sign-in flow, then bounce home. */
function SignedOutRedirect() {
  try {
    if (window.location.pathname.includes("/app/partner-join")) {
      sessionStorage.setItem(POST_LOGIN_REDIRECT_KEY, window.location.pathname + window.location.search);
    }
  } catch { /* sessionStorage unavailable */ }
  return <Redirect to="/" />;
}

function ProtectedApp() {
  const { isLoaded } = useAuth();
  if (!isLoaded) return <SnapServeLoader />;
  return (
    <>
      <ImpersonationBanner />
      <SignedIn>
        <Switch>
          {/* Full-screen pages — no sidebar layout */}
          <Route path="/app/onboarding" component={OnboardingPage} />
          <Route path="/app/vibe" component={VibePage} />
          {/* All other /app/* routes go through the onboarding gate + Layout */}
          <Route path="/app/*?" component={AppRoutes} />
        </Switch>
      </SignedIn>
      <SignedOut>
        <SignedOutRedirect />
      </SignedOut>
    </>
  );
}

function NavHistoryTracker() {
  const [location] = useLocation();
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    recordInAppNavigation();
  }, [location]);
  return null;
}

function Router() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <AuthTokenSync />
        <UnauthorizedSignOutSync />
        <QueryClientCacheInvalidator />
        <NavHistoryTracker />
        <ThemeSync />
        <Switch>
          <Route path="/" component={HomeRedirect} />
          <Route path="/sign-in/*?" component={SignInPage} />
          <Route path="/sign-up/*?" component={SignInPage} />
          <Route path="/app/*?" component={ProtectedApp} />
          <Route path="/impersonate" component={ImpersonatePage} />
          <Route path="/book/cancel" component={CancelBookingPage} />
          <Route path="/book/reschedule" component={RescheduleBookingPage} />
          <Route path="/book/:slug" component={PublicBookingPage} />
          <Route path="/join/:token" component={WebcallJoinPage} />
          <Route path="/workshop/:slug" component={WorkshopFormPage} />
          <Route path="/events/judge/:token" component={JudgePortalPage} />
          <Route path="/events/certificates/:code/verify" component={CertificateVerifyPage} />
          <Route path="/events/:slug" component={PublicEventPage} />
          <Route path="/docs" component={DocsPage} />
          <Route path="/docs/api-reference/:op" component={DocsPage} />
          <Route path="/docs/:section" component={DocsPage} />
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
    <ThemeProvider defaultTheme="light" storageKey="snapserve-ui-theme-v2">
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
