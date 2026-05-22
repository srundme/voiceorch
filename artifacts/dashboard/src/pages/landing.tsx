import { Link } from "wouter";
import { useEffect, useRef, useState } from "react";
import { SnapServeLogo, SnapServeIcon } from "@/components/logo";
import {
  Zap, Shield, Globe, Mic, Brain, Volume2, PhoneCall,
  BarChart3, Lock, ChevronRight, ArrowRight, Check,
  Activity, Layers, GitBranch,
} from "lucide-react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

/* ── Animated counter ──────────────────────────────────────────────────── */
function Counter({ target, suffix = "", prefix = "" }: { target: number; suffix?: string; prefix?: string }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      observer.disconnect();
      const duration = 1800;
      const start = performance.now();
      const tick = (now: number) => {
        const p = Math.min((now - start) / duration, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        setCount(Math.floor(eased * target));
        if (p < 1) requestAnimationFrame(tick);
        else setCount(target);
      };
      requestAnimationFrame(tick);
    }, { threshold: 0.5 });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [target]);
  return <span ref={ref}>{prefix}{count.toLocaleString()}{suffix}</span>;
}

/* ── Pipeline node ─────────────────────────────────────────────────────── */
function PipelineNode({ label, sub, color, delay }: { label: string; sub: string; color: string; delay: string }) {
  return (
    <div
      className="flex flex-col items-center gap-1.5 animate-float"
      style={{ animationDelay: delay }}
    >
      <div className={`relative w-16 h-16 rounded-2xl border ${color} flex items-center justify-center backdrop-blur-sm`}
        style={{ boxShadow: `0 0 24px -4px currentColor, inset 0 0 16px -8px currentColor` }}>
        <div className="absolute inset-0 rounded-2xl opacity-10 bg-current" />
        <span className="text-[10px] font-bold tracking-widest text-current uppercase">{label}</span>
      </div>
      <span className="text-[10px] text-white/30 font-medium">{sub}</span>
    </div>
  );
}

/* ── Connector line ────────────────────────────────────────────────────── */
function Connector() {
  return (
    <div className="flex items-center gap-0 mt-[-20px]">
      <div className="h-px w-10 bg-gradient-to-r from-white/10 to-violet-500/60" />
      <div className="w-1.5 h-1.5 rounded-full bg-violet-400 shadow-[0_0_8px_2px_rgba(139,92,246,0.8)] animate-pulse" />
      <div className="h-px w-10 bg-gradient-to-r from-violet-500/60 to-white/10" />
    </div>
  );
}

/* ── Feature card ──────────────────────────────────────────────────────── */
function FeatureCard({ icon: Icon, title, desc, accent }: { icon: React.ElementType; title: string; desc: string; accent: string }) {
  return (
    <div className={`group relative rounded-2xl border border-white/[0.07] bg-white/[0.03] p-6 hover:border-white/[0.12] hover:bg-white/[0.05] transition-all duration-300 overflow-hidden`}>
      <div className={`absolute top-0 right-0 w-24 h-24 rounded-full blur-3xl opacity-0 group-hover:opacity-20 transition-opacity duration-500 ${accent}`} />
      <div className={`inline-flex h-10 w-10 items-center justify-center rounded-xl mb-4 ${accent} bg-opacity-10`}
        style={{ background: `rgba(139,92,246,0.1)` }}>
        <Icon className="h-5 w-5 text-violet-400" />
      </div>
      <h3 className="text-sm font-semibold text-white mb-2">{title}</h3>
      <p className="text-xs text-white/40 leading-relaxed">{desc}</p>
    </div>
  );
}

/* ── Use case pill ─────────────────────────────────────────────────────── */
function UseCase({ title, desc, stat }: { title: string; desc: string; stat: string }) {
  return (
    <div className="group flex flex-col gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5 hover:border-violet-500/30 hover:bg-violet-500/5 transition-all duration-300 cursor-default">
      <div className="flex items-start justify-between">
        <h3 className="text-sm font-semibold text-white/80 group-hover:text-white transition-colors">{title}</h3>
        <span className="text-[10px] font-bold text-violet-400 bg-violet-500/10 px-2 py-0.5 rounded-full border border-violet-500/20">{stat}</span>
      </div>
      <p className="text-xs text-white/35 leading-relaxed">{desc}</p>
    </div>
  );
}

/* ── Provider badge ────────────────────────────────────────────────────── */
function ProviderBadge({ name, type }: { name: string; type: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-3 hover:border-white/[0.12] transition-colors">
      <div className="h-6 w-6 rounded-md bg-white/10 flex items-center justify-center">
        <span className="text-[9px] font-bold text-white/50">{name.slice(0, 2).toUpperCase()}</span>
      </div>
      <div>
        <p className="text-xs font-medium text-white/70">{name}</p>
        <p className="text-[9px] text-white/30">{type}</p>
      </div>
    </div>
  );
}

/* ── Pricing card ──────────────────────────────────────────────────────── */
function PricingCard({ plan, price, unit, desc, features, cta, highlighted }: {
  plan: string; price: string; unit: string; desc: string;
  features: string[]; cta: string; highlighted?: boolean;
}) {
  return (
    <div className={`relative rounded-2xl p-px ${highlighted ? "bg-gradient-to-b from-violet-500/60 to-blue-500/30" : "bg-white/[0.07]"}`}>
      {highlighted && (
        <div className="absolute -top-3 left-1/2 -translate-x-1/2">
          <span className="bg-gradient-to-r from-violet-500 to-blue-500 text-white text-[10px] font-bold px-3 py-1 rounded-full tracking-wide">MOST POPULAR</span>
        </div>
      )}
      <div className={`rounded-2xl p-6 h-full flex flex-col gap-5 ${highlighted ? "bg-[#0D0D18]" : "bg-[#0A0A14]"}`}>
        <div>
          <p className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-3">{plan}</p>
          <div className="flex items-end gap-1.5 mb-1">
            <span className="text-3xl font-bold text-white">{price}</span>
            <span className="text-sm text-white/40 mb-1">{unit}</span>
          </div>
          <p className="text-xs text-white/30">{desc}</p>
        </div>
        <ul className="flex flex-col gap-2.5 flex-1">
          {features.map(f => (
            <li key={f} className="flex items-start gap-2.5 text-xs text-white/60">
              <Check className="h-3.5 w-3.5 text-violet-400 mt-0.5 shrink-0" />
              {f}
            </li>
          ))}
        </ul>
        <Link href={`${basePath}/sign-up`}>
          <button className={`w-full rounded-xl py-2.5 text-sm font-semibold transition-all duration-200 ${
            highlighted
              ? "bg-gradient-to-r from-violet-600 to-blue-600 text-white hover:from-violet-500 hover:to-blue-500 shadow-[0_0_20px_-4px_rgba(139,92,246,0.5)]"
              : "border border-white/10 text-white/60 hover:border-white/20 hover:text-white/80"
          }`}>{cta}</button>
        </Link>
      </div>
    </div>
  );
}

/* ── Main landing page ─────────────────────────────────────────────────── */
export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#07070F] text-white overflow-x-hidden">

      {/* ── Ambient background ─────────────────────────────────────── */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-[-20%] left-[10%] w-[600px] h-[600px] rounded-full bg-violet-600/10 blur-[120px]" />
        <div className="absolute top-[30%] right-[-10%] w-[500px] h-[500px] rounded-full bg-blue-600/8 blur-[120px]" />
        <div className="absolute bottom-[10%] left-[30%] w-[400px] h-[400px] rounded-full bg-indigo-600/6 blur-[100px]" />
        {/* Grid overlay */}
        <div className="absolute inset-0"
          style={{
            backgroundImage: `linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)`,
            backgroundSize: "64px 64px",
          }} />
      </div>

      {/* ── Navigation ─────────────────────────────────────────────── */}
      <nav className="relative z-50 flex items-center justify-between px-8 h-16 border-b border-white/[0.06] backdrop-blur-xl bg-white/[0.02]">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-600 shadow-[0_0_16px_rgba(139,92,246,0.5)]">
            <SnapServeIcon size={16} className="text-white" />
          </div>
          <SnapServeLogo size="sm" className="text-white" />
        </div>

        <div className="hidden md:flex items-center gap-8">
          {["Product", "Use Cases", "Pricing", "Docs"].map(item => (
            <a key={item} href={`#${item.toLowerCase().replace(" ", "-")}`}
              className="text-sm text-white/40 hover:text-white/80 transition-colors font-medium">
              {item}
            </a>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <Link href={`${basePath}/sign-in`}>
            <button className="text-sm text-white/40 hover:text-white/70 transition-colors font-medium px-3 py-1.5">Sign in</button>
          </Link>
          <Link href={`${basePath}/sign-up`}>
            <button className="text-sm font-semibold bg-gradient-to-r from-violet-600 to-blue-600 text-white px-4 py-1.5 rounded-lg hover:from-violet-500 hover:to-blue-500 transition-all shadow-[0_0_16px_-2px_rgba(139,92,246,0.4)] hover:shadow-[0_0_20px_-2px_rgba(139,92,246,0.6)]">
              Get started free
            </button>
          </Link>
        </div>
      </nav>

      {/* ── Hero ───────────────────────────────────────────────────── */}
      <section className="relative z-10 flex flex-col items-center text-center px-6 pt-28 pb-24 gap-8">

        {/* Tag */}
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 text-violet-300 text-xs font-semibold tracking-wide">
          <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
          Voice Infrastructure for the AI Era — From $0.03 / min
        </div>

        {/* Headline */}
        <div className="max-w-4xl">
          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-black tracking-tight leading-[1.05] mb-6">
            <span className="text-white">Build AI Voice Agents</span>
            <br />
            <span className="bg-gradient-to-r from-violet-400 via-blue-400 to-violet-400 bg-clip-text text-transparent">
              That Scale
            </span>
          </h1>
          <p className="text-lg text-white/40 leading-relaxed max-w-2xl mx-auto">
            Deploy intelligent voice agents in minutes. Bring your own ASR, LLM, and TTS providers — or use ours.
            We handle the real-time orchestration pipeline end-to-end.
          </p>
        </div>

        {/* CTAs */}
        <div className="flex items-center gap-4 flex-wrap justify-center">
          <Link href={`${basePath}/sign-up`}>
            <button className="flex items-center gap-2 px-7 py-3.5 rounded-xl font-bold text-sm bg-gradient-to-r from-violet-600 to-blue-600 text-white shadow-[0_0_30px_-4px_rgba(139,92,246,0.6)] hover:shadow-[0_0_40px_-4px_rgba(139,92,246,0.8)] hover:from-violet-500 hover:to-blue-500 transition-all duration-200">
              Start Building Free
              <ArrowRight className="h-4 w-4" />
            </button>
          </Link>
          <a href="#use-cases">
            <button className="flex items-center gap-2 px-7 py-3.5 rounded-xl font-bold text-sm border border-white/10 text-white/60 hover:border-white/20 hover:text-white/80 transition-all duration-200">
              See Use Cases
              <ChevronRight className="h-4 w-4" />
            </button>
          </a>
        </div>

        {/* 3D Pipeline Visualization */}
        <div className="relative mt-12 w-full max-w-3xl mx-auto">
          {/* Glow backdrop */}
          <div className="absolute inset-0 bg-gradient-to-r from-violet-600/10 via-blue-600/10 to-violet-600/10 rounded-3xl blur-2xl scale-110" />

          <div className="relative rounded-2xl border border-white/[0.07] bg-white/[0.02] backdrop-blur-sm p-8 overflow-hidden"
            style={{ perspective: "800px", transformStyle: "preserve-3d" }}>

            {/* Inner glow */}
            <div className="absolute inset-0 rounded-2xl"
              style={{ background: "radial-gradient(ellipse at center top, rgba(139,92,246,0.08) 0%, transparent 70%)" }} />

            {/* Scan line */}
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-violet-500/40 to-transparent animate-scan" />

            <div className="relative flex items-center justify-center gap-0">
              {/* Caller in */}
              <div className="flex flex-col items-center gap-1.5">
                <div className="w-14 h-14 rounded-xl border border-white/10 bg-white/5 flex items-center justify-center">
                  <PhoneCall className="h-5 w-5 text-white/40" />
                </div>
                <span className="text-[9px] text-white/25 font-medium">CALLER</span>
              </div>

              <div className="flex items-center mt-[-20px]">
                <div className="h-px w-6 bg-gradient-to-r from-white/10 to-violet-500/50" />
                <div className="w-1.5 h-1.5 rounded-full bg-violet-400 shadow-[0_0_8px_rgba(139,92,246,0.9)] animate-pulse" />
                <div className="h-px w-6 bg-gradient-to-r from-violet-500/50 to-cyan-500/50" />
              </div>

              <PipelineNode label="ASR" sub="Transcription" color="border-cyan-500/40 text-cyan-400" delay="0s" />

              <div className="flex items-center mt-[-20px]">
                <div className="h-px w-6 bg-gradient-to-r from-cyan-500/50 to-violet-500/50" />
                <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.9)] animate-pulse" style={{ animationDelay: "0.3s" }} />
                <div className="h-px w-6 bg-gradient-to-r from-violet-500/50 to-violet-500/50" />
              </div>

              <PipelineNode label="LLM" sub="Reasoning" color="border-violet-500/40 text-violet-400" delay="0.2s" />

              <div className="flex items-center mt-[-20px]">
                <div className="h-px w-6 bg-gradient-to-r from-violet-500/50 to-emerald-500/50" />
                <div className="w-1.5 h-1.5 rounded-full bg-violet-400 shadow-[0_0_8px_rgba(139,92,246,0.9)] animate-pulse" style={{ animationDelay: "0.6s" }} />
                <div className="h-px w-6 bg-gradient-to-r from-emerald-500/50 to-emerald-500/50" />
              </div>

              <PipelineNode label="TTS" sub="Synthesis" color="border-emerald-500/40 text-emerald-400" delay="0.4s" />

              <div className="flex items-center mt-[-20px]">
                <div className="h-px w-6 bg-gradient-to-r from-emerald-500/50 to-white/10" />
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)] animate-pulse" style={{ animationDelay: "0.9s" }} />
                <div className="h-px w-6 bg-gradient-to-r from-white/10 to-white/5" />
              </div>

              {/* Caller out */}
              <div className="flex flex-col items-center gap-1.5">
                <div className="w-14 h-14 rounded-xl border border-emerald-500/20 bg-emerald-500/5 flex items-center justify-center">
                  <Volume2 className="h-5 w-5 text-emerald-400/60" />
                </div>
                <span className="text-[9px] text-white/25 font-medium">RESPONSE</span>
              </div>
            </div>

            {/* Latency badge */}
            <div className="absolute bottom-4 right-5 flex items-center gap-1.5 text-[10px] text-white/30 font-mono">
              <Activity className="h-3 w-3 text-emerald-400" />
              avg 180ms end-to-end
            </div>

            {/* Corner accent */}
            <div className="absolute top-3 left-4 text-[9px] font-mono text-white/15 tracking-widest">ORCHESTRATION LAYER v2</div>
          </div>
        </div>
      </section>

      {/* ── Metrics Bar ────────────────────────────────────────────── */}
      <section className="relative z-10 border-y border-white/[0.05] bg-white/[0.01] py-10">
        <div className="max-w-4xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-6 px-8">
          {[
            { value: 10, suffix: "M+", label: "Minutes Processed" },
            { value: 180, suffix: "ms", prefix: "<", label: "Pipeline Latency" },
            { value: 15, suffix: "+", label: "Supported Providers" },
            { value: 99, suffix: ".9%", label: "Uptime SLA" },
          ].map(({ value, suffix, prefix, label }) => (
            <div key={label} className="text-center">
              <div className="text-3xl font-black text-white mb-1 tabular-nums">
                <Counter target={value} suffix={suffix} prefix={prefix} />
              </div>
              <p className="text-xs text-white/30 font-medium">{label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works ───────────────────────────────────────────── */}
      <section id="product" className="relative z-10 max-w-5xl mx-auto px-8 py-28">
        <div className="text-center mb-16">
          <p className="text-xs font-bold text-violet-400 tracking-widest uppercase mb-3">How It Works</p>
          <h2 className="text-3xl sm:text-4xl font-bold text-white">From zero to deployed in three steps</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
          {/* Connector line */}
          <div className="hidden md:block absolute top-12 left-[33%] right-[33%] h-px bg-gradient-to-r from-violet-500/0 via-violet-500/40 to-violet-500/0" />

          {[
            {
              step: "01",
              title: "Connect Providers",
              desc: "Add your API keys for Deepgram, OpenAI, ElevenLabs, Twilio — or use our managed keys. Zero lock-in, switch anytime.",
              icon: Layers,
            },
            {
              step: "02",
              title: "Configure Your Agent",
              desc: "Define the system prompt, pick a voice, set call flow rules, escalation triggers, and silence handling — all from the dashboard.",
              icon: Brain,
            },
            {
              step: "03",
              title: "Deploy and Scale",
              desc: "Get a phone number, connect to your CRM, and go live. Every call is logged with full transcripts and latency metrics.",
              icon: Zap,
            },
          ].map(({ step, title, desc, icon: Icon }) => (
            <div key={step} className="relative flex flex-col gap-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
                  <Icon className="h-5 w-5 text-violet-400" />
                </div>
                <span className="text-[10px] font-black text-white/15 tracking-widest">{step}</span>
              </div>
              <h3 className="text-base font-bold text-white">{title}</h3>
              <p className="text-xs text-white/35 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Core Capabilities ──────────────────────────────────────── */}
      <section className="relative z-10 max-w-5xl mx-auto px-8 py-10">
        <div className="text-center mb-16">
          <p className="text-xs font-bold text-violet-400 tracking-widest uppercase mb-3">Capabilities</p>
          <h2 className="text-3xl sm:text-4xl font-bold text-white">Everything the pipeline needs</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <FeatureCard icon={Zap} title="Sub-200ms Pipeline" accent="bg-violet-500"
            desc="ASR → LLM → TTS stitched together with streaming at every stage. Callers hear a response before the LLM finishes generating." />
          <FeatureCard icon={Shield} title="BYOK or Managed" accent="bg-blue-500"
            desc="Bring your own Deepgram, OpenAI, and Twilio keys for full cost control — or use our managed keys at $0.035/min." />
          <FeatureCard icon={Globe} title="Multilingual" accent="bg-cyan-500"
            desc="Hindi, Tamil, Telugu, Malayalam, Bengali, English and more. Sarvam ASR for Indian languages, multilingual LLM routing built in." />
          <FeatureCard icon={GitBranch} title="Smart Call Routing" accent="bg-emerald-500"
            desc="Trigger call transfers, detect intent, end calls on phrase detection, or escalate to human agents — all configurable per agent." />
          <FeatureCard icon={BarChart3} title="Analytics and Transcripts" accent="bg-amber-500"
            desc="Every call logged with full transcript, per-segment latency breakdown, success tracking, and filterable call history." />
          <FeatureCard icon={Lock} title="Enterprise Security" accent="bg-rose-500"
            desc="Provider keys scoped per user, session data encrypted in transit, zero long-term audio retention. SOC 2 in progress." />
        </div>
      </section>

      {/* ── Provider Ecosystem ─────────────────────────────────────── */}
      <section className="relative z-10 max-w-5xl mx-auto px-8 py-24">
        <div className="text-center mb-12">
          <p className="text-xs font-bold text-violet-400 tracking-widest uppercase mb-3">Integrations</p>
          <h2 className="text-3xl font-bold text-white">Your providers, your control</h2>
          <p className="text-sm text-white/35 mt-3">Plug in any combination across the full stack</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <ProviderBadge name="Deepgram" type="ASR" />
          <ProviderBadge name="Sarvam" type="ASR · LLM" />
          <ProviderBadge name="Whisper" type="ASR" />
          <ProviderBadge name="OpenAI" type="LLM · TTS" />
          <ProviderBadge name="Anthropic" type="LLM" />
          <ProviderBadge name="Google Gemini" type="LLM" />
          <ProviderBadge name="Groq" type="LLM" />
          <ProviderBadge name="DeepSeek" type="LLM" />
          <ProviderBadge name="ElevenLabs" type="TTS" />
          <ProviderBadge name="Cartesia" type="TTS" />
          <ProviderBadge name="AWS Polly" type="TTS" />
          <ProviderBadge name="Twilio" type="Telephony" />
          <ProviderBadge name="Plivo" type="Telephony" />
          <ProviderBadge name="VoBiz" type="Telephony" />
          <ProviderBadge name="Vonage" type="Telephony" />
          <div className="flex items-center gap-2.5 rounded-xl border border-dashed border-white/[0.07] px-4 py-3 text-white/20 text-xs font-medium">
            + more coming
          </div>
        </div>
      </section>

      {/* ── Use Cases ──────────────────────────────────────────────── */}
      <section id="use-cases" className="relative z-10 max-w-5xl mx-auto px-8 py-10 pb-28">
        <div className="text-center mb-16">
          <p className="text-xs font-bold text-violet-400 tracking-widest uppercase mb-3">Use Cases</p>
          <h2 className="text-3xl sm:text-4xl font-bold text-white">What teams build with SnapServe</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <UseCase title="Customer Support" stat="24/7"
            desc="Handle FAQs, order status, and complaints autonomously. Escalate to human agents only when needed." />
          <UseCase title="Sales Outreach" stat="3x lift"
            desc="Warm-introduce your product, qualify interest, and book demos — at scale with no SDR time wasted." />
          <UseCase title="Collections and Reminders" stat="40% recovery"
            desc="Automate EMI reminders, overdue payment nudges, and collections follow-up calls in any language." />
          <UseCase title="Appointment Scheduling" stat="Zero no-shows"
            desc="Confirm, reschedule, and remind patients, clients, or candidates about upcoming appointments." />
          <UseCase title="COD Confirmation" stat="99% accuracy"
            desc="Confirm cash-on-delivery orders before dispatch, reduce RTO, and save last-mile logistics costs." />
          <UseCase title="Lead Qualification" stat="5x pipeline"
            desc="Run inbound qualification calls the moment a form is submitted. Score leads and route to the right rep." />
        </div>
      </section>

      {/* ── Pricing ────────────────────────────────────────────────── */}
      <section id="pricing" className="relative z-10 max-w-5xl mx-auto px-8 pb-28">
        <div className="text-center mb-16">
          <p className="text-xs font-bold text-violet-400 tracking-widest uppercase mb-3">Pricing</p>
          <h2 className="text-3xl sm:text-4xl font-bold text-white">Simple, usage-based pricing</h2>
          <p className="text-sm text-white/35 mt-3">No seats, no monthly minimums. Pay for what you use.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
          <PricingCard
            plan="Starter"
            price="$0.03"
            unit="/ min"
            desc="Bring your own provider API keys"
            features={[
              "BYOK — full cost control",
              "Unlimited agents",
              "Call transcripts and analytics",
              "Deepgram, OpenAI, Twilio support",
              "$5 free credit on signup",
            ]}
            cta="Start free"
          />
          <PricingCard
            plan="Managed"
            price="$0.035"
            unit="/ min"
            desc="We manage all provider keys for you"
            features={[
              "Zero setup — keys managed by us",
              "Indian language support included",
              "Cartesia voices out of the box",
              "Priority call routing",
              "SLA-backed uptime",
            ]}
            cta="Get started"
            highlighted
          />
          <PricingCard
            plan="Enterprise"
            price="Custom"
            unit=""
            desc="For high-volume or on-premise needs"
            features={[
              "Dedicated infrastructure",
              "Custom SLA and support",
              "On-premise deployment option",
              "SSO and advanced security",
              "Dedicated success engineer",
            ]}
            cta="Contact sales"
          />
        </div>
      </section>

      {/* ── Final CTA ──────────────────────────────────────────────── */}
      <section className="relative z-10 px-8 pb-28">
        <div className="max-w-3xl mx-auto rounded-3xl border border-violet-500/20 bg-gradient-to-b from-violet-500/10 to-blue-500/5 p-12 text-center relative overflow-hidden">
          <div className="absolute inset-0 rounded-3xl"
            style={{ background: "radial-gradient(ellipse at center, rgba(139,92,246,0.08) 0%, transparent 70%)" }} />
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-violet-500/40 to-transparent" />

          <div className="relative">
            <p className="text-xs font-bold text-violet-400 tracking-widest uppercase mb-4">Ready to Deploy</p>
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
              Your first voice agent,<br />live in minutes
            </h2>
            <p className="text-sm text-white/40 mb-8 max-w-lg mx-auto leading-relaxed">
              No infrastructure to manage, no WebSocket code to write. Connect your providers, configure your agent, get a number, and start taking calls.
            </p>
            <div className="flex items-center justify-center gap-4 flex-wrap">
              <Link href={`${basePath}/sign-up`}>
                <button className="flex items-center gap-2 px-8 py-3.5 rounded-xl font-bold text-sm bg-gradient-to-r from-violet-600 to-blue-600 text-white shadow-[0_0_30px_-4px_rgba(139,92,246,0.6)] hover:shadow-[0_0_40px_-4px_rgba(139,92,246,0.8)] hover:from-violet-500 hover:to-blue-500 transition-all duration-200">
                  Start Building Free
                  <ArrowRight className="h-4 w-4" />
                </button>
              </Link>
              <p className="text-xs text-white/25">$5 credit included — no credit card required</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────── */}
      <footer className="relative z-10 border-t border-white/[0.05] px-8 py-10">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-violet-600/80">
              <SnapServeIcon size={13} className="text-white" />
            </div>
            <span className="text-sm font-semibold text-white/50">SnapServe</span>
          </div>
          <p className="text-xs text-white/20">AI Voice Agent Orchestration Platform — Built for scale</p>
          <div className="flex items-center gap-6">
            {["Privacy", "Terms", "Docs", "Status"].map(item => (
              <a key={item} href="#" className="text-xs text-white/25 hover:text-white/50 transition-colors">{item}</a>
            ))}
          </div>
        </div>
      </footer>

      {/* ── Animations ─────────────────────────────────────────────── */}
      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-6px); }
        }
        @keyframes scan {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        .animate-float { animation: float 3s ease-in-out infinite; }
        .animate-scan { animation: scan 3s linear infinite; }
      `}</style>
    </div>
  );
}
