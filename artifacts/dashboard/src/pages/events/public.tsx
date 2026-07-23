import { useEffect, useState, useMemo } from "react";
import { useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { BrandMark } from "@/components/logo";
import {
  AlertCircle, CheckCircle2, Loader2, Plus, Trash2, Trophy, Clock, Sparkles,
  MapPin, Calendar, Users, ShieldCheck, ExternalLink, ChevronRight, Zap, Award,
  CheckCircle, ArrowRight, Copy, QrCode, MessageCircle, Mic, Cpu
} from "lucide-react";
import { cn } from "@/lib/utils";

type PublicEvent = {
  slug: string;
  title: string;
  tagline: string | null;
  description: string | null;
  mode: string;
  venue: string | null;
  status: string;
  registrationOpen: boolean;
  minTeamSize: number;
  maxTeamSize: number;
  rules: string | null;
  eligibility: string | null;
  prizes: Array<{ place: string; title: string; description?: string }>;
  faq: Array<{ question: string; answer: string }>;
  registrationClosesAt: string | null;
  eventStartsAt: string | null;
  submissionClosesAt: string | null;
  teamCount: number;
  spotsRemaining: number | null;
  leaderboard: Array<{ rank: number; teamName: string; averageScore: number | null; placement: string }> | null;
};

type MemberDraft = { name: string; email: string; phone: string; linkedinUrl: string };

function VobizLogo({ size = 20 }: { size?: number }) {
  return (
    <div className="inline-flex items-center gap-2 select-none">
      <div className="h-6 w-6 rounded-lg bg-gradient-to-tr from-cyan-500 via-blue-600 to-indigo-500 flex items-center justify-center text-white text-xs font-black shadow-md shadow-cyan-500/30 border border-cyan-400/40">
        V
      </div>
      <span className="text-sm font-extrabold tracking-tight text-white">
        VoBiz <span className="text-cyan-400 font-bold">AI</span>
      </span>
    </div>
  );
}

function LiveCountdown({ targetDate }: { targetDate: string | null }) {
  const [timeLeft, setTimeLeft] = useState<{ days: number; hours: number; minutes: number; seconds: number } | null>(null);

  useEffect(() => {
    if (!targetDate) return;
    const target = new Date(targetDate).getTime();

    const update = () => {
      const now = new Date().getTime();
      const diff = Math.max(0, target - now);

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      setTimeLeft({ days, hours, minutes, seconds });
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [targetDate]);

  if (!timeLeft) return null;

  return (
    <div className="flex items-center justify-center gap-2 sm:gap-4 my-2">
      {[
        { label: "Days", val: timeLeft.days },
        { label: "Hours", val: timeLeft.hours },
        { label: "Mins", val: timeLeft.minutes },
        { label: "Secs", val: timeLeft.seconds },
      ].map((item, i) => (
        <div key={i} className="flex flex-col items-center">
          <div className="h-12 w-12 sm:h-14 sm:w-14 rounded-2xl bg-black/60 border border-cyan-500/30 backdrop-blur-md flex items-center justify-center text-lg sm:text-xl font-mono font-black text-cyan-300 shadow-lg shadow-cyan-950/50">
            {String(item.val).padStart(2, "0")}
          </div>
          <span className="text-[10px] uppercase tracking-wider font-semibold text-cyan-400/80 mt-1">{item.label}</span>
        </div>
      ))}
    </div>
  );
}

export default function PublicEventPage() {
  const [, params] = useRoute("/events/:slug");
  const slug = params?.slug ?? "";

  const [meta, setMeta] = useState<PublicEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState<{ referenceCode: string; teamName: string } | null>(null);

  // Form State
  const [teamName, setTeamName] = useState("");
  const [institution, setInstitution] = useState("");
  const [city, setCity] = useState("");
  const [leaderName, setLeaderName] = useState("");
  const [leaderEmail, setLeaderEmail] = useState("");
  const [leaderPhone, setLeaderPhone] = useState("");
  const [leaderLinkedinUrl, setLeaderLinkedinUrl] = useState("");
  const [members, setMembers] = useState<MemberDraft[]>([]);
  const [otpChallengeToken, setOtpChallengeToken] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [phoneVerificationToken, setPhoneVerificationToken] = useState("");
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpSent, setOtpSent] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/voiceathon/public/${encodeURIComponent(slug)}`)
      .then(async (res) => {
        if (!active) return;
        if (res.status === 404) { setLoadError("notfound"); return; }
        if (!res.ok) { setLoadError("error"); return; }
        setMeta(await res.json());
      })
      .catch(() => { if (active) setLoadError("error"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [slug]);

  useEffect(() => {
    document.title = meta?.title ? `${meta.title} — India's Biggest Voice AI Voice-a-thon` : "SnapServe AI Voice-a-thon";
  }, [meta?.title]);

  const handleSubmit = async () => {
    setSubmitError(null);
    if (!teamName.trim() || !leaderName.trim() || !leaderEmail.trim() || !leaderPhone.trim() || !leaderLinkedinUrl.trim()) {
      setSubmitError("Team name and all team leader profile fields are required.");
      return;
    }
    if (!phoneVerificationToken) {
      setSubmitError("Please verify the team leader's mobile number via OTP before registering.");
      return;
    }
    if (members.some((m) => !m.name.trim() || !m.email.trim() || !m.phone.trim() || !m.linkedinUrl.trim())) {
      setSubmitError("Name, email, mobile, and LinkedIn profile are required for every added team member.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/voiceathon/public/${encodeURIComponent(slug)}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teamName: teamName.trim(),
          institution: institution.trim() || undefined,
          city: city.trim() || undefined,
          leaderName: leaderName.trim(),
          leaderEmail: leaderEmail.trim(),
          leaderPhone: leaderPhone.trim(),
          leaderLinkedinUrl: leaderLinkedinUrl.trim(),
          phoneVerificationToken,
          members: members.filter((m) => m.name.trim()).map((m) => ({
            name: m.name.trim(),
            email: m.email.trim(),
            phone: m.phone.trim(),
            linkedinUrl: m.linkedinUrl.trim(),
          })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSubmitError(body?.error ?? "Registration failed");
        return;
      }
      setDone({ referenceCode: body.referenceCode, teamName: body.teamName });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setSubmitError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const sendOtp = async () => {
    setSubmitError(null);
    if (!leaderPhone.trim() || leaderPhone.trim().length < 10) {
      setSubmitError("Please enter a valid 10-digit mobile number for the team leader.");
      return;
    }
    setOtpBusy(true);
    try {
      const res = await fetch(`/api/voiceathon/public/${encodeURIComponent(slug)}/otp/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: leaderPhone.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setSubmitError(body.error ?? "Could not send verification OTP"); return; }
      setOtpChallengeToken(body.challengeToken);
      setPhoneVerificationToken("");
      setOtpCode("");
      setOtpSent(true);
    } catch {
      setSubmitError("Network error sending OTP. Please try again.");
    } finally {
      setOtpBusy(false);
    }
  };

  const verifyOtp = async () => {
    if (!otpChallengeToken || !otpCode.trim()) return;
    setSubmitError(null);
    setOtpBusy(true);
    try {
      const res = await fetch(`/api/voiceathon/public/${encodeURIComponent(slug)}/otp/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: leaderPhone.trim(), challengeToken: otpChallengeToken, code: otpCode.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setSubmitError(body.error ?? "OTP verification failed. Check code."); return; }
      setPhoneVerificationToken(body.verificationToken);
    } catch {
      setSubmitError("Network error verifying OTP. Please try again.");
    } finally {
      setOtpBusy(false);
    }
  };

  const addMemberSlot = () => {
    if (members.length >= (meta?.maxTeamSize ? meta.maxTeamSize - 1 : 4)) return;
    setMembers([...members, { name: "", email: "", phone: "", linkedinUrl: "" }]);
  };

  const removeMemberSlot = (index: number) => {
    setMembers(members.filter((_, i) => i !== index));
  };

  const updateMember = (index: number, key: keyof MemberDraft, val: string) => {
    const next = [...members];
    next[index] = { ...next[index], [key]: val };
    setMembers(next);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-6 text-center">
        <Loader2 className="h-10 w-10 animate-spin text-cyan-400 mb-4" />
        <p className="text-sm font-medium text-slate-400">Loading Voice-a-thon Event Page...</p>
      </div>
    );
  }

  if (loadError || !meta) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-6 text-center space-y-4">
        <AlertCircle className="h-12 w-12 text-red-400" />
        <h1 className="text-2xl font-bold">{loadError === "notfound" ? "Voice-a-thon Event Not Found" : "Could Not Load Event"}</h1>
        <p className="text-sm text-slate-400 max-w-sm">Please verify the event link or browse active Voice-a-thon events.</p>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-6 text-center space-y-6 max-w-xl mx-auto">
        <div className="h-20 w-20 rounded-3xl bg-gradient-to-tr from-emerald-500/20 via-cyan-500/20 to-indigo-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-300 shadow-2xl shadow-cyan-950/50">
          <CheckCircle2 className="h-12 w-12 text-cyan-400" />
        </div>

        <div className="space-y-2">
          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 px-3 py-1">
            REGISTRATION SUBMITTED
          </Badge>
          <h1 className="text-3xl font-black tracking-tight text-white">Team {done.teamName} Registered!</h1>
          <p className="text-sm text-slate-300 max-w-md mx-auto leading-relaxed">
            Your registration for <span className="font-bold text-white">{meta.title}</span> has been received. Our team will verify your profiles and issue your official pass.
          </p>
        </div>

        {/* Digital Ticket Card */}
        <div className="w-full bg-gradient-to-b from-slate-900 via-slate-900/90 to-black border border-cyan-500/30 rounded-3xl p-6 shadow-2xl text-left space-y-4 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-cyan-500/10 rounded-full blur-2xl pointer-events-none" />
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <BrandMark iconSize={22} wordmarkHeight={16} />
            <VobizLogo size={16} />
          </div>
          <div>
            <span className="text-[10px] font-mono text-cyan-400 uppercase tracking-widest block">PASS REF NUMBER</span>
            <span className="text-xl font-mono font-bold text-white tracking-wider">{done.referenceCode}</span>
          </div>
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div>
              <span className="text-slate-400 block text-[10px]">TEAM NAME</span>
              <span className="font-semibold text-slate-200">{done.teamName}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-[10px]">EVENT MODE</span>
              <span className="font-semibold text-cyan-400 uppercase">{meta.mode}</span>
            </div>
          </div>
        </div>

        <div className="pt-2">
          <p className="text-xs text-slate-400">An official confirmation email with your pass details has been dispatched.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 selection:bg-cyan-500 selection:text-black">
      {/* ── Top Announcement Banner ── */}
      <div className="bg-gradient-to-r from-cyan-950 via-slate-900 to-indigo-950 border-b border-cyan-500/20 text-center py-2 px-4 text-xs font-semibold tracking-wide text-cyan-300 flex items-center justify-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-cyan-400 animate-pulse shrink-0" />
        <span>INDIA&apos;S BIGGEST VOICE AI VOICE-A-THON · REGISTER YOUR TEAM NOW</span>
        <Badge variant="outline" className="bg-cyan-500/20 text-cyan-300 border-cyan-400/40 text-[9px] px-2 ml-2 hidden sm:inline-flex">
          LIVE REGISTRATION
        </Badge>
      </div>

      {/* ── Navbar Branding Header ── */}
      <header className="border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BrandMark iconSize={24} wordmarkHeight={18} />
            <span className="text-slate-600 font-light text-lg">×</span>
            <VobizLogo size={20} />
          </div>

          <div className="flex items-center gap-3">
            <Badge variant="outline" className="bg-cyan-500/10 text-cyan-400 border-cyan-500/30 text-xs py-1 px-3 hidden md:inline-flex items-center gap-1.5">
              <Cpu className="h-3.5 w-3.5" /> Powered by VoBiz AI
            </Badge>
            <a href="#register">
              <Button size="sm" className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-black font-extrabold text-xs px-4 rounded-xl shadow-lg shadow-cyan-500/25">
                Register Team
              </Button>
            </a>
          </div>
        </div>
      </header>

      {/* ── Hero Section ── */}
      <section className="relative pt-12 pb-16 px-4 sm:px-6 overflow-hidden">
        {/* Background Ambient Glows */}
        <div className="absolute top-10 left-1/2 -translate-x-1/2 w-96 h-96 bg-gradient-to-tr from-cyan-600/20 via-blue-600/20 to-purple-600/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-40 right-10 w-64 h-64 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none" />

        <div className="max-w-4xl mx-auto text-center relative z-10 space-y-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-4 py-1.5 text-xs font-semibold text-cyan-300 backdrop-blur-md">
            <Mic className="h-3.5 w-3.5 text-cyan-400" />
            <span>SnapServe AI Voice-a-thon</span>
            <span className="text-slate-500">·</span>
            <span className="text-white font-bold">Powered by VoBiz AI</span>
          </div>

          <h1 className="text-4xl sm:text-6xl font-black tracking-tight text-white leading-tight">
            {meta.title}
          </h1>

          <p className="text-lg sm:text-xl font-bold bg-gradient-to-r from-cyan-400 via-sky-200 to-indigo-300 bg-clip-text text-transparent max-w-2xl mx-auto">
            India&apos;s Biggest Voice AI Voice-a-thon for all Voice AI Creators
          </p>

          {meta.tagline && (
            <p className="text-sm text-slate-400 max-w-2xl mx-auto leading-relaxed">
              {meta.tagline}
            </p>
          )}

          {/* Event Meta Pills */}
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2 text-xs font-medium text-slate-300">
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800">
              <MapPin className="h-3.5 w-3.5 text-cyan-400" /> Mode: <strong className="text-white uppercase">{meta.mode}</strong>
            </span>
            {meta.venue && (
              <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800">
                <MapPin className="h-3.5 w-3.5 text-cyan-400" /> Venue: <strong className="text-white">{meta.venue}</strong>
              </span>
            )}
            {meta.eventStartsAt && (
              <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800">
                <Calendar className="h-3.5 w-3.5 text-cyan-400" /> Kickoff: <strong className="text-white">{new Date(meta.eventStartsAt).toLocaleDateString()}</strong>
              </span>
            )}
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 border border-slate-800">
              <Users className="h-3.5 w-3.5 text-cyan-400" /> Team Size: <strong className="text-white">{meta.minTeamSize} - {meta.maxTeamSize} Members</strong>
            </span>
          </div>

          {/* Live Countdown */}
          {meta.registrationClosesAt && (
            <div className="pt-4">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest block mb-2">Registration Closes In</span>
              <LiveCountdown targetDate={meta.registrationClosesAt} />
            </div>
          )}
        </div>
      </section>

      {/* ── Prizes Section ── */}
      {meta.prizes?.length > 0 && (
        <section className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
          <div className="text-center mb-8">
            <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/30 mb-2">
              REWARDS &amp; PRIZES
            </Badge>
            <h2 className="text-2xl sm:text-3xl font-black text-white">Prize Pool &amp; Recognition</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {meta.prizes.map((p, i) => (
              <div
                key={i}
                className={cn(
                  "rounded-3xl border p-6 text-center space-y-3 relative overflow-hidden transition-all hover:scale-105",
                  i === 0
                    ? "bg-gradient-to-b from-amber-500/20 via-slate-900 to-black border-amber-500/40 shadow-2xl shadow-amber-950/40"
                    : i === 1
                    ? "bg-gradient-to-b from-slate-400/20 via-slate-900 to-black border-slate-400/40"
                    : "bg-gradient-to-b from-amber-700/20 via-slate-900 to-black border-amber-700/40"
                )}
              >
                <div className="h-12 w-12 rounded-2xl bg-black/60 border border-white/10 mx-auto flex items-center justify-center">
                  <Trophy className={cn("h-6 w-6", i === 0 ? "text-amber-400" : i === 1 ? "text-slate-300" : "text-amber-600")} />
                </div>
                <span className="text-xs font-mono font-bold tracking-widest text-slate-400 uppercase block">{p.place}</span>
                <h3 className="text-xl font-black text-white">{p.title}</h3>
                {p.description && <p className="text-xs text-slate-400 leading-relaxed">{p.description}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Registration Form Section ── */}
      <section id="register" className="max-w-3xl mx-auto px-4 sm:px-6 py-12">
        <div className="rounded-3xl border border-cyan-500/30 bg-gradient-to-b from-slate-900 via-slate-900/90 to-black p-6 sm:p-10 shadow-2xl space-y-8 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />

          <div className="space-y-2 border-b border-slate-800 pb-6">
            <div className="flex items-center justify-between">
              <Badge variant="outline" className="bg-cyan-500/10 text-cyan-400 border-cyan-500/30">
                OFFICIAL REGISTRATION
              </Badge>
              <span className="text-xs text-slate-400 font-mono">
                {meta.spotsRemaining !== null ? `${meta.spotsRemaining} Spots Remaining` : `${meta.teamCount} Teams Registered`}
              </span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-black text-white">Register Your Team</h2>
            <p className="text-xs text-slate-400">
              Complete the leader verification and team details below to reserve your Voice-a-thon slot.
            </p>
          </div>

          {submitError && (
            <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/30 text-xs text-red-300 flex items-center gap-3">
              <AlertCircle className="h-5 w-5 shrink-0 text-red-400" />
              <span>{submitError}</span>
            </div>
          )}

          {/* Form Fields */}
          <div className="space-y-6">
            {/* Step 1: Team & Institution Info */}
            <div className="space-y-4">
              <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-widest flex items-center gap-2">
                <Users className="h-4 w-4" /> 1. Team &amp; Institution Details
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-slate-300">Team Name *</Label>
                  <Input
                    placeholder="e.g. Voice Matrix"
                    value={teamName}
                    onChange={(e) => setTeamName(e.target.value)}
                    className="mt-1 bg-slate-950 border-slate-800 text-xs text-white"
                  />
                </div>
                <div>
                  <Label className="text-xs text-slate-300">College / Organization (Optional)</Label>
                  <Input
                    placeholder="e.g. IIT Madras / Startup Inc."
                    value={institution}
                    onChange={(e) => setInstitution(e.target.value)}
                    className="mt-1 bg-slate-950 border-slate-800 text-xs text-white"
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label className="text-xs text-slate-300">City / Location (Optional)</Label>
                  <Input
                    placeholder="e.g. Bengaluru, Karnataka"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className="mt-1 bg-slate-950 border-slate-800 text-xs text-white"
                  />
                </div>
              </div>
            </div>

            {/* Step 2: Leader Profile & Mobile OTP */}
            <div className="space-y-4 pt-4 border-t border-slate-800">
              <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-widest flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" /> 2. Team Leader &amp; Mobile Verification
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-slate-300">Leader Full Name *</Label>
                  <Input
                    placeholder="Karthik S"
                    value={leaderName}
                    onChange={(e) => setLeaderName(e.target.value)}
                    className="mt-1 bg-slate-950 border-slate-800 text-xs text-white"
                  />
                </div>
                <div>
                  <Label className="text-xs text-slate-300">Leader Email *</Label>
                  <Input
                    type="email"
                    placeholder="karthik@example.com"
                    value={leaderEmail}
                    onChange={(e) => setLeaderEmail(e.target.value)}
                    className="mt-1 bg-slate-950 border-slate-800 text-xs text-white"
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label className="text-xs text-slate-300">Leader Mobile Number (10-Digit) *</Label>
                  <div className="flex gap-2 mt-1">
                    <Input
                      placeholder="+91 9876543210"
                      value={leaderPhone}
                      disabled={!!phoneVerificationToken}
                      onChange={(e) => setLeaderPhone(e.target.value)}
                      className="bg-slate-950 border-slate-800 text-xs text-white flex-1 font-mono"
                    />
                    {!phoneVerificationToken && (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={otpBusy}
                        onClick={sendOtp}
                        className="text-xs border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10 shrink-0"
                      >
                        {otpBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : otpSent ? "Resend OTP" : "Send Verification OTP"}
                      </Button>
                    )}
                  </div>
                  {phoneVerificationToken && (
                    <span className="text-[11px] text-emerald-400 flex items-center gap-1 mt-1">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Mobile number verified successfully
                    </span>
                  )}
                </div>

                {/* OTP Input Card */}
                {otpSent && !phoneVerificationToken && (
                  <div className="sm:col-span-2 p-4 rounded-2xl bg-slate-950 border border-cyan-500/30 space-y-2">
                    <Label className="text-xs text-cyan-300">Enter 4-Digit OTP Sent to Mobile</Label>
                    <div className="flex gap-2">
                      <Input
                        placeholder="1234"
                        value={otpCode}
                        onChange={(e) => setOtpCode(e.target.value)}
                        className="bg-slate-900 border-slate-700 text-xs text-white font-mono tracking-widest text-center max-w-[120px]"
                      />
                      <Button
                        type="button"
                        disabled={otpBusy || !otpCode.trim()}
                        onClick={verifyOtp}
                        className="bg-cyan-500 hover:bg-cyan-400 text-black text-xs font-bold"
                      >
                        {otpBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Verify Code"}
                      </Button>
                    </div>
                  </div>
                )}

                <div className="sm:col-span-2">
                  <Label className="text-xs text-slate-300">Leader LinkedIn Profile URL *</Label>
                  <Input
                    placeholder="https://www.linkedin.com/in/yourprofile"
                    value={leaderLinkedinUrl}
                    onChange={(e) => setLeaderLinkedinUrl(e.target.value)}
                    className="mt-1 bg-slate-950 border-slate-800 text-xs text-white"
                  />
                </div>
              </div>
            </div>

            {/* Step 3: Dynamic Team Members */}
            <div className="space-y-4 pt-4 border-t border-slate-800">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-widest flex items-center gap-2">
                  <Users className="h-4 w-4" /> 3. Additional Team Members ({members.length})
                </h3>
                {members.length < (meta.maxTeamSize - 1) && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addMemberSlot}
                    className="h-7 text-xs border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/10 gap-1"
                  >
                    <Plus className="h-3 w-3" /> Add Member
                  </Button>
                )}
              </div>

              {members.length === 0 ? (
                <p className="text-xs text-slate-500 italic">No additional team members added. Click + Add Member if participating as a team.</p>
              ) : (
                <div className="space-y-4">
                  {members.map((m, idx) => (
                    <div key={idx} className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3 relative">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-300">Team Member #{idx + 2}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeMemberSlot(idx)}
                          className="h-6 w-6 p-0 text-slate-500 hover:text-red-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <Input
                          placeholder="Member Name *"
                          value={m.name}
                          onChange={(e) => updateMember(idx, "name", e.target.value)}
                          className="bg-slate-900 border-slate-800 text-xs text-white"
                        />
                        <Input
                          type="email"
                          placeholder="Member Email *"
                          value={m.email}
                          onChange={(e) => updateMember(idx, "email", e.target.value)}
                          className="bg-slate-900 border-slate-800 text-xs text-white"
                        />
                        <Input
                          placeholder="Member Mobile *"
                          value={m.phone}
                          onChange={(e) => updateMember(idx, "phone", e.target.value)}
                          className="bg-slate-900 border-slate-800 text-xs text-white font-mono"
                        />
                        <Input
                          placeholder="LinkedIn Profile URL *"
                          value={m.linkedinUrl}
                          onChange={(e) => updateMember(idx, "linkedinUrl", e.target.value)}
                          className="bg-slate-900 border-slate-800 text-xs text-white"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Submit Registration Button */}
            <div className="pt-4">
              <Button
                disabled={submitting}
                onClick={handleSubmit}
                className="w-full h-14 rounded-2xl bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-black font-black text-base shadow-xl shadow-cyan-500/20 gap-2"
              >
                {submitting ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    <Sparkles className="h-5 w-5" />
                    Submit Voice-a-thon Registration
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Event Details & FAQ Section ── */}
      <section className="max-w-4xl mx-auto px-4 sm:px-6 py-12 space-y-12">
        {meta.description && (
          <div className="space-y-3">
            <h3 className="text-xl font-bold text-white flex items-center gap-2">
              <Zap className="h-5 w-5 text-cyan-400" /> About the Event
            </h3>
            <p className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed bg-slate-900/60 p-6 rounded-3xl border border-slate-800">
              {meta.description}
            </p>
          </div>
        )}

        {meta.rules && (
          <div className="space-y-3">
            <h3 className="text-xl font-bold text-white flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-cyan-400" /> Hackathon Rules &amp; Evaluation
            </h3>
            <p className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed bg-slate-900/60 p-6 rounded-3xl border border-slate-800">
              {meta.rules}
            </p>
          </div>
        )}
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-slate-900 py-10 px-4 text-center text-xs text-slate-500 space-y-4">
        <div className="flex items-center justify-center gap-3">
          <BrandMark iconSize={20} wordmarkHeight={14} />
          <span className="text-slate-600">×</span>
          <VobizLogo size={16} />
        </div>
        <p>© 2026 SnapServe AI &amp; VoBiz AI. All rights reserved. India&apos;s Biggest Voice AI Voice-a-thon.</p>
      </footer>
    </div>
  );
}
