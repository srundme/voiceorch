import { useEffect, useRef, useState } from "react";
import { Switch, Route, Router as WouterRouter, useLocation, Redirect } from "wouter";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { PhoneCall, Sparkles, AudioLines, ShieldCheck } from "lucide-react";
import { AuthProvider, useAuth, SignedIn, SignedOut } from "@/lib/auth";
import { setAuthTokenGetter, setDefaultTimeoutMs, useGetOnboardingStatus } from "@workspace/api-client-react";
import { Toaster } from "@/components/ui/toaster";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeSync } from "@/components/theme-sync";

import { Layout } from "@/components/layout";
import { recordInAppNavigation } from "@/lib/nav-history";
import { SnapServeLoader } from "@/components/logo";
import { VoiceAssistant } from "@/components/VoiceAssistant";
import AgentBuilder from "@/pages/agents/builder";
import Dashboard from "@/pages/dashboard";
import AgentDetail from "@/pages/agents/[id]";

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
import CallbacksPage from "@/pages/callbacks";
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
import SchedulingConferencingPage from "@/pages/scheduling/Conferencing";
import PublicBookingPage from "@/pages/book/[slug]";
import CancelBookingPage from "@/pages/book/cancel";
import RescheduleBookingPage from "@/pages/book/reschedule";
import UsagePage from "@/pages/usage";
import KycPage from "@/pages/kyc";
import ApiKeysPage from "@/pages/api-keys";
import MetaLeadsPage from "@/pages/meta-leads";
import ConnectionsPage from "@/pages/connections/index";
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
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 12,
  padding: "14px 16px",
  fontSize: "0.9rem",
  color: "#fff",
  outline: "none",
  transition: "border-color .15s, background .15s",
};

function inputFocus(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.style.borderColor = "rgba(168,85,247,0.5)";
  e.currentTarget.style.background = "rgba(168,85,247,0.06)";
}
function inputBlur(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
  e.currentTarget.style.background = "rgba(255,255,255,0.04)";
}

type SignInMode = "login" | "register" | "forgot";
type ForgotStep = "email" | "otp" | "newPassword";

const authFeatures = [
  { icon: PhoneCall, text: "Launch voice agents on your own ASR, LLM & TTS keys — or go fully managed" },
  { icon: AudioLines, text: "Real-time transcripts, call analytics & campaign performance" },
  { icon: ShieldCheck, text: "Enterprise-grade orchestration with your data, your rules" },
];

function VoiceBars() {
  const heights = [14, 26, 18, 34, 22, 30, 16, 28, 20, 12, 24, 32, 18, 26, 14, 20];
  return (
    <div className="flex items-end gap-[3px] h-9">
      {heights.map((h, i) => (
        <div
          key={i}
          className="voice-bar w-[3px] rounded-full bg-gradient-to-t from-purple-500/70 to-fuchsia-300/90"
          style={{ height: h, animationDelay: `${i * 90}ms` }}
        />
      ))}
    </div>
  );
}

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative min-h-screen w-full bg-black flex overflow-hidden">
      <div className="pointer-events-none absolute -top-40 -left-32 w-[520px] h-[520px] rounded-full bg-purple-600/20 blur-[120px]" />
      <div className="pointer-events-none absolute bottom-[-180px] right-[-140px] w-[480px] h-[480px] rounded-full bg-fuchsia-500/10 blur-[130px]" />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      {/* Left visual panel — desktop only */}
      <div className="hidden lg:flex lg:w-[44%] xl:w-[40%] relative z-10 flex-col justify-between p-14 border-r border-white/[0.06] bg-gradient-to-b from-white/[0.03] to-transparent animate-in fade-in slide-in-from-left-4 duration-700">
        <div className="flex items-center gap-2">
          <div className="flex flex-col gap-[5px] w-7">
            <div className="h-2 w-full rounded-full bg-white" />
            <div className="h-2 w-[78%] rounded-full bg-white/60" />
            <div className="h-2 w-[58%] rounded-full bg-white/35" />
          </div>
          <span className="text-sm font-semibold tracking-tight text-white">
            Snap<span className="font-normal text-white/55">Serve</span>
          </span>
        </div>

        <div className="max-w-md">
          <div className="inline-flex items-center gap-1.5 mb-5 px-3 py-1 rounded-full border border-purple-400/20 bg-purple-400/10 text-[0.7rem] font-medium tracking-wide text-purple-200">
            <Sparkles size={12} /> $5 free credit · 100 minutes on us
          </div>
          <h2 className="text-3xl font-semibold tracking-tight text-white leading-[1.15] mb-4">
            Voice agents that sound like your best rep, on call 24/7.
          </h2>
          <p className="text-sm text-white/45 leading-relaxed mb-8">
            Orchestrate ASR, LLM and TTS providers behind one reliable pipeline — bring your own keys or let SnapServe run it for you.
          </p>
          <div className="flex flex-col gap-4 mb-9">
            {authFeatures.map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-start gap-3">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/[0.06] border border-white/[0.08] text-purple-300">
                  <Icon size={14} />
                </div>
                <span className="text-[0.83rem] text-white/60 leading-snug">{text}</span>
              </div>
            ))}
          </div>
          <VoiceBars />
        </div>

        <p className="text-[0.72rem] text-white/25">© {new Date().getFullYear()} SnapServe. All rights reserved.</p>
      </div>

      {/* Right — auth card */}
      <div className="flex-1 flex items-center justify-center p-6 relative z-10">
        {children}
      </div>
    </div>
  );
}

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
    maxWidth: "calc(100vw - 32px)",
    background: "linear-gradient(180deg, rgba(20,16,32,0.92), rgba(8,6,16,0.94))",
    borderRadius: 24,
    padding: "40px 36px 36px",
    boxShadow: "0 0 0 1px rgba(168,85,247,0.16), 0 0 60px rgba(168,85,247,0.08), 0 32px 80px rgba(0,0,0,0.7)",
    backdropFilter: "blur(16px)",
    position: "relative" as const,
    zIndex: 1,
  };
  const cardClassName = "animate-in fade-in zoom-in-95 slide-in-from-bottom-2 duration-500";

  const submitBtnStyle = (isLoading: boolean): React.CSSProperties => ({
    marginTop: 6,
    width: "100%",
    background: isLoading ? "rgba(255,255,255,0.35)" : "#fff",
    color: "#000",
    fontWeight: 700,
    fontSize: "0.9rem",
    padding: "14px 0",
    borderRadius: 12,
    border: "none",
    cursor: isLoading ? "not-allowed" : "pointer",
    transition: "background .15s",
    letterSpacing: "-0.1px",
    boxShadow: isLoading ? "none" : "0 2px 12px rgba(0,0,0,0.2)",
  });

  const logoIcon = (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 28, gap: 16 }}>
      {/* Three-bar mark — left-aligned, proportions matching the SnapServe brand */}
      <div style={{ display: "flex", flexDirection: "column", gap: 7, width: 52 }}>
        <div style={{ width: "100%", height: 11, borderRadius: 6, background: "white", opacity: 1 }} />
        <div style={{ width: "78%",  height: 11, borderRadius: 6, background: "white", opacity: 0.6 }} />
        <div style={{ width: "58%",  height: 11, borderRadius: 6, background: "white", opacity: 0.35 }} />
      </div>
      {/* Wordmark */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 0, letterSpacing: "-0.02em" }}>
        <span style={{ fontWeight: 700, fontSize: "1.15rem", color: "#fff" }}>Snap</span>
        <span style={{ fontWeight: 400, fontSize: "1.15rem", color: "rgba(255,255,255,0.55)" }}>Serve</span>
      </div>
    </div>
  );

  const errorBanner = error && (
    <div style={{ marginBottom: 16, padding: "10px 14px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 10, fontSize: "0.8rem", color: "#fca5a5" }}>
      {error}
    </div>
  );

  const googleBtn = (
    <a
      href="/api/auth/google/connect"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        width: "100%",
        background: "rgba(255,255,255,0.06)",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 12,
        padding: "13px 0",
        color: "#fff",
        fontSize: "0.9rem",
        fontWeight: 600,
        textDecoration: "none",
        cursor: "pointer",
        transition: "background .15s, border-color .15s",
        letterSpacing: "-0.1px",
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLAnchorElement).style.background = "rgba(255,255,255,0.1)";
        (e.currentTarget as HTMLAnchorElement).style.borderColor = "rgba(255,255,255,0.18)";
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLAnchorElement).style.background = "rgba(255,255,255,0.06)";
        (e.currentTarget as HTMLAnchorElement).style.borderColor = "rgba(255,255,255,0.1)";
      }}
    >
      <svg width="18" height="18" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
        <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
        <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
        <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.35-8.16 2.35-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
        <path fill="none" d="M0 0h48v48H0z"/>
      </svg>
      Continue with Google
    </a>
  );

  const orDivider = (
    <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "4px 0" }}>
      <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.07)" }} />
      <span style={{ fontSize: "0.78rem", color: "#3a3c4e", fontWeight: 500, letterSpacing: "0.04em" }}>or</span>
      <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.07)" }} />
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
        <AuthShell>
          <div style={cardStyle} className={cardClassName}>
            {logoIcon}
            <div style={{ textAlign: "center", marginBottom: 24 }}>
              <h1 style={{ fontWeight: 700, fontSize: "1.25rem", color: "#fff", letterSpacing: "-0.3px", marginBottom: 8 }}>Google account detected</h1>
              <p style={{ fontSize: "0.875rem", color: "#5a5c6e", lineHeight: 1.6 }}>
                This email is linked to a Google account. Password reset isn't available — sign in with Google instead.
              </p>
            </div>
            {googleBtn}
            {backToLogin}
          </div>
        </AuthShell>
      );
    }

    // Step: enter email
    if (forgotStep === "email") {
      return (
        <AuthShell>
          <div style={cardStyle} className={cardClassName}>
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
                onMouseEnter={e => { if (!loading) e.currentTarget.style.opacity = "0.85"; }}
                onMouseLeave={e => { if (!loading) e.currentTarget.style.opacity = "1"; }}
              >
                {loading ? "Sending…" : "Send reset code"}
              </button>
            </form>
            {backToLogin}
          </div>
        </AuthShell>
      );
    }

    // Step: enter OTP
    if (forgotStep === "otp") {
      return (
        <AuthShell>
          <div style={cardStyle} className={cardClassName}>
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
                onMouseEnter={e => { if (!loading) e.currentTarget.style.opacity = "0.85"; }}
                onMouseLeave={e => { if (!loading) e.currentTarget.style.opacity = "1"; }}
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
        </AuthShell>
      );
    }

    // Step: set new password
    return (
      <AuthShell>
        <div style={cardStyle} className={cardClassName}>
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
      </AuthShell>
    );
  }

  // ── Login / Register ──────────────────────────────────────────────────────────
  return (
    <AuthShell>
      <div style={cardStyle} className={cardClassName}>
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

        {/* Google OAuth */}
        {googleBtn}
        {orDivider}

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
    </AuthShell>
  );
}

function HomeRedirect() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <SnapServeLoader />;
  if (isSignedIn) return <Redirect to="/app" />;
  return <SignInPage />;
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

        <Route path="/app/agents/:id" component={AgentBuilder} />
        <Route path="/app/calls" component={CallsList} />
        <Route path="/app/calls/:id" component={CallDetail} />
        <Route path="/app/knowledge-bases" component={KnowledgeBasePage} />
        <Route path="/app/providers" component={ProvidersList} />
        <Route path="/app/wallet" component={WalletPage} />
        <Route path="/app/memory" component={MemoryPage} />
        <Route path="/app/activity" component={() => <Redirect to="/app/calls" />} />
        <Route path="/app/phone-numbers" component={PhoneNumbersPage} />
        <Route path="/app/connections" component={ConnectionsPage} />
        <Route path="/app/webhooks" component={WebhooksPage} />
        <Route path="/app/callbacks" component={CallbacksPage} />
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
        <Route path="/app/scheduling/conferencing" component={SchedulingConferencingPage} />
        <Route path="/app/scheduling" component={SchedulingPage} />
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

function NavHistoryTracker() {
  const [location] = useLocation();
  const firstRender = useRef(true);
  useEffect(() => {
    // Skip the initial mount (the landing page itself isn't a navigation);
    // every subsequent location change is an in-app navigation.
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    recordInAppNavigation();
  }, [location]);
  return null;
}

function Router() {
  // Google Cloud Console OAuth app settings — enter these exact URLs:
  //   Homepage URL:       https://<production-domain>/
  //   Privacy policy URL: https://<production-domain>/privacy
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <AuthTokenSync />
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
