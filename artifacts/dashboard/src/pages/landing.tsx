import { Link } from "wouter";
import { useEffect, useRef, useState } from "react";
import { SnapServeLogo, SnapServeIcon } from "@/components/logo";
import { ArrowRight, Check, ChevronDown } from "lucide-react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

/* ─── Animated waveform canvas ───────────────────────────────────────────── */
function WaveformCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let t = 0;

    const resize = () => {
      canvas.width  = canvas.offsetWidth  * devicePixelRatio;
      canvas.height = canvas.offsetHeight * devicePixelRatio;
      ctx.scale(devicePixelRatio, devicePixelRatio);
    };
    resize();
    window.addEventListener("resize", resize);

    const draw = () => {
      const W = canvas.offsetWidth;
      const H = canvas.offsetHeight;
      ctx.clearRect(0, 0, W, H);

      // Three overlapping waves
      const waves = [
        { freq: 0.018, amp: 28, speed: 0.022, color: "rgba(124, 58, 237, 0.55)", width: 2 },
        { freq: 0.028, amp: 18, speed: 0.034, color: "rgba(99, 102, 241, 0.40)", width: 1.5 },
        { freq: 0.012, amp: 40, speed: 0.014, color: "rgba(139, 92, 246, 0.25)", width: 1 },
      ];

      waves.forEach(({ freq, amp, speed, color, width }) => {
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth   = width;
        ctx.shadowColor = color;
        ctx.shadowBlur  = 12;

        for (let x = 0; x <= W; x += 1) {
          const noise = Math.sin(x * 0.04 + t * 0.7) * 6;
          const y = H / 2
            + Math.sin(x * freq + t * speed) * amp
            + Math.sin(x * freq * 2.3 + t * speed * 1.4) * (amp * 0.4)
            + noise;
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      });

      // Scanning dot
      const dotX = ((t * 2.5) % W);
      const dotY = H / 2 + Math.sin(dotX * 0.018 + t * 0.022) * 28;
      const grd  = ctx.createRadialGradient(dotX, dotY, 0, dotX, dotY, 18);
      grd.addColorStop(0, "rgba(167,139,250,0.9)");
      grd.addColorStop(1, "rgba(124,58,237,0)");
      ctx.beginPath();
      ctx.arc(dotX, dotY, 5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(200,180,255,0.95)";
      ctx.shadowColor = "#a78bfa";
      ctx.shadowBlur  = 24;
      ctx.fill();
      ctx.shadowBlur = 0;

      t += 0.6;
      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full"
      style={{ display: "block" }}
    />
  );
}

/* ─── Animated counter ───────────────────────────────────────────────────── */
function Counter({ to, suffix = "", prefix = "" }: { to: number; suffix?: string; prefix?: string }) {
  const [n, setN] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (!e?.isIntersecting) return;
      obs.disconnect();
      const dur = 1600, s = performance.now();
      const tick = (now: number) => {
        const p = Math.min((now - s) / dur, 1);
        setN(Math.floor((1 - Math.pow(1 - p, 4)) * to));
        if (p < 1) requestAnimationFrame(tick);
        else setN(to);
      };
      requestAnimationFrame(tick);
    }, { threshold: 0.6 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [to]);
  return <div ref={ref} className="tabular-nums">{prefix}{n.toLocaleString()}{suffix}</div>;
}

/* ─── Provider chip ──────────────────────────────────────────────────────── */
function Chip({ name, tag }: { name: string; tag: string }) {
  return (
    <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border border-white/[0.07] bg-white/[0.03] hover:border-white/[0.13] hover:bg-white/[0.05] transition-all cursor-default">
      <div className="h-5 w-5 rounded-md bg-white/10 flex items-center justify-center shrink-0">
        <span className="text-[8px] font-black text-white/50 leading-none">{name.slice(0, 2).toUpperCase()}</span>
      </div>
      <div className="leading-none">
        <div className="text-[11px] font-semibold text-white/70">{name}</div>
        <div className="text-[9px] text-white/25 mt-0.5">{tag}</div>
      </div>
    </div>
  );
}

/* ─── Step card ──────────────────────────────────────────────────────────── */
function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="group relative flex flex-col gap-4 p-6 rounded-2xl border border-white/[0.07] bg-white/[0.025] hover:border-white/[0.1] transition-all">
      <span className="text-[10px] font-black tracking-[0.2em] text-white/15">{n}</span>
      <div>
        <h3 className="text-[15px] font-bold text-white mb-2">{title}</h3>
        <p className="text-[13px] text-white/38 leading-[1.7]">{body}</p>
      </div>
    </div>
  );
}

/* ─── Feature card ───────────────────────────────────────────────────────── */
function FCard({ title, body, tag }: { title: string; body: string; tag: string }) {
  return (
    <div className="group relative flex flex-col gap-3 p-5 rounded-2xl border border-white/[0.07] bg-white/[0.02] hover:border-violet-500/25 hover:bg-violet-500/[0.04] transition-all duration-300 overflow-hidden">
      <div className="absolute top-0 right-0 w-20 h-20 bg-violet-500/10 rounded-full blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
      <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-violet-400/70">{tag}</span>
      <h3 className="text-[13px] font-semibold text-white/85">{title}</h3>
      <p className="text-[12px] text-white/35 leading-[1.65]">{body}</p>
    </div>
  );
}

/* ─── Pricing card ───────────────────────────────────────────────────────── */
function PCard({
  plan, price, per, note, items, cta, hot,
}: {
  plan: string; price: string; per: string; note: string;
  items: string[]; cta: string; hot?: boolean;
}) {
  return (
    <div className={`relative rounded-2xl overflow-hidden ${hot ? "p-px bg-gradient-to-b from-violet-500/50 via-violet-500/20 to-transparent" : "border border-white/[0.07]"}`}>
      {hot && (
        <div className="absolute -top-px left-1/2 -translate-x-1/2 z-10">
          <div className="bg-gradient-to-r from-violet-500 to-indigo-500 text-white text-[9px] font-black uppercase tracking-widest px-3 py-1 rounded-b-lg">
            Most Popular
          </div>
        </div>
      )}
      <div className={`h-full flex flex-col gap-6 p-6 rounded-2xl ${hot ? "bg-[#0C0C18]" : "bg-[#08080F]"}`}>
        <div>
          <p className="text-[10px] uppercase tracking-widest font-bold text-white/25 mb-4">{plan}</p>
          <div className="flex items-end gap-1 mb-1.5">
            <span className="text-[32px] font-black text-white leading-none">{price}</span>
            {per && <span className="text-xs text-white/30 mb-1.5">{per}</span>}
          </div>
          <p className="text-[11px] text-white/25">{note}</p>
        </div>
        <ul className="flex flex-col gap-2.5 flex-1">
          {items.map(item => (
            <li key={item} className="flex items-start gap-2 text-[12px] text-white/50 leading-snug">
              <Check className="h-3.5 w-3.5 text-violet-400 mt-0.5 shrink-0" />
              {item}
            </li>
          ))}
        </ul>
        <Link href={`${basePath}/sign-up`}>
          <button className={`w-full py-2.5 rounded-xl text-[13px] font-bold transition-all duration-200 ${
            hot
              ? "bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:from-violet-500 hover:to-indigo-500 shadow-[0_8px_24px_-6px_rgba(124,58,237,0.5)]"
              : "border border-white/[0.08] text-white/50 hover:border-white/[0.15] hover:text-white/70"
          }`}>{cta}</button>
        </Link>
      </div>
    </div>
  );
}

/* ─── Main ───────────────────────────────────────────────────────────────── */
export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#050508] text-white antialiased overflow-x-hidden">

      {/* ── Background ────────────────────────────────────────────── */}
      <div className="fixed inset-0 pointer-events-none select-none" aria-hidden>
        <div className="absolute -top-[30%] left-[5%] w-[800px] h-[800px] rounded-full bg-violet-700/8 blur-[140px]" />
        <div className="absolute top-[40%] right-[-15%] w-[600px] h-[600px] rounded-full bg-indigo-700/6 blur-[120px]" />
        <div className="absolute bottom-0 left-[20%] w-[500px] h-[500px] rounded-full bg-violet-800/5 blur-[110px]" />
        <div className="absolute inset-0" style={{
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.018) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.018) 1px, transparent 1px)
          `,
          backgroundSize: "72px 72px",
          maskImage: "radial-gradient(ellipse 80% 60% at 50% 0%, black 40%, transparent 100%)",
        }} />
      </div>

      {/* ── Nav ───────────────────────────────────────────────────── */}
      <header className="relative z-50 flex items-center justify-between max-w-6xl mx-auto px-8 h-16">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-600 shadow-[0_0_16px_rgba(124,58,237,0.45)]">
            <SnapServeIcon size={15} className="text-white" />
          </div>
          <SnapServeLogo size="sm" className="text-white" />
        </div>

        <nav className="hidden md:flex items-center gap-7">
          {["Product", "Use Cases", "Pricing", "Docs"].map(l => (
            <a key={l} href={`#${l.toLowerCase().replace(" ", "-")}`}
              className="text-[13px] font-medium text-white/35 hover:text-white/70 transition-colors">
              {l}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <Link href={`${basePath}/sign-in`}>
            <button className="text-[13px] font-medium text-white/35 hover:text-white/65 transition-colors px-2">
              Sign in
            </button>
          </Link>
          <Link href={`${basePath}/sign-up`}>
            <button className="flex items-center gap-1.5 text-[13px] font-bold bg-white text-[#050508] px-4 py-1.5 rounded-lg hover:bg-white/90 transition-all">
              Get started
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </Link>
        </div>
      </header>

      {/* ── Hero ──────────────────────────────────────────────────── */}
      <section className="relative z-10 max-w-6xl mx-auto px-8 pt-20 pb-12 flex flex-col items-center text-center">

        {/* Badge */}
        <div className="inline-flex items-center gap-2 mb-8 px-3 py-1 rounded-full border border-violet-500/25 bg-violet-500/8 text-[11px] font-semibold text-violet-300 tracking-wide">
          <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
          From $0.03 / min — BYOK or Managed
        </div>

        {/* Headline */}
        <h1 className="max-w-3xl text-[52px] sm:text-[68px] font-black tracking-[-0.03em] leading-[1.0] mb-6">
          <span style={{
            background: "linear-gradient(135deg, #ffffff 0%, rgba(255,255,255,0.75) 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}>
            Voice agents,
            <br />
            built to
          </span>{" "}
          <span style={{
            background: "linear-gradient(135deg, #a78bfa 0%, #818cf8 50%, #60a5fa 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}>
            deploy
          </span>
        </h1>

        <p className="max-w-xl text-[15px] text-white/40 leading-[1.75] mb-10">
          Infrastructure for real-time AI voice agents. Connect your ASR, LLM, and TTS
          providers — or use ours. We handle the orchestration layer.
        </p>

        {/* CTA row */}
        <div className="flex items-center gap-3 mb-6">
          <Link href={`${basePath}/sign-up`}>
            <button className="flex items-center gap-2 px-6 py-3 rounded-xl text-[14px] font-bold bg-violet-600 hover:bg-violet-500 text-white shadow-[0_0_28px_-4px_rgba(124,58,237,0.7)] hover:shadow-[0_0_36px_-4px_rgba(124,58,237,0.85)] transition-all duration-200">
              Start building free
              <ArrowRight className="h-4 w-4" />
            </button>
          </Link>
          <a href="#product">
            <button className="flex items-center gap-2 px-6 py-3 rounded-xl text-[14px] font-medium text-white/40 border border-white/[0.08] hover:border-white/[0.15] hover:text-white/60 transition-all duration-200">
              See how it works
              <ChevronDown className="h-4 w-4" />
            </button>
          </a>
        </div>
        <p className="text-[11px] text-white/18">$5 credit on signup — no credit card required</p>

        {/* Waveform card */}
        <div className="relative w-full max-w-3xl mt-16">
          {/* Glow */}
          <div className="absolute inset-0 scale-[1.04] bg-violet-600/10 rounded-3xl blur-3xl" />

          <div className="relative rounded-2xl border border-white/[0.07] bg-white/[0.025] backdrop-blur-sm overflow-hidden">
            {/* Top bar */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.06]">
              <div className="flex items-center gap-2">
                <div className="flex gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-white/10" />
                  <div className="w-2.5 h-2.5 rounded-full bg-white/10" />
                  <div className="w-2.5 h-2.5 rounded-full bg-white/10" />
                </div>
                <span className="text-[10px] font-mono text-white/20 ml-2">orchestration / live-session</span>
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-emerald-400 font-mono font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                LIVE
              </div>
            </div>

            {/* Pipeline labels */}
            <div className="flex items-center justify-between px-8 pt-4 pb-0">
              {[
                { label: "CALLER",    sub: "inbound audio" },
                { label: "ASR",       sub: "Deepgram Nova-3" },
                { label: "LLM",       sub: "GPT-4o mini" },
                { label: "TTS",       sub: "Cartesia Sonic-2" },
                { label: "RESPONSE",  sub: "synthesized audio" },
              ].map(({ label, sub }) => (
                <div key={label} className="flex flex-col items-center gap-0.5">
                  <span className="text-[9px] font-black tracking-widest text-white/25">{label}</span>
                  <span className="text-[8px] text-white/15">{sub}</span>
                </div>
              ))}
            </div>

            {/* Canvas waveform */}
            <div className="h-36 w-full px-2">
              <WaveformCanvas />
            </div>

            {/* Bottom stats */}
            <div className="flex items-center justify-between px-5 py-3 border-t border-white/[0.04]">
              {[
                { label: "ASR latency",   value: "62ms" },
                { label: "LLM TTFT",      value: "94ms" },
                { label: "TTS latency",   value: "28ms" },
                { label: "Total",         value: "184ms" },
              ].map(({ label, value }) => (
                <div key={label} className="flex flex-col items-center gap-0.5">
                  <span className="text-[10px] font-bold text-white/60 font-mono">{value}</span>
                  <span className="text-[9px] text-white/20">{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Metrics ───────────────────────────────────────────────── */}
      <section className="relative z-10 border-y border-white/[0.05] my-12">
        <div className="max-w-4xl mx-auto grid grid-cols-2 md:grid-cols-4 divide-x divide-y md:divide-y-0 divide-white/[0.05]">
          {[
            { to: 10, suffix: "M+", pre: "", label: "Minutes processed" },
            { to: 184, suffix: "ms", pre: "<", label: "Pipeline latency" },
            { to: 15, suffix: "+", pre: "", label: "Providers supported" },
            { to: 99, suffix: ".9%", pre: "", label: "Uptime SLA" },
          ].map(({ to, suffix, pre, label }) => (
            <div key={label} className="flex flex-col items-center py-8 gap-1">
              <div className="text-[28px] font-black text-white">
                <Counter to={to} suffix={suffix} prefix={pre} />
              </div>
              <p className="text-[11px] text-white/30 font-medium">{label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works ──────────────────────────────────────────── */}
      <section id="product" className="relative z-10 max-w-5xl mx-auto px-8 py-20">
        <div className="mb-12">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-violet-400 mb-3">How it works</p>
          <h2 className="text-[32px] font-black tracking-tight text-white">Three steps to live</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Step n="01" title="Connect your providers"
            body="Add API keys for Deepgram, OpenAI, ElevenLabs, Twilio — or use our managed stack. No vendor lock-in. Switch providers any time." />
          <Step n="02" title="Configure your agent"
            body="Set a system prompt, choose a voice, define call flow, escalation phrases, and silence handling. All from a single dashboard." />
          <Step n="03" title="Deploy and monitor"
            body="Get a phone number, connect via webhook, and go live. Every call logged with transcript, latency breakdown, and outcome tracking." />
        </div>
      </section>

      {/* ── Capabilities ──────────────────────────────────────────── */}
      <section className="relative z-10 max-w-5xl mx-auto px-8 py-10">
        <div className="mb-12">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-violet-400 mb-3">Capabilities</p>
          <h2 className="text-[32px] font-black tracking-tight text-white">The full pipeline, handled</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <FCard tag="Speed" title="Sub-200ms pipeline"
            body="Streaming ASR, token-level LLM output, and parallel TTS synthesis. Callers hear a response before generation finishes." />
          <FCard tag="Flexibility" title="BYOK or managed keys"
            body="Bring your own Deepgram, OpenAI, and Twilio credentials for full cost control — or let us manage everything at $0.035/min." />
          <FCard tag="Languages" title="Multilingual, built in"
            body="Hindi, Tamil, Telugu, Malayalam, English and more. Sarvam ASR for Indic languages, multilingual LLM routing included." />
          <FCard tag="Routing" title="Smart call handling"
            body="Trigger transfers, detect intent, end on phrases, enforce max duration, handle silence — all configurable per agent." />
          <FCard tag="Observability" title="Transcripts and analytics"
            body="Every call logged with full transcript, per-leg latency, success tracking, and a filterable call history view." />
          <FCard tag="Security" title="Encrypted, scoped keys"
            body="Provider credentials scoped per user and encrypted at rest. Zero long-term audio retention. SOC 2 audit in progress." />
        </div>
      </section>

      {/* ── Providers ─────────────────────────────────────────────── */}
      <section className="relative z-10 max-w-5xl mx-auto px-8 py-20">
        <div className="mb-10">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-violet-400 mb-3">Integrations</p>
          <h2 className="text-[32px] font-black tracking-tight text-white">Your stack, your choice</h2>
          <p className="text-[13px] text-white/30 mt-2">Plug in any combination across the full pipeline</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2.5">
          <Chip name="Deepgram"      tag="ASR" />
          <Chip name="Sarvam"        tag="ASR · LLM" />
          <Chip name="Whisper"       tag="ASR" />
          <Chip name="AssemblyAI"    tag="ASR" />
          <Chip name="OpenAI"        tag="LLM · TTS" />
          <Chip name="Anthropic"     tag="LLM" />
          <Chip name="Google"        tag="LLM" />
          <Chip name="Groq"          tag="LLM" />
          <Chip name="DeepSeek"      tag="LLM" />
          <Chip name="Mistral"       tag="LLM" />
          <Chip name="ElevenLabs"    tag="TTS" />
          <Chip name="Cartesia"      tag="TTS" />
          <Chip name="AWS Polly"     tag="TTS" />
          <Chip name="Twilio"        tag="Telephony" />
          <Chip name="Plivo"         tag="Telephony" />
          <Chip name="VoBiz"         tag="Telephony" />
          <Chip name="Vonage"        tag="Telephony" />
          <div className="flex items-center justify-center px-3 py-2.5 rounded-xl border border-dashed border-white/[0.06] text-[10px] text-white/18">
            + more
          </div>
        </div>
      </section>

      {/* ── Use cases ─────────────────────────────────────────────── */}
      <section id="use-cases" className="relative z-10 max-w-5xl mx-auto px-8 py-10">
        <div className="mb-10">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-violet-400 mb-3">Use cases</p>
          <h2 className="text-[32px] font-black tracking-tight text-white">What teams deploy</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[
            { title: "Customer Support",       kpi: "24 / 7",     body: "Handle FAQs, order status, and complaints without agent queues. Escalate to human only when needed." },
            { title: "Sales Outreach",          kpi: "3x lift",    body: "Warm-qualify leads, introduce the product, and book demos at scale with zero SDR time wasted." },
            { title: "Collections & Reminders", kpi: "40% recovery", body: "Automate EMI reminders, overdue nudges, and follow-up calls in any language." },
            { title: "Appointment Scheduling",  kpi: "Zero no-shows", body: "Confirm, reschedule, and remind patients, clients, or candidates ahead of time." },
            { title: "COD Confirmation",        kpi: "99% accuracy", body: "Confirm orders before dispatch, reduce RTO, and save last-mile logistics cost." },
            { title: "Lead Qualification",      kpi: "5x pipeline", body: "Run qualification the moment a form is submitted. Score and route to the right rep instantly." },
          ].map(({ title, kpi, body }) => (
            <div key={title} className="group flex flex-col gap-3 p-5 rounded-2xl border border-white/[0.07] bg-white/[0.02] hover:border-violet-500/20 transition-all">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-[13px] font-bold text-white/80 group-hover:text-white transition-colors leading-snug">{title}</h3>
                <span className="shrink-0 text-[10px] font-bold text-violet-300 bg-violet-500/10 border border-violet-500/20 px-2 py-0.5 rounded-full">{kpi}</span>
              </div>
              <p className="text-[12px] text-white/30 leading-[1.65]">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Pricing ───────────────────────────────────────────────── */}
      <section id="pricing" className="relative z-10 max-w-5xl mx-auto px-8 py-20">
        <div className="mb-12 text-center">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-violet-400 mb-3">Pricing</p>
          <h2 className="text-[32px] font-black tracking-tight text-white">Usage-based, no surprises</h2>
          <p className="text-[13px] text-white/30 mt-2">No seat fees. No monthly minimums. Pay per minute.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <PCard plan="Starter" price="$0.03" per="/ min" note="Bring your own provider keys"
            items={[
              "Full BYOK — total cost control",
              "Unlimited agents",
              "Call transcripts + analytics",
              "Deepgram, OpenAI, Twilio",
              "$5 credit on signup",
            ]}
            cta="Start free" />
          <PCard plan="Managed" price="$0.035" per="/ min" note="We manage all provider keys"
            items={[
              "Zero setup — keys managed by us",
              "Indian language support",
              "Cartesia voices included",
              "Priority routing",
              "SLA-backed uptime",
            ]}
            cta="Get started" hot />
          <PCard plan="Enterprise" price="Custom" per="" note="High-volume or on-premise"
            items={[
              "Dedicated infrastructure",
              "Custom SLA + support",
              "On-premise deployment",
              "SSO + advanced security",
              "Dedicated success engineer",
            ]}
            cta="Talk to us" />
        </div>
      </section>

      {/* ── Final CTA ─────────────────────────────────────────────── */}
      <section className="relative z-10 max-w-4xl mx-auto px-8 py-20">
        <div className="relative rounded-3xl overflow-hidden border border-violet-500/15 p-12 text-center">
          <div className="absolute inset-0 bg-gradient-to-br from-violet-900/20 via-transparent to-indigo-900/15" />
          <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-violet-500/40 to-transparent" />
          <div className="absolute bottom-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-indigo-500/20 to-transparent" />
          <div className="relative">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-violet-400 mb-4">Ready to ship</p>
            <h2 className="text-[36px] font-black tracking-tight text-white mb-3 leading-tight">
              First agent live<br />in under 10 minutes
            </h2>
            <p className="text-[13px] text-white/35 max-w-md mx-auto mb-8 leading-[1.7]">
              No WebSocket code to write. No infra to manage. Connect your providers, write a prompt, get a number.
            </p>
            <div className="flex items-center justify-center gap-4 flex-wrap">
              <Link href={`${basePath}/sign-up`}>
                <button className="flex items-center gap-2 px-7 py-3 rounded-xl text-[14px] font-bold bg-violet-600 hover:bg-violet-500 text-white shadow-[0_0_32px_-4px_rgba(124,58,237,0.65)] hover:shadow-[0_0_40px_-4px_rgba(124,58,237,0.85)] transition-all duration-200">
                  Start building free
                  <ArrowRight className="h-4 w-4" />
                </button>
              </Link>
            </div>
            <p className="text-[11px] text-white/18 mt-4">$5 credit included — no card required</p>
          </div>
        </div>
      </section>

      {/* ── Footer ────────────────────────────────────────────────── */}
      <footer className="relative z-10 border-t border-white/[0.05] py-8 px-8">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="flex h-5 w-5 items-center justify-center rounded-md bg-violet-600/70">
              <SnapServeIcon size={11} className="text-white" />
            </div>
            <span className="text-[12px] font-semibold text-white/30">SnapServe</span>
          </div>
          <p className="text-[11px] text-white/15">AI Voice Agent Orchestration Platform</p>
          <div className="flex items-center gap-5">
            {["Privacy", "Terms", "Docs", "Status"].map(l => (
              <a key={l} href="#" className="text-[11px] text-white/20 hover:text-white/40 transition-colors">{l}</a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
