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
import AgentBuilder from "@/pages/agents/builder";
import AssistantsPage from "@/pages/assistants";
import Dashboard from "@/pages/dashboard";
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
import MemoryPage from "@/pages/memory/index";
import DocsPage from "@/pages/docs/index";
import ImpersonatePage from "@/pages/impersonate";
import { ImpersonationBanner } from "@/components/ImpersonationBanner";

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

// ── Shared style constants ─────────────────────────────────────────────────────
const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "#1f2030",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: 12,
  padding: "14px 16px",
  fontSize: "0.9rem",
  color: "#fff",
  outline: "none",
  transition: "border-color .15s",
};

function inputFocus(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.style.borderColor = "rgba(74,222,128,0.3)";
}
function inputBlur(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)";
}

type SignInMode = "login" | "register" | "forgot";
type ForgotStep = "email" | "otp" | "newPassword";

function SignInPage() {
  const { signIn } = useAuth();
  const [, navigate] = useLocation();
  const [mode, setMode] = useState<SignInMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Forgot password flow state
  const [forgotStep, setForgotStep] = useState<ForgotStep>("email");
  const [forgotEmail, setForgotEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [googleOnly, setGoogleOnly] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Start / restart the 60-second resend cooldown
  function startResendCooldown() {
    setResendCooldown(60);
  }

  // Tick the cooldown down every second
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const id = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [resendCooldown]);

  function resetForgotFlow() {
    setForgotStep("email");
    setForgotEmail("");
    setOtp("");
    setNewPassword("");
    setConfirmPassword("");
    setGoogleOnly(false);
    setError(null);
  }

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

  async function handleForgotSendOtp(e: React.FormEvent) {
    e.preventDefault();
    if (!forgotEmail.trim()) {
      setError("Please enter your email address.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotEmail.trim() }),
      });
      const data = await res.json() as { ok?: boolean; hint?: string; error?: string };
      if (res.status === 429) {
        setError("Too many attempts — please wait a few minutes before requesting another code.");
        return;
      }
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }
      if (data.hint === "google_only") {
        setGoogleOnly(true);
        return;
      }
      setForgotStep("otp");
      startResendCooldown();
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!otp.trim() || otp.trim().length !== 6) {
      setError("Please enter the 6-digit code from your email.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/password-reset/check-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotEmail.trim(), otp: otp.trim() }),
      });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Invalid or expired code. Please try again.");
        return;
      }
      setForgotStep("newPassword");
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotSetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/password-reset/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotEmail.trim(), otp: otp.trim(), newPassword }),
      });
      const data = await res.json() as { token?: string; error?: string };
      if (!res.ok || !data.token) {
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }
      signIn(data.token);
      navigate("/app");
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  const cardStyle: React.CSSProperties = {
    width: 440,
    maxWidth: "100%",
    background: "#161720",
    borderRadius: 20,
    padding: "40px 36px 36px",
    boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
  };

  const submitBtnStyle = (isLoading: boolean): React.CSSProperties => ({
    marginTop: 6,
    width: "100%",
    background: isLoading ? "#d4d4d4" : "#fff",
    color: "#0e0f14",
    fontWeight: 700,
    fontSize: "0.9rem",
    padding: "14px 0",
    borderRadius: 12,
    border: "none",
    cursor: isLoading ? "not-allowed" : "pointer",
    transition: "background .15s",
    letterSpacing: "-0.1px",
  });

  const logoIcon = (
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
  );

  const errorBanner = error && (
    <div style={{ marginBottom: 16, padding: "10px 14px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 10, fontSize: "0.8rem", color: "#fca5a5" }}>
      {error}
    </div>
  );

  // ── Forgot flow ──────────────────────────────────────────────────────────────
  if (mode === "forgot") {
    const backToLogin = (
      <p style={{ marginTop: 22, textAlign: "center", fontSize: "0.85rem", color: "#44475a" }}>
        <button
          onClick={() => { setMode("login"); resetForgotFlow(); }}
          style={{ background: "none", border: "none", color: "#a0a3b8", cursor: "pointer", fontSize: "0.85rem", textDecoration: "underline", textUnderlineOffset: 3, padding: 0 }}
        >
          Back to sign in
        </button>
      </p>
    );

    // Google-only hint
    if (googleOnly) {
      return (
        <div style={{ minHeight: "100vh", background: "#0e0f14", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 16px" }}>
          <div style={cardStyle}>
            {logoIcon}
            <div style={{ textAlign: "center", marginBottom: 24 }}>
              <h1 style={{ fontWeight: 700, fontSize: "1.25rem", color: "#fff", letterSpacing: "-0.3px", marginBottom: 8 }}>Google account detected</h1>
              <p style={{ fontSize: "0.875rem", color: "#5a5c6e", lineHeight: 1.6 }}>
                This email is linked to a Google account. Password reset isn't available — please sign in with Google instead.
              </p>
            </div>
            {backToLogin}
          </div>
        </div>
      );
    }

    // Step: enter email
    if (forgotStep === "email") {
      return (
        <div style={{ minHeight: "100vh", background: "#0e0f14", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 16px" }}>
          <div style={cardStyle}>
            {logoIcon}
            <div style={{ textAlign: "center", marginBottom: 28 }}>
              <h1 style={{ fontWeight: 700, fontSize: "1.25rem", color: "#fff", letterSpacing: "-0.3px", marginBottom: 8 }}>Reset your password</h1>
              <p style={{ fontSize: "0.875rem", color: "#5a5c6e", lineHeight: 1.5 }}>
                Enter your email and we'll send a 6-digit code to reset your password.
              </p>
            </div>
            {errorBanner}
            <form onSubmit={handleForgotSendOtp} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input
                type="email"
                placeholder="Email address"
                required
                value={forgotEmail}
                onChange={(e) => setForgotEmail(e.target.value)}
                style={inputStyle}
                onFocus={inputFocus}
                onBlur={inputBlur}
              />
              <button
                type="submit"
                disabled={loading}
                style={submitBtnStyle(loading)}
                onMouseEnter={e => { if (!loading) e.currentTarget.style.background = "#e8e8e8"; }}
                onMouseLeave={e => { if (!loading) e.currentTarget.style.background = "#fff"; }}
              >
                {loading ? "Sending…" : "Send reset code"}
              </button>
            </form>
            {backToLogin}
          </div>
        </div>
      );
    }

    // Step: enter OTP
    if (forgotStep === "otp") {
      return (
        <div style={{ minHeight: "100vh", background: "#0e0f14", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 16px" }}>
          <div style={cardStyle}>
            {logoIcon}
            <div style={{ textAlign: "center", marginBottom: 28 }}>
              <h1 style={{ fontWeight: 700, fontSize: "1.25rem", color: "#fff", letterSpacing: "-0.3px", marginBottom: 8 }}>Check your email</h1>
              <p style={{ fontSize: "0.875rem", color: "#5a5c6e", lineHeight: 1.5 }}>
                We sent a 6-digit code to <strong style={{ color: "#a0a3b8" }}>{forgotEmail}</strong>. Enter it below.
              </p>
            </div>
            {errorBanner}
            <form onSubmit={handleForgotVerify} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input
                type="text"
                placeholder="6-digit code"
                required
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                style={{ ...inputStyle, letterSpacing: "0.3em", textAlign: "center", fontSize: "1.4rem" }}
                onFocus={inputFocus}
                onBlur={inputBlur}
                autoComplete="one-time-code"
              />
              <button
                type="submit"
                disabled={loading}
                style={submitBtnStyle(loading)}
                onMouseEnter={e => { if (!loading) e.currentTarget.style.background = "#e8e8e8"; }}
                onMouseLeave={e => { if (!loading) e.currentTarget.style.background = "#fff"; }}
              >
                {loading ? "Verifying…" : "Verify code"}
              </button>
            </form>
            <p style={{ marginTop: 16, textAlign: "center", fontSize: "0.85rem", color: "#44475a" }}>
              Didn't receive it?{" "}
              {resendCooldown > 0 ? (
                <span style={{ color: "#5a5c6e", fontSize: "0.85rem" }}>
                  Resend in 0:{String(resendCooldown).padStart(2, "0")}
                </span>
              ) : (
                <button
                  onClick={async () => {
                    setError(null);
                    setOtp("");
                    startResendCooldown();
                    try {
                      await fetch("/api/auth/password-reset/request", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ email: forgotEmail.trim() }),
                      });
                    } catch { /* ignore */ }
                  }}
                  style={{ background: "none", border: "none", color: "#a0a3b8", cursor: "pointer", fontSize: "0.85rem", textDecoration: "underline", textUnderlineOffset: 3, padding: 0 }}
                >
                  Resend code
                </button>
              )}
            </p>
            {backToLogin}
          </div>
        </div>
      );
    }

    // Step: set new password
    return (
      <div style={{ minHeight: "100vh", background: "#0e0f14", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 16px" }}>
        <div style={cardStyle}>
          {logoIcon}
          <div style={{ textAlign: "center", marginBottom: 28 }}>
            <h1 style={{ fontWeight: 700, fontSize: "1.25rem", color: "#fff", letterSpacing: "-0.3px", marginBottom: 8 }}>Set new password</h1>
            <p style={{ fontSize: "0.875rem", color: "#5a5c6e", lineHeight: 1.5 }}>
              Choose a strong password — at least 8 characters.
            </p>
          </div>
          {errorBanner}
          <form onSubmit={handleForgotSetPassword} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <input
              type="password"
              placeholder="New password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              style={inputStyle}
              onFocus={inputFocus}
              onBlur={inputBlur}
            />
            <input
              type="password"
              placeholder="Confirm new password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              style={inputStyle}
              onFocus={inputFocus}
              onBlur={inputBlur}
            />
            <button
              type="submit"
              disabled={loading}
              style={submitBtnStyle(loading)}
              onMouseEnter={e => { if (!loading) e.currentTarget.style.background = "#e8e8e8"; }}
              onMouseLeave={e => { if (!loading) e.currentTarget.style.background = "#fff"; }}
            >
              {loading ? "Saving…" : "Set new password"}
            </button>
          </form>
          {backToLogin}
        </div>
      </div>
    );
  }

  // ── Login / Register ──────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: "#0e0f14", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px 16px" }}>
      <div style={cardStyle}>
        {logoIcon}

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

        {errorBanner}

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {mode === "register" && (
            <input
              type="text"
              placeholder="Your name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={inputStyle}
              onFocus={inputFocus}
              onBlur={inputBlur}
            />
          )}
          <input
            type="email"
            placeholder="Email address"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={inputStyle}
            onFocus={inputFocus}
            onBlur={inputBlur}
          />
          <input
            type="password"
            placeholder="Password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={inputStyle}
            onFocus={inputFocus}
            onBlur={inputBlur}
          />

          {/* Forgot password link — only on login */}
          {mode === "login" && (
            <div style={{ textAlign: "right" }}>
              <button
                type="button"
                onClick={() => {
                  setForgotEmail(email);
                  resetForgotFlow();
                  setForgotEmail(email);
                  setMode("forgot");
                }}
                style={{ background: "none", border: "none", color: "#5a5c6e", cursor: "pointer", fontSize: "0.8rem", textDecoration: "underline", textUnderlineOffset: 3, padding: 0 }}
              >
                Forgot password?
              </button>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={submitBtnStyle(loading)}
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

  // Redirect new users to onboarding (except if they're already there).
  // Use === false (not falsy) so a failed/pending query (data=undefined) never
  // incorrectly triggers the redirect — only an explicit "completed: false" does.
  const onOnboardingPage = location.startsWith("/app/onboarding");
  if (onboardingStatus?.completed === false && !onOnboardingPage) {
    return <Redirect to="/app/onboarding" />;
  }

  return (
    <Layout>
      <VoiceAssistant />
      <Switch>
        <Route path="/app" component={() => <Redirect to="/app/command-center" />} />
        <Route path="/app/command-center" component={CommandCenterPage} />
        <Route path="/app/analytics" component={AnalyticsPage} />
        <Route path="/app/agents" component={AgentBuilder} />
        <Route path="/app/agents/:id/edit" component={AgentEdit} />
        <Route path="/app/agents/:id" component={AgentBuilder} />
        <Route path="/app/calls" component={CallsList} />
        <Route path="/app/calls/:id" component={CallDetail} />
        <Route path="/app/knowledge-bases" component={KnowledgeBasePage} />
        <Route path="/app/providers" component={ProvidersList} />
        <Route path="/app/wallet" component={WalletPage} />
        <Route path="/app/memory" component={MemoryPage} />
        <Route path="/app/activity" component={() => <Redirect to="/app/calls" />} />
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
      <ImpersonationBanner />
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
          <Route path="/impersonate" component={ImpersonatePage} />
          <Route path="/book/cancel" component={CancelBookingPage} />
          <Route path="/book/reschedule" component={RescheduleBookingPage} />
          <Route path="/book/:slug" component={PublicBookingPage} />
          <Route path="/docs" component={DocsPage} />
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
