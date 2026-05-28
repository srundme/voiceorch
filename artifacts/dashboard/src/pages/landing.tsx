import { Link } from "wouter";
import { useEffect, useRef, useState } from "react";
import { SnapServeIcon } from "@/components/logo";
import {
  ArrowRight, Check, Brain, Zap, Globe, CalendarCheck,
  BarChart3, Users, Phone, Volume2, Activity, Shield,
  BookOpen, ChevronRight,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/* ── Animated counter ────────────────────────────────────────────────────── */
function Counter({ to, suffix = "", prefix = "" }: { to: number; suffix?: string; prefix?: string }) {
  const [n, setN] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (!e?.isIntersecting) return; obs.disconnect();
      const dur = 1600, s = performance.now();
      const tick = (now: number) => {
        const p = Math.min((now - s) / dur, 1);
        setN(Math.floor((1 - Math.pow(1 - p, 4)) * to));
        if (p < 1) requestAnimationFrame(tick); else setN(to);
      };
      requestAnimationFrame(tick);
    }, { threshold: 0.5 });
    obs.observe(el); return () => obs.disconnect();
  }, [to]);
  return <div ref={ref}>{prefix}{n.toLocaleString()}{suffix}</div>;
}

/* ── Memory retrieval visual ─────────────────────────────────────────────── */
function MemoryCard() {
  const [phase, setPhase] = useState<0|1|2|3>(0);

  useEffect(() => {
    const cycle = () => {
      setPhase(0);
      const t1 = setTimeout(() => setPhase(1), 600);
      const t2 = setTimeout(() => setPhase(2), 1800);
      const t3 = setTimeout(() => setPhase(3), 3400);
      return [t1, t2, t3];
    };
    const timers = cycle();
    const iv = setInterval(() => { cycle(); }, 7500);
    return () => { timers.forEach(clearTimeout); clearInterval(iv); };
  }, []);

  const memories = [
    { label: "Last call",   value: "3 days ago",    color: "#a1a1aa" },
    { label: "Intent",      value: "Premium plan",  color: "#86efac" },
    { label: "Language",    value: "Tamil",          color: "#93c5fd" },
    { label: "Objection",   value: "Price sensitive",color: "#fca5a5" },
    { label: "Company",     value: "Acme Corp",      color: "#d4d4d8" },
  ];

  return (
    <div className="relative w-full max-w-[340px] mx-auto rounded-2xl overflow-hidden"
      style={{ background: "#111", border: "1px solid rgba(255,255,255,0.07)" }}>

      {/* Call header */}
      <div className="flex items-center gap-3 px-5 py-4 border-b" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
        <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
          style={{ background: "#1a1a1a", border: "1px solid rgba(255,255,255,0.07)" }}>
          <Phone className="h-4 w-4 text-zinc-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-white">+91 98765 ·····</div>
          <div className="text-[10px] text-zinc-600">
            {phase === 0 ? "Waiting…" : phase === 1 ? "Incoming call" : phase === 2 ? "Retrieving memory…" : "Live · Agent responding"}
          </div>
        </div>
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-full text-[9px] font-bold transition-all duration-500"
          style={{
            background: phase === 3 ? "rgba(134,239,172,0.1)" : "rgba(161,161,170,0.08)",
            border: `1px solid ${phase === 3 ? "rgba(134,239,172,0.2)" : "rgba(161,161,170,0.12)"}`,
            color: phase === 3 ? "#86efac" : "#71717a",
          }}>
          <div className="w-1.5 h-1.5 rounded-full animate-pulse"
            style={{ background: phase === 3 ? "#86efac" : "#52525b" }} />
          {phase === 3 ? "LIVE" : phase === 2 ? "RECALL" : "IDLE"}
        </div>
      </div>

      {/* Memory chips */}
      <div className="px-5 py-4 space-y-2">
        <div className="flex items-center gap-2 mb-3">
          <Brain className="h-3 w-3 text-zinc-600" />
          <span className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-600">Memory Retrieved</span>
        </div>
        {memories.map((m, i) => (
          <div key={m.label}
            className="flex items-center justify-between rounded-xl px-3 py-2.5 transition-all duration-500"
            style={{
              background: "#191919",
              opacity: phase >= 2 ? 1 : 0,
              transform: phase >= 2 ? "translateY(0)" : "translateY(6px)",
              transitionDelay: `${i * 70}ms`,
            }}>
            <span className="text-[11px] text-zinc-600">{m.label}</span>
            <span className="text-[11px] font-semibold" style={{ color: m.color }}>{m.value}</span>
          </div>
        ))}
      </div>

      {/* Agent waveform */}
      <div className="px-5 pb-4 transition-all duration-500" style={{ opacity: phase === 3 ? 1 : 0 }}>
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl" style={{ background: "#191919" }}>
          <Volume2 className="h-3 w-3 text-zinc-600 shrink-0" />
          <div className="flex items-center gap-px h-5 flex-1">
            {Array.from({ length: 24 }, (_, i) => (
              <div key={i} className="flex-1 rounded-full"
                style={{
                  background: "#3f3f46",
                  height: `${25 + Math.sin(i * 0.7) * 60}%`,
                  animation: phase === 3 ? `lbar 0.8s ease-in-out ${(i * 53) % 800}ms infinite alternate` : "none",
                }} />
            ))}
          </div>
          <span className="text-[10px] text-zinc-700 shrink-0 ml-1">speaking</span>
        </div>
      </div>
    </div>
  );
}

/* ── Pipeline latency visual ─────────────────────────────────────────────── */
function PipelineCard() {
  const stages = [
    { label: "ASR",   sub: "Deepgram Nova-3",  ms: 62,  pct: 34, col: "#d4d4d8" },
    { label: "LLM",   sub: "GPT-4o mini",      ms: 94,  pct: 51, col: "#a1a1aa" },
    { label: "TTS",   sub: "Cartesia Sonic-2", ms: 28,  pct: 15, col: "#e4e4e7" },
  ];
  return (
    <div className="w-full max-w-[360px] mx-auto rounded-2xl p-6 space-y-5"
      style={{ background: "#111", border: "1px solid rgba(255,255,255,0.07)" }}>
      <div className="flex items-center gap-2 mb-1">
        <Activity className="h-3.5 w-3.5 text-zinc-600" />
        <span className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-600">Pipeline Breakdown</span>
      </div>
      {stages.map(({ label, sub, ms, pct, col }) => (
        <div key={label} className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-black" style={{ color: col }}>{label}</span>
              <span className="text-[10px] text-zinc-700">{sub}</span>
            </div>
            <span className="text-[11px] font-mono font-bold text-zinc-300">{ms}ms</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "#1e1e1e" }}>
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: col, opacity: 0.5 }} />
          </div>
        </div>
      ))}
      <div className="flex items-center justify-between pt-3" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
        <span className="text-[11px] text-zinc-600">Total latency</span>
        <span className="text-[15px] font-black font-mono text-white">184ms</span>
      </div>
    </div>
  );
}

/* ── Live call flow diagram ───────────────────────────────────────────────── */
function FlowVisual() {
  const nodes = [
    { label: "Greeting", sub: "Personalized from memory" },
    { label: "Discovery", sub: "Context-aware questions" },
    { label: "Objection", sub: "Handled with history", branch: true },
    { label: "Close", sub: "Book or escalate" },
  ];
  return (
    <div className="w-full max-w-[300px] mx-auto space-y-1.5">
      {nodes.map((n, i) => (
        <div key={n.label}>
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl"
            style={{ background: "#111", border: "1px solid rgba(255,255,255,0.07)" }}>
            <div className="w-5 h-5 rounded-md flex items-center justify-center shrink-0"
              style={{ background: "#1e1e1e" }}>
              <span className="text-[9px] font-black text-zinc-500">{i + 1}</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-semibold text-white">{n.label}</div>
              <div className="text-[10px] text-zinc-600">{n.sub}</div>
            </div>
            {n.branch && (
              <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-md text-amber-400"
                style={{ background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.15)" }}>
                BRANCH
              </span>
            )}
          </div>
          {i < nodes.length - 1 && (
            <div className="flex justify-center">
              <div className="w-px h-3" style={{ background: "rgba(255,255,255,0.06)" }} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── Feature card ────────────────────────────────────────────────────────── */
function FCard({ icon: Icon, title, body, accent = "#71717a" }: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  title: string; body: string; accent?: string;
}) {
  return (
    <div className="group p-6 rounded-2xl transition-all duration-300"
      style={{ background: "#0c0c0c", border: "1px solid rgba(255,255,255,0.06)" }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)")}
      onMouseLeave={e => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)")}>
      <div className="h-9 w-9 rounded-xl flex items-center justify-center mb-5"
        style={{ background: `${accent}14` }}>
        <Icon className="h-4 w-4" style={{ color: accent }} />
      </div>
      <h3 className="text-[14px] font-bold text-white mb-2">{title}</h3>
      <p className="text-[12px] leading-[1.75]" style={{ color: "#52525b" }}>{body}</p>
    </div>
  );
}

/* ── Step ────────────────────────────────────────────────────────────────── */
function Step({ n, title, body, last }: { n: string; title: string; body: string; last?: boolean }) {
  return (
    <div className="flex gap-6">
      <div className="flex flex-col items-center">
        <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
          style={{ background: "#111", border: "1px solid rgba(255,255,255,0.08)" }}>
          <span className="text-[11px] font-black text-zinc-500">{n}</span>
        </div>
        {!last && <div className="w-px flex-1 mt-3" style={{ background: "rgba(255,255,255,0.05)" }} />}
      </div>
      <div className={last ? "pb-0" : "pb-12"}>
        <h3 className="text-[17px] font-bold text-white mb-2 mt-1.5">{title}</h3>
        <p className="text-[13px] leading-[1.8] max-w-md" style={{ color: "#52525b" }}>{body}</p>
      </div>
    </div>
  );
}

/* ── Pricing card ────────────────────────────────────────────────────────── */
function PCard({ plan, price, per, note, items, cta, featured }: {
  plan: string; price: string; per: string; note: string;
  items: string[]; cta: string; featured?: boolean;
}) {
  return (
    <div className="relative flex flex-col gap-5 p-7 rounded-2xl"
      style={{ background: featured ? "#111" : "#090909", border: `1px solid ${featured ? "rgba(255,255,255,0.13)" : "rgba(255,255,255,0.06)"}` }}>
      {featured && (
        <div className="absolute -top-3.5 left-6">
          <span className="text-[9px] font-black uppercase tracking-widest bg-white text-black px-3 py-1.5 rounded-full">
            Most popular
          </span>
        </div>
      )}
      <div className="pt-1">
        <p className="text-[9px] font-black uppercase tracking-[0.22em] mb-5" style={{ color: "#52525b" }}>{plan}</p>
        <div className="flex items-end gap-1.5 mb-1.5">
          <span className="text-[42px] font-black text-white leading-none">{price}</span>
          {per && <span className="text-[13px] mb-2" style={{ color: "#52525b" }}>{per}</span>}
        </div>
        <p className="text-[12px]" style={{ color: "#3f3f46" }}>{note}</p>
      </div>
      <div className="h-px" style={{ background: "rgba(255,255,255,0.05)" }} />
      <ul className="flex flex-col gap-3.5 flex-1">
        {items.map(item => (
          <li key={item} className="flex items-start gap-3 text-[13px]" style={{ color: "#71717a" }}>
            <Check className="h-3.5 w-3.5 text-zinc-400 mt-0.5 shrink-0" />
            {item}
          </li>
        ))}
      </ul>
      <Link href={`${BASE}/sign-up`}>
        <button className={`w-full py-3 rounded-full text-[13px] font-bold transition-all duration-200 ${
          featured ? "bg-white text-black hover:bg-white/90"
          : "text-zinc-500 hover:text-zinc-300"
        }`}
          style={!featured ? { border: "1px solid rgba(255,255,255,0.08)" } : undefined}>
          {cta}
        </button>
      </Link>
    </div>
  );
}

/* ── Marquee track ───────────────────────────────────────────────────────── */
const PROVIDERS = [
  { name: "Deepgram",   type: "ASR" },
  { name: "OpenAI",     type: "LLM · TTS" },
  { name: "ElevenLabs", type: "TTS" },
  { name: "Twilio",     type: "Telephony" },
  { name: "Anthropic",  type: "LLM" },
  { name: "Cartesia",   type: "TTS" },
  { name: "Sarvam",     type: "ASR · TTS" },
  { name: "Azure",      type: "ASR · TTS" },
  { name: "Groq",       type: "LLM" },
  { name: "Plivo",      type: "Telephony" },
  { name: "Mistral",    type: "LLM" },
  { name: "Gemini",     type: "LLM" },
  { name: "DeepSeek",   type: "LLM" },
  { name: "AWS Polly",  type: "TTS" },
  { name: "Vonage",     type: "Telephony" },
  { name: "VoBiz",      type: "Telephony" },
];

/* ── Main ────────────────────────────────────────────────────────────────── */
export default function LandingPage() {
  return (
    <div className="min-h-screen text-white antialiased overflow-x-hidden" style={{ background: "#050505" }}>
      <style>{`
        @keyframes lbar  { 0%{transform:scaleY(.25)} 100%{transform:scaleY(1)} }
        @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-10px)} }
        @keyframes mq    { 0%{transform:translateX(0)} 100%{transform:translateX(-50%)} }
        @keyframes pulse-ring { 0%{transform:scale(1);opacity:.6} 100%{transform:scale(1.9);opacity:0} }
        @keyframes orb   { 0%,100%{transform:scale(1) translate(0,0)} 50%{transform:scale(1.06) translate(8px,-6px)} }
        @keyframes slide-up { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
        .float-anim  { animation: float 5s ease-in-out infinite; }
        .marquee-run { animation: mq 32s linear infinite; }
        .orb-anim    { animation: orb 10s ease-in-out infinite; }
      `}</style>

      {/* Background orbs */}
      <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 0 }}>
        <div className="orb-anim absolute -top-40 -right-40 w-[700px] h-[700px] rounded-full"
          style={{ background: "radial-gradient(circle, rgba(255,255,255,0.035) 0%, transparent 65%)" }} />
        <div className="orb-anim absolute -bottom-40 -left-40 w-[600px] h-[600px] rounded-full"
          style={{ background: "radial-gradient(circle, rgba(255,255,255,0.025) 0%, transparent 65%)", animationDelay: "4s" }} />
        {/* Grid overlay */}
        <div className="absolute inset-0 opacity-[0.015]" style={{
          backgroundImage: "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }} />
      </div>

      {/* ── Nav ──────────────────────────────────────────────────────────── */}
      <header className="fixed top-0 inset-x-0 z-50 flex items-center justify-between px-8 h-14"
        style={{ background: "rgba(5,5,5,0.85)", backdropFilter: "blur(24px)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <Link href={`${BASE}/`}>
          <span className="inline-flex items-center gap-2 cursor-pointer">
            <SnapServeIcon size={22} className="text-white shrink-0" />
            <span className="text-[14px] text-white leading-none select-none"
              style={{ fontFamily: "'Tex Gyre Heros', Helvetica, Arial, sans-serif", letterSpacing: "-0.01em" }}>
              <span style={{ fontWeight: 700 }}>Snap</span><span style={{ fontWeight: 400 }}>Serve</span>
            </span>
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-8">
          {[["Features","#features"],["How it works","#how"],["Pricing","#pricing"]].map(([l,h]) => (
            <a key={l} href={h} className="text-[13px] transition-colors"
              style={{ color: "#52525b" }}
              onMouseEnter={e => (e.currentTarget.style.color = "#fff")}
              onMouseLeave={e => (e.currentTarget.style.color = "#52525b")}>{l}</a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <Link href={`${BASE}/sign-in`}>
            <button className="text-[13px] px-3 py-1.5 transition-colors" style={{ color: "#52525b" }}
              onMouseEnter={e => (e.currentTarget.style.color = "#fff")}
              onMouseLeave={e => (e.currentTarget.style.color = "#52525b")}>Sign in</button>
          </Link>
          <Link href={`${BASE}/sign-up`}>
            <button className="flex items-center gap-1.5 bg-white text-black text-[13px] font-bold px-4 py-1.5 rounded-full transition-all hover:bg-white/90">
              Get started <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </Link>
        </div>
      </header>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative min-h-screen grid grid-cols-1 lg:grid-cols-2 pt-14" style={{ zIndex: 1 }}>

        {/* Left */}
        <div className="flex flex-col justify-center px-10 lg:px-16 xl:px-20 py-24 lg:py-0">
          <div className="inline-flex items-center gap-2 mb-8 w-fit px-3 py-1.5 rounded-full text-[11px] font-semibold"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#71717a" }}>
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full opacity-75"
                style={{ background: "#52525b", animation: "pulse-ring 1.4s ease-out infinite" }} />
              <span className="relative inline-flex rounded-full h-2 w-2" style={{ background: "#71717a" }} />
            </span>
            Beta · Now live
          </div>

          <h1 className="text-[56px] sm:text-[70px] lg:text-[82px] font-black leading-[0.9] tracking-[-0.04em] mb-8">
            Voice agents<br />
            <span style={{ color: "#3f3f46" }}>that never</span><br />
            forget.
          </h1>

          <p className="text-[15px] leading-[1.85] mb-10 max-w-[360px]" style={{ color: "#52525b" }}>
            Build AI voice agents with persistent caller memory, real-time pipeline orchestration, and complete provider freedom. Ship in minutes, not months.
          </p>

          <div className="flex flex-wrap items-center gap-3 mb-6">
            <Link href={`${BASE}/sign-up`}>
              <button className="flex items-center gap-2 bg-white text-black text-[14px] font-bold px-7 py-3.5 rounded-full transition-all hover:bg-white/90 hover:gap-2.5">
                Start building free <ArrowRight className="h-4 w-4" />
              </button>
            </Link>
            <a href="#features">
              <button className="text-[14px] px-7 py-3.5 rounded-full transition-all"
                style={{ color: "#52525b", border: "1px solid rgba(255,255,255,0.07)" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.14)"; (e.currentTarget as HTMLElement).style.color = "#a1a1aa"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.07)"; (e.currentTarget as HTMLElement).style.color = "#52525b"; }}>
                See features
              </button>
            </a>
          </div>
          <p className="text-[11px]" style={{ color: "#3a3a3a" }}>$5 free credit · No card required</p>
        </div>

        {/* Right — memory card */}
        <div className="relative hidden lg:flex items-center justify-center px-12 py-20">
          <div className="absolute inset-0 pointer-events-none"
            style={{ background: "radial-gradient(ellipse at center, rgba(255,255,255,0.018) 0%, transparent 65%)" }} />
          <div className="float-anim w-full">
            <MemoryCard />
          </div>

          {/* Floating pills */}
          <div className="absolute top-1/3 right-6 flex flex-col gap-2 z-10">
            {[
              { t: "Memory", v: "< 50ms", c: "#86efac" },
              { t: "ASR",    v: "62ms",   c: "#d4d4d8" },
              { t: "LLM",    v: "94ms",   c: "#a1a1aa" },
            ].map(({ t, v, c }) => (
              <div key={t} className="flex items-center gap-2.5 px-3 py-2 rounded-xl"
                style={{ background: "rgba(17,17,17,0.9)", border: "1px solid rgba(255,255,255,0.07)", backdropFilter: "blur(12px)" }}>
                <span className="text-[10px] font-bold" style={{ color: c }}>{t}</span>
                <span className="text-[12px] font-black font-mono text-white">{v}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Metrics strip ────────────────────────────────────────────────── */}
      <section style={{ borderTop: "1px solid rgba(255,255,255,0.06)", borderBottom: "1px solid rgba(255,255,255,0.06)", position: "relative", zIndex: 1 }}>
        <div className="max-w-5xl mx-auto grid grid-cols-2 md:grid-cols-4 divide-x" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
          {[
            { to: 184, s: "ms", p: "<", l: "Pipeline latency" },
            { to: 15,  s: "+",  p: "",  l: "Provider integrations" },
            { to: 20,  s: "+",  p: "",  l: "Languages supported" },
            { to: 99,  s: ".9%",p: "",  l: "Uptime SLA" },
          ].map(({ to, s, p, l }) => (
            <div key={l} className="flex flex-col items-center py-10 gap-2">
              <div className="text-[32px] font-black text-white tabular-nums">
                <Counter to={to} suffix={s} prefix={p} />
              </div>
              <p className="text-[11px] font-medium" style={{ color: "#3f3f46" }}>{l}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Memory section ───────────────────────────────────────────────── */}
      <section className="max-w-5xl mx-auto px-8 py-32" style={{ position: "relative", zIndex: 1 }}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-20 items-center">
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.28em] mb-6" style={{ color: "#3f3f46" }}>Memory</p>
            <h2 className="text-[46px] sm:text-[58px] font-black tracking-[-0.035em] leading-[0.92] text-white mb-8">
              Every caller.<br />
              <span style={{ color: "#3f3f46" }}>Remembered.</span>
            </h2>
            <p className="text-[15px] leading-[1.85] mb-10 max-w-md" style={{ color: "#52525b" }}>
              Your agent automatically recalls past interactions — deal history, objections raised, language preferences, intent signals — and uses them to personalize every call from the very first word.
            </p>
            <ul className="space-y-3.5">
              {[
                "Caller history recalled in under 50ms",
                "Stores intent, objections, and preferences",
                "Context-aware from the first second of every call",
                "Per-agent memory configuration and isolation",
              ].map(item => (
                <li key={item} className="flex items-start gap-3 text-[13px]" style={{ color: "#71717a" }}>
                  <ChevronRight className="h-4 w-4 shrink-0 mt-0.5" style={{ color: "#3f3f46" }} />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex items-center justify-center rounded-2xl aspect-[4/3]"
            style={{ background: "#080808", border: "1px solid rgba(255,255,255,0.06)" }}>
            <MemoryCard />
          </div>
        </div>
      </section>

      {/* ── Features grid ────────────────────────────────────────────────── */}
      <section id="features" style={{ borderTop: "1px solid rgba(255,255,255,0.06)", position: "relative", zIndex: 1 }}>
        <div className="max-w-5xl mx-auto px-8 py-32">
          <div className="mb-16">
            <p className="text-[9px] font-black uppercase tracking-[0.28em] mb-6" style={{ color: "#3f3f46" }}>Capabilities</p>
            <h2 className="text-[42px] font-black tracking-[-0.03em] leading-[1.0] text-white max-w-xl">
              Everything you need to ship voice AI at scale.
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <FCard icon={Brain} accent="#86efac" title="Persistent Memory"
              body="Agents recall caller history, preferences, and past objections. Every conversation continues exactly where the last one ended." />
            <FCard icon={Zap} accent="#fbbf24" title="Real-time Pipeline"
              body="Sub-200ms ASR→LLM→TTS orchestration with streaming output. Callers hear a response before generation even finishes." />
            <FCard icon={Globe} accent="#93c5fd" title="Bring Your Own Providers"
              body="Deepgram, OpenAI, ElevenLabs, Twilio — or 12 more. You pay providers directly. Zero markup, zero lock-in." />
            <FCard icon={CalendarCheck} accent="#a5f3fc" title="In-call Scheduling"
              body="Book, reschedule, and cancel appointments during live calls. Native calendar engine with Google Calendar sync." />
            <FCard icon={Users} accent="#c4b5fd" title="Outbound Campaigns"
              body="Run AI-powered campaigns. Import leads from Meta Lead Ads, CSV, or CRM and launch outbound at scale." />
            <FCard icon={BarChart3} accent="#fb923c" title="Call Analytics"
              body="Full transcripts, disposition fields, success rates, and auto-summarization after every call. No setup required." />
            <FCard icon={BookOpen} accent="#f9a8d4" title="Knowledge Base"
              body="Upload documents, FAQs, or product catalogs. Your agent answers from your data — not generic training." />
            <FCard icon={Activity} accent="#6ee7b7" title="Multi-language"
              body="20+ languages including Hindi, Tamil, Telugu, and 8 other Indic languages. Sarvam ASR built in." />
            <FCard icon={Shield} accent="#d4d4d8" title="Encrypted Keys"
              body="Provider API keys encrypted at rest with AES-256-GCM. Only last-4-char hint ever shown in the UI." />
          </div>
        </div>
      </section>

      {/* ── Pipeline perf section ─────────────────────────────────────────── */}
      <section style={{ borderTop: "1px solid rgba(255,255,255,0.06)", position: "relative", zIndex: 1 }}>
        <div className="max-w-5xl mx-auto px-8 py-32 grid grid-cols-1 lg:grid-cols-2 gap-20 items-center">
          <div className="flex items-center justify-center rounded-2xl aspect-[4/3]"
            style={{ background: "#080808", border: "1px solid rgba(255,255,255,0.06)" }}>
            <PipelineCard />
          </div>
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.28em] mb-6" style={{ color: "#3f3f46" }}>Performance</p>
            <h2 className="text-[46px] sm:text-[58px] font-black tracking-[-0.035em] leading-[0.92] text-white mb-8">
              Sub-200ms,<br />
              <span style={{ color: "#3f3f46" }}>every time.</span>
            </h2>
            <p className="text-[15px] leading-[1.85] max-w-md" style={{ color: "#52525b" }}>
              Streaming ASR with token-level LLM output and parallel TTS synthesis. Callers hear a response before generation finishes. Every millisecond is instrumented and logged.
            </p>
          </div>
        </div>
      </section>

      {/* ── AI call flow section ─────────────────────────────────────────── */}
      <section style={{ borderTop: "1px solid rgba(255,255,255,0.06)", position: "relative", zIndex: 1 }}>
        <div className="max-w-5xl mx-auto px-8 py-32 grid grid-cols-1 lg:grid-cols-2 gap-20 items-center">
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.28em] mb-6" style={{ color: "#3f3f46" }}>Wizard</p>
            <h2 className="text-[46px] sm:text-[58px] font-black tracking-[-0.035em] leading-[0.92] text-white mb-8">
              From idea<br />
              <span style={{ color: "#3f3f46" }}>to agent in 10 min.</span>
            </h2>
            <p className="text-[15px] leading-[1.85] mb-8 max-w-md" style={{ color: "#52525b" }}>
              Describe your use case, answer 5 questions, and our AI generates a complete call flow — greeting, objections, branches, and closing — all ready to review and launch.
            </p>
            <Link href={`${BASE}/sign-up`}>
              <button className="flex items-center gap-2 text-[13px] font-bold transition-all"
                style={{ color: "#a1a1aa" }}
                onMouseEnter={e => (e.currentTarget.style.color = "#fff")}
                onMouseLeave={e => (e.currentTarget.style.color = "#a1a1aa")}>
                Try the wizard <ArrowRight className="h-4 w-4" />
              </button>
            </Link>
          </div>
          <div className="flex items-center justify-center rounded-2xl py-10"
            style={{ background: "#080808", border: "1px solid rgba(255,255,255,0.06)" }}>
            <FlowVisual />
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────────── */}
      <section id="how" style={{ borderTop: "1px solid rgba(255,255,255,0.06)", position: "relative", zIndex: 1 }}>
        <div className="max-w-5xl mx-auto px-8 py-32 grid grid-cols-1 lg:grid-cols-2 gap-20">
          <div>
            <p className="text-[9px] font-black uppercase tracking-[0.28em] mb-6" style={{ color: "#3f3f46" }}>How it works</p>
            <h2 className="text-[42px] font-black tracking-[-0.03em] leading-[1.0] text-white">
              Agent live in<br />three steps.
            </h2>
          </div>
          <div>
            <Step n="01" title="Describe your use case"
              body="Choose from sales, support, recruitment, healthcare, or debt recovery. Answer 5 questions — our AI generates a complete call flow with decision branches in seconds." />
            <Step n="02" title="Connect your providers"
              body="Plug in your own ASR, LLM, TTS, and telephony keys. Or use our managed stack. All keys are encrypted at rest — never exposed to the frontend." />
            <Step n="03" title="Test, deploy, and scale" last
              body="Test with a live webcall right in the browser. Deploy to your phone number. Monitor calls, transcripts, and memory in real time." />
          </div>
        </div>
      </section>

      {/* ── Provider marquee ─────────────────────────────────────────────── */}
      <section style={{ borderTop: "1px solid rgba(255,255,255,0.06)", borderBottom: "1px solid rgba(255,255,255,0.06)", position: "relative", zIndex: 1 }}>
        <div className="py-12 overflow-hidden">
          <p className="text-center text-[9px] font-black uppercase tracking-[0.28em] mb-9" style={{ color: "#2a2a2a" }}>
            Works with your providers
          </p>
          <div className="relative">
            <div className="marquee-run flex gap-4 w-max">
              {[...PROVIDERS, ...PROVIDERS].map((p, i) => (
                <div key={i} className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl shrink-0"
                  style={{ background: "#0d0d0d", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
                    style={{ background: "#1a1a1a" }}>
                    <span className="text-[8px] font-black" style={{ color: "#52525b" }}>{p.name.slice(0,2).toUpperCase()}</span>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold" style={{ color: "#a1a1aa" }}>{p.name}</div>
                    <div className="text-[9px]" style={{ color: "#3f3f46" }}>{p.type}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="absolute inset-y-0 left-0 w-24 pointer-events-none" style={{ background: "linear-gradient(to right, #050505, transparent)" }} />
            <div className="absolute inset-y-0 right-0 w-24 pointer-events-none" style={{ background: "linear-gradient(to left, #050505, transparent)" }} />
          </div>
        </div>
      </section>

      {/* ── Pricing ──────────────────────────────────────────────────────── */}
      <section id="pricing" style={{ position: "relative", zIndex: 1 }}>
        <div className="max-w-5xl mx-auto px-8 py-32">
          <div className="text-center mb-16">
            <p className="text-[9px] font-black uppercase tracking-[0.28em] mb-6" style={{ color: "#3f3f46" }}>Pricing</p>
            <h2 className="text-[42px] font-black tracking-[-0.03em] leading-[1.0] text-white">
              Simple, usage-based pricing.
            </h2>
            <p className="mt-4 text-[14px]" style={{ color: "#3f3f46" }}>
              You pay your providers directly. We charge only for orchestration.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <PCard plan="Starter" price="$0" per="" note="$5 free credit included" cta="Get started free"
              items={["5 agents","500 minutes / month","3 providers per agent","Call logs & transcripts","Email support"]} />
            <PCard plan="Growth" price="$49" per="/mo" note="+ $0.03 / min orchestration" cta="Start free trial" featured
              items={["Unlimited agents","10,000 minutes / month","All providers included","Persistent call memory","Scheduling & campaigns","Priority support"]} />
            <PCard plan="Enterprise" price="Custom" per="" note="Volume pricing available" cta="Talk to us"
              items={["Unlimited everything","Dedicated infrastructure","Custom SLA","SSO & audit logs","White-label available","Dedicated CSM"]} />
          </div>
        </div>
      </section>

      {/* ── Final CTA ────────────────────────────────────────────────────── */}
      <section style={{ borderTop: "1px solid rgba(255,255,255,0.06)", position: "relative", zIndex: 1 }}>
        <div className="max-w-2xl mx-auto px-8 py-36 text-center">
          <h2 className="text-[52px] sm:text-[68px] font-black tracking-[-0.04em] leading-[0.9] text-white mb-8">
            Ship your first<br />agent today.
          </h2>
          <p className="text-[15px] leading-[1.8] mb-12" style={{ color: "#52525b" }}>
            $5 free credit. No card required.<br />Agent live in under 10 minutes.
          </p>
          <Link href={`${BASE}/sign-up`}>
            <button className="inline-flex items-center gap-2.5 bg-white text-black text-[15px] font-bold px-9 py-4 rounded-full transition-all hover:bg-white/90 hover:gap-3.5">
              Create your agent <ArrowRight className="h-5 w-5" />
            </button>
          </Link>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer style={{ borderTop: "1px solid rgba(255,255,255,0.05)", position: "relative", zIndex: 1 }}>
        <div className="max-w-5xl mx-auto px-8 py-10 flex flex-col sm:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-2">
            <SnapServeIcon size={18} className="shrink-0 text-[#2a2a2a]" />
            <span className="text-[13px] leading-none" style={{ fontFamily: "'Tex Gyre Heros', Helvetica, Arial, sans-serif", color: "#2a2a2a" }}>
              <span style={{ fontWeight: 700 }}>Snap</span><span style={{ fontWeight: 400 }}>Serve</span>
            </span>
          </div>
          <div className="flex items-center gap-7">
            {["Privacy","Terms","Docs","Status"].map(l => (
              <a key={l} href="#" className="text-[12px] transition-colors" style={{ color: "#2a2a2a" }}
                onMouseEnter={e => (e.currentTarget.style.color = "#71717a")}
                onMouseLeave={e => (e.currentTarget.style.color = "#2a2a2a")}>{l}</a>
            ))}
          </div>
          <p className="text-[12px]" style={{ color: "#1e1e1e" }}>© 2026 SnapServe. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
