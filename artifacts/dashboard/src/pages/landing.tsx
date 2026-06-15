import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";

/* ─── Animated SVG Wave ──────────────────────────────────────────────────── */
function WaveLeft() {
  return (
    <svg viewBox="0 0 900 220" fill="none" xmlns="http://www.w3.org/2000/svg"
      className="absolute left-0 top-1/2 -translate-y-1/2 w-[55%] opacity-30 pointer-events-none select-none">
      <path className="wave-path-1"
        d="M0,110 C60,60 120,160 200,110 C280,60 340,160 420,110 C500,60 560,160 640,110 C720,60 780,160 860,110 C900,90 900,110 900,110"
        stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" fill="none" />
      <path className="wave-path-2"
        d="M0,130 C70,80 130,180 210,130 C290,80 350,180 430,130 C510,80 570,180 650,130 C730,80 790,180 870,130 C900,118 900,130 900,130"
        stroke="rgba(255,255,255,0.15)" strokeWidth="1" fill="none" />
      <path className="wave-path-3"
        d="M0,95 C50,50 110,145 190,95 C270,45 330,145 410,95 C490,45 550,145 630,95 C710,45 770,145 850,95 C890,77 900,95 900,95"
        stroke="rgba(255,255,255,0.08)" strokeWidth="0.8" fill="none" />
    </svg>
  );
}

function WaveRight() {
  return (
    <svg viewBox="0 0 900 220" fill="none" xmlns="http://www.w3.org/2000/svg"
      className="absolute right-0 top-1/2 -translate-y-1/2 w-[55%] opacity-50 pointer-events-none select-none" style={{ transform: "translateY(-50%) scaleX(-1)" }}>
      <path className="wave-path-1"
        d="M0,110 C60,60 120,160 200,110 C280,60 340,160 420,110 C500,60 560,160 640,110 C720,60 780,160 860,110 C900,90 900,110 900,110"
        stroke="rgba(249,115,22,0.6)" strokeWidth="2" fill="none" />
      <path className="wave-path-2"
        d="M0,130 C70,80 130,180 210,130 C290,80 350,180 430,130 C510,80 570,180 650,130 C730,80 790,180 870,130 C900,118 900,130 900,130"
        stroke="rgba(249,115,22,0.3)" strokeWidth="1.2" fill="none" />
      <path className="wave-path-3"
        d="M0,95 C50,50 110,145 190,95 C270,45 330,145 410,95 C490,45 550,145 630,95 C710,45 770,145 850,95 C890,77 900,95 900,95"
        stroke="rgba(251,146,60,0.18)" strokeWidth="0.8" fill="none" />
    </svg>
  );
}

/* ─── Scroll reveal hook ─────────────────────────────────────────────────── */
function useReveal(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } }, { threshold });
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, visible };
}

/* ─── Fanned feature cards ───────────────────────────────────────────────── */
const UNIQUE_FEATURES = [
  { icon: "🧠", label: "Persistent\nCaller Memory", color: "#f97316", bg: "linear-gradient(145deg,#f97316,#ea580c)" },
  { icon: "🔄", label: "Auto-Redial\nOn Drop", color: "#fb923c", bg: "linear-gradient(145deg,#fb923c,#f97316)" },
  { icon: "⚧", label: "Gender\nDetection", color: "#fdba74", bg: "linear-gradient(145deg,#fdba74,#fb923c)" },
  { icon: "🎙️", label: "Voice\nPrints", color: "#e5c9b0", bg: "linear-gradient(145deg,#d4a97a,#e2b98c)" },
  { icon: "📅", label: "Native\nScheduling", color: "#a8a8a8", bg: "linear-gradient(145deg,#6b6b6b,#888)" },
];

const CARD_TRANSFORMS = [
  { rotate: "-12deg", translateX: "-180px", translateY: "8px", z: 1, opacity: 1, scale: 1.05 },
  { rotate: "-6deg",  translateX: "-80px",  translateY: "4px", z: 2, opacity: 0.92, scale: 1.02 },
  { rotate: "0deg",   translateX: "0px",    translateY: "0px", z: 3, opacity: 0.85, scale: 1 },
  { rotate: "6deg",   translateX: "80px",   translateY: "4px", z: 2, opacity: 0.65, scale: 0.97 },
  { rotate: "12deg",  translateX: "180px",  translateY: "8px", z: 1, opacity: 0.45, scale: 0.94 },
];

function FanCards() {
  const { ref, visible } = useReveal(0.1);
  return (
    <div ref={ref} className="relative flex justify-center items-center" style={{ height: 340, perspective: "1000px" }}>
      {UNIQUE_FEATURES.map((f, i) => {
        const t = CARD_TRANSFORMS[i]!;
        return (
          <div key={f.label}
            style={{
              position: "absolute",
              width: 180,
              height: 220,
              borderRadius: 20,
              background: f.bg,
              zIndex: t.z,
              transform: visible
                ? `translateX(${t.translateX}) translateY(${t.translateY}) rotate(${t.rotate}) scale(${t.scale})`
                : `translateX(0px) translateY(60px) rotate(0deg) scale(0.85)`,
              opacity: visible ? t.opacity : 0,
              transition: `transform 0.8s cubic-bezier(0.34,1.2,0.64,1) ${i * 0.07}s, opacity 0.6s ease ${i * 0.07}s`,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 16,
              boxShadow: i === 0 ? "0 20px 60px rgba(249,115,22,0.4)" : "0 10px 40px rgba(0,0,0,0.5)",
              cursor: "default",
            }}>
            <div style={{ fontSize: 42, lineHeight: 1 }}>{f.icon}</div>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 13, fontWeight: 700, color: "#fff", textAlign: "center", lineHeight: 1.4, whiteSpace: "pre-line", opacity: 0.95, letterSpacing: 0 }}>
              {f.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─── Memory diagram ─────────────────────────────────────────────────────── */
function MemoryDiagram() {
  const { ref, visible } = useReveal(0.1);
  const nodes = [
    { label: "Caller rings", sub: "phone or webcall", icon: "📞" },
    { label: "Voice Analysis", sub: "gender + voice print", icon: "🎙️" },
    { label: "Memory Lookup", sub: "facts · episodes · quotes", icon: "🧠", accent: true },
    { label: "LLM Response", sub: "context-aware reply", icon: "⚡" },
    { label: "Booking / Transfer", sub: "action taken mid-call", icon: "📅" },
  ];
  return (
    <div ref={ref} className="flex flex-col items-center gap-6 overflow-x-auto py-4">
      <div className="flex items-center gap-0 min-w-max">
        {nodes.map((n, i) => (
          <div key={n.label} className="flex items-center">
            {/* Node */}
            <div style={{
              opacity: visible ? 1 : 0,
              transform: visible ? "translateY(0)" : "translateY(30px)",
              transition: `all 0.6s ease ${i * 0.12}s`,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 10,
            }}>
              <div style={{
                width: 88, height: 88,
                borderRadius: 18,
                background: n.accent ? "linear-gradient(145deg,#f97316,#ea580c)" : "rgba(255,255,255,0.04)",
                border: n.accent ? "none" : "1px solid rgba(255,255,255,0.1)",
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                gap: 4,
                boxShadow: n.accent ? "0 0 40px rgba(249,115,22,0.35)" : "none",
              }}>
                <span style={{ fontSize: 26 }}>{n.icon}</span>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 12, fontWeight: 600, color: n.accent ? "#f97316" : "#fff", letterSpacing: 0 }}>{n.label}</div>
                <div style={{ fontSize: 10, color: "#555", marginTop: 2 }}>{n.sub}</div>
              </div>
            </div>
            {/* Arrow */}
            {i < nodes.length - 1 && (
              <div style={{
                opacity: visible ? 1 : 0,
                transition: `opacity 0.4s ease ${i * 0.12 + 0.3}s`,
                display: "flex", alignItems: "center", padding: "0 8px",
              }}>
                <div style={{ height: 1, width: 40, background: "rgba(249,115,22,0.3)" }} />
                <div style={{ width: 0, height: 0, borderTop: "5px solid transparent", borderBottom: "5px solid transparent", borderLeft: "7px solid rgba(249,115,22,0.5)" }} />
              </div>
            )}
          </div>
        ))}
      </div>
      {/* Memory store detail */}
      <div style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(20px)",
        transition: "all 0.6s ease 0.7s",
        display: "flex", gap: 12, marginTop: 8,
      }}>
        {["🗂️ Facts\nextracted per call", "📖 Episodes\ncall summaries", "💬 Sentences\nverbatim quotes"].map((item) => {
          const [icon, ...rest] = item.split(" ");
          const text = rest.join(" ");
          return (
            <div key={text} style={{
              background: "rgba(249,115,22,0.06)",
              border: "1px solid rgba(249,115,22,0.2)",
              borderRadius: 12,
              padding: "12px 18px",
              textAlign: "center",
              minWidth: 140,
            }}>
              <div style={{ fontSize: 20, marginBottom: 4 }}>{icon}</div>
              <div style={{ fontSize: 11, color: "#aaa", lineHeight: 1.5, whiteSpace: "pre-line" }}>{text}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Stats ──────────────────────────────────────────────────────────────── */
const STATS = [
  { value: "3-layer", label: "Memory Architecture" },
  { value: "<100ms", label: "Pipeline Latency" },
  { value: "20+", label: "Providers Supported" },
  { value: "99.9%", label: "Platform Uptime" },
];

/* ─── Comparison table ───────────────────────────────────────────────────── */
const COMPARE_ROWS = [
  { feature: "Persistent Caller Memory",      bolna: false, snap: true },
  { feature: "Structured Fact Extraction",    bolna: false, snap: true },
  { feature: "Auto-Redial on Mid-Call Drop",  bolna: false, snap: true },
  { feature: "Voice Prints (Speaker ID)",     bolna: false, snap: true },
  { feature: "Gender Detection",              bolna: false, snap: true },
  { feature: "Native Booking Engine",         bolna: false, snap: true },
  { feature: "AI Books Appointment Mid-Call", bolna: false, snap: true },
  { feature: "Real-Time Command Center",      bolna: false, snap: true },
  { feature: "Indian Telephony (Vobiz)",      bolna: false, snap: true },
  { feature: "Campaign Engine + Batches",     bolna: "partial", snap: true },
  { feature: "Bring Your Own Provider Keys",  bolna: true,  snap: true },
  { feature: "Knowledge Base",                bolna: true,  snap: true },
];

function CheckMark({ val }: { val: boolean | "partial" }) {
  if (val === true) return (
    <div style={{ width: 28, height: 28, borderRadius: "50%", background: "rgba(249,115,22,0.15)", border: "1px solid rgba(249,115,22,0.4)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto" }}>
      <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M2 7l3 3 6-6" stroke="#f97316" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
    </div>
  );
  if (val === "partial") return (
    <div style={{ width: 28, height: 28, borderRadius: "50%", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.12)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto" }}>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 6h6" stroke="#666" strokeWidth="1.8" strokeLinecap="round"/></svg>
    </div>
  );
  return (
    <div style={{ width: 28, height: 28, borderRadius: "50%", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto" }}>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="#333" strokeWidth="1.6" strokeLinecap="round"/></svg>
    </div>
  );
}

/* ─── Main component ─────────────────────────────────────────────────────── */
export default function LandingPage() {
  const { signIn } = useAuth();
  const heroRef = useRef<HTMLDivElement>(null);

  return (
    <div style={{ minHeight: "100vh", background: "#080808", color: "#fff", fontFamily: "'Inter', sans-serif", overflowX: "hidden", WebkitFontSmoothing: "antialiased" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=Space+Grotesk:wght@400;500;600;700;800&display=swap');

        @keyframes wave1 {
          0%   { d: path("M0,110 C60,60 120,160 200,110 C280,60 340,160 420,110 C500,60 560,160 640,110 C720,60 780,160 860,110 C900,90 900,110 900,110"); }
          50%  { d: path("M0,110 C60,155 120,70 200,110 C280,155 340,70 420,110 C500,155 560,70 640,110 C720,155 780,70 860,110 C900,128 900,110 900,110"); }
          100% { d: path("M0,110 C60,60 120,160 200,110 C280,60 340,160 420,110 C500,60 560,160 640,110 C720,60 780,160 860,110 C900,90 900,110 900,110"); }
        }
        .wave-path-1 { animation: wave1 6s ease-in-out infinite; }
        .wave-path-2 { animation: wave1 8s ease-in-out infinite reverse; }
        .wave-path-3 { animation: wave1 5s ease-in-out infinite 1s; }

        @keyframes pulse-ring {
          0%   { transform: scale(1); opacity: 0.5; }
          100% { transform: scale(2.2); opacity: 0; }
        }
        .pulse-ring { animation: pulse-ring 2.2s cubic-bezier(0.215,0.61,0.355,1) infinite; }
        .pulse-ring-2 { animation: pulse-ring 2.2s cubic-bezier(0.215,0.61,0.355,1) 0.7s infinite; }

        @keyframes float-up {
          from { opacity: 0; transform: translateY(28px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .hero-reveal { animation: float-up 0.9s cubic-bezier(0.16,1,0.3,1) both; }
        .hero-reveal-1 { animation-delay: 0.05s; }
        .hero-reveal-2 { animation-delay: 0.18s; }
        .hero-reveal-3 { animation-delay: 0.32s; }
        .hero-reveal-4 { animation-delay: 0.46s; }
        .hero-reveal-5 { animation-delay: 0.6s; }

        @keyframes ticker {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
        .ticker-track { animation: ticker 18s linear infinite; display: flex; width: max-content; }
        .ticker-track:hover { animation-play-state: paused; }
      `}</style>

      {/* ── NAV ───────────────────────────────────────────────────────────── */}
      <nav style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 50,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 40px", height: 60,
        background: "rgba(8,8,8,0.88)", backdropFilter: "blur(16px)",
        borderBottom: "1px solid rgba(255,255,255,0.07)",
      }}>
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, width: 22 }}>
            <div style={{ height: 5, borderRadius: 3, width: 13, background: "#fff" }} />
            <div style={{ height: 5, borderRadius: 3, width: 17, background: "#555" }} />
            <div style={{ height: 5, borderRadius: 3, width: 13, background: "#333" }} />
          </div>
          <span style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "1.05rem", fontWeight: 700, color: "#fff", letterSpacing: "-0.3px" }}>
            SnapServe <span style={{ color: "#555", fontWeight: 400 }}>AI</span>
          </span>
        </Link>

        <div style={{ display: "flex", gap: 36 }} className="hidden md:flex">
          {["#features", "#how-it-works", "#compare", "#pricing"].map((h, i) => (
            <a key={h} href={h} style={{ fontSize: "0.875rem", color: "#666", textDecoration: "none", transition: "color 0.2s" }}
              onMouseEnter={e => (e.currentTarget.style.color = "#fff")}
              onMouseLeave={e => (e.currentTarget.style.color = "#666")}>
              {["Features", "How it works", "vs Bolna", "Pricing"][i]}
            </a>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <Link href="/sign-in" style={{ fontSize: "0.875rem", color: "#666", textDecoration: "none", transition: "color 0.2s" }}
            onMouseEnter={e => (e.currentTarget.style.color = "#fff")}
            onMouseLeave={e => (e.currentTarget.style.color = "#666")}>
            Sign in
          </Link>
          <Link href="/sign-up" style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            background: "#f97316", color: "#fff",
            fontSize: "0.875rem", fontWeight: 600,
            padding: "9px 20px", borderRadius: 100, textDecoration: "none",
            transition: "opacity 0.2s, box-shadow 0.2s",
            boxShadow: "0 0 0 rgba(249,115,22,0)",
          }}
            onMouseEnter={e => { e.currentTarget.style.opacity = "0.9"; e.currentTarget.style.boxShadow = "0 0 20px rgba(249,115,22,0.35)"; }}
            onMouseLeave={e => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.boxShadow = "0 0 0 rgba(249,115,22,0)"; }}>
            Try for free →
          </Link>
        </div>
      </nav>

      {/* ── HERO ──────────────────────────────────────────────────────────── */}
      <section ref={heroRef} style={{ position: "relative", minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "120px 24px 80px", overflow: "hidden" }}>
        <WaveLeft />
        <WaveRight />

        {/* Center logo + pulse rings */}
        <div className="hero-reveal hero-reveal-1" style={{ position: "relative", marginBottom: 40 }}>
          <div className="pulse-ring" style={{ position: "absolute", inset: -20, borderRadius: "50%", border: "1px solid rgba(249,115,22,0.35)" }} />
          <div className="pulse-ring-2" style={{ position: "absolute", inset: -20, borderRadius: "50%", border: "1px solid rgba(249,115,22,0.2)" }} />
          <div style={{
            width: 88, height: 88, borderRadius: 22,
            background: "linear-gradient(145deg,#f97316,#ea580c)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 0 60px rgba(249,115,22,0.4), 0 0 120px rgba(249,115,22,0.15)",
            position: "relative", zIndex: 1,
          }}>
            <svg width="44" height="44" viewBox="0 0 44 44" fill="none">
              <rect x="6" y="10" width="4" height="24" rx="2" fill="white" opacity="0.9"/>
              <rect x="14" y="6" width="4" height="32" rx="2" fill="white"/>
              <rect x="22" y="13" width="4" height="18" rx="2" fill="white" opacity="0.8"/>
              <rect x="30" y="8" width="4" height="28" rx="2" fill="white" opacity="0.9"/>
              <rect x="38" y="16" width="4" height="12" rx="2" fill="white" opacity="0.5"/>
            </svg>
          </div>
        </div>

        <div className="hero-reveal hero-reveal-2" style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(249,115,22,0.08)", border: "1px solid rgba(249,115,22,0.25)", borderRadius: 100, padding: "6px 16px", marginBottom: 28 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#f97316", boxShadow: "0 0 8px rgba(249,115,22,0.8)", display: "inline-block" }} className="pulse-ring" />
          <span style={{ fontSize: "0.78rem", color: "#f97316", fontWeight: 500, letterSpacing: "0.05em" }}>Beta · Now live</span>
        </div>

        <h1 className="hero-reveal hero-reveal-3" style={{
          fontFamily: "'Space Grotesk',sans-serif",
          fontSize: "clamp(2.8rem,6.5vw,5.5rem)",
          fontWeight: 800, lineHeight: 1.06,
          letterSpacing: "-2.5px",
          marginBottom: 22, maxWidth: 800,
        }}>
          The Voice AI<br />
          <span style={{ color: "#2e2e2e" }}>Platform That</span><br />
          Remembers
        </h1>

        <p className="hero-reveal hero-reveal-4" style={{ fontSize: "clamp(0.95rem,1.5vw,1.1rem)", color: "#666", lineHeight: 1.7, maxWidth: 520, marginBottom: 40 }}>
          SnapServe builds a living memory of every caller — facts, history, voice print — so your AI agent already knows them the next time they call.
        </p>

        <div className="hero-reveal hero-reveal-4" style={{ display: "flex", gap: 14, flexWrap: "wrap", justifyContent: "center", marginBottom: 18 }}>
          <Link href="/sign-up" style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            background: "#f97316", color: "#fff",
            fontSize: "0.95rem", fontWeight: 700,
            padding: "14px 28px", borderRadius: 100, textDecoration: "none",
            boxShadow: "0 0 0 rgba(249,115,22,0)", transition: "all 0.2s",
          }}
            onMouseEnter={e => { e.currentTarget.style.boxShadow = "0 0 30px rgba(249,115,22,0.45)"; }}
            onMouseLeave={e => { e.currentTarget.style.boxShadow = "0 0 0 rgba(249,115,22,0)"; }}>
            Start building free →
          </Link>
          <a href="#features" style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            background: "transparent", color: "#fff",
            fontSize: "0.95rem", fontWeight: 500,
            padding: "14px 28px", borderRadius: 100, textDecoration: "none",
            border: "1px solid rgba(255,255,255,0.15)", transition: "border-color 0.2s",
          }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.35)"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)"; }}>
            See what's different
          </a>
        </div>

        <p className="hero-reveal hero-reveal-5" style={{ fontSize: "0.8rem", color: "#333" }}>$5 free credit · No card required</p>
      </section>

      {/* ── TICKER ────────────────────────────────────────────────────────── */}
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", borderBottom: "1px solid rgba(255,255,255,0.06)", padding: "14px 0", overflow: "hidden", background: "rgba(255,255,255,0.015)" }}>
        <div className="ticker-track">
          {[...Array(2)].map((_, ri) =>
            ["Caller Memory", "Voice Prints", "Auto-Redial", "Gender Detection", "Campaign Engine", "Native Scheduling", "BYOP", "Live Command Center", "Indian Telephony", "Bolna doesn't have this →"].map((item, i) => (
              <span key={`${ri}-${i}`} style={{ fontSize: "0.75rem", color: item.includes("→") ? "#f97316" : "#333", fontWeight: item.includes("→") ? 600 : 400, letterSpacing: "0.08em", textTransform: "uppercase", padding: "0 40px", whiteSpace: "nowrap" }}>
                {item}
              </span>
            ))
          )}
        </div>
      </div>

      {/* ── UNIQUE FEATURES (FAN CARDS) ───────────────────────────────────── */}
      <section id="features" style={{ padding: "100px 40px", maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <p style={{ fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", color: "#f97316", marginBottom: 14 }}>5 things Bolna doesn't have</p>
          <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "clamp(1.8rem,3.5vw,2.8rem)", fontWeight: 800, letterSpacing: "-1.5px", marginBottom: 14 }}>
            What we built that<br />no one else did
          </h2>
          <p style={{ color: "#555", fontSize: "1rem", maxWidth: 480, margin: "0 auto" }}>
            These five capabilities are exclusive to SnapServe. You won't find them bundled together anywhere else.
          </p>
        </div>

        <FanCards />

        {/* Feature labels row */}
        <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 48, flexWrap: "wrap" }}>
          {UNIQUE_FEATURES.map((f, i) => (
            <div key={f.label} style={{
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 12, padding: "14px 20px",
              display: "flex", alignItems: "center", gap: 10,
              transition: "border-color 0.2s",
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(249,115,22,0.3)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; }}>
              <span style={{ fontSize: 20 }}>{f.icon}</span>
              <div>
                <div style={{ fontSize: "0.82rem", fontWeight: 600, color: "#fff", lineHeight: 1.3 }}>{f.label.replace("\n", " ")}</div>
                <div style={{ fontSize: "0.72rem", color: "#444", marginTop: 2 }}>
                  {["Across all calls", "Zero lost leads", "Real-time analysis", "Cross-call ID", "Mid-call booking"][i]}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── MEMORY ARCHITECTURE ───────────────────────────────────────────── */}
      <section id="how-it-works" style={{ padding: "80px 40px", background: "rgba(255,255,255,0.015)", borderTop: "1px solid rgba(255,255,255,0.06)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ maxWidth: 1000, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 56 }}>
            <p style={{ fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", color: "#f97316", marginBottom: 14 }}>CALLER MEMORY</p>
            <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "clamp(1.8rem,3.5vw,2.8rem)", fontWeight: 800, letterSpacing: "-1.5px", marginBottom: 14 }}>
              Your agent remembers.<br/>Every call. Every caller.
            </h2>
            <p style={{ color: "#555", fontSize: "1rem", maxWidth: 460, margin: "0 auto" }}>
              3-layer memory architecture built into every call — no setup, no configuration.
            </p>
          </div>
          <MemoryDiagram />
        </div>
      </section>

      {/* ── AUTO-REDIAL EXPLAINER ─────────────────────────────────────────── */}
      <section style={{ padding: "80px 40px", maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 60, alignItems: "center" }}>
          <div>
            <p style={{ fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", color: "#f97316", marginBottom: 16 }}>AUTO-REDIAL</p>
            <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "clamp(1.6rem,3vw,2.4rem)", fontWeight: 800, letterSpacing: "-1px", marginBottom: 16, lineHeight: 1.15 }}>
              Call drops mid-conversation?<br/>We call back. Automatically.
            </h2>
            <p style={{ color: "#555", fontSize: "1rem", lineHeight: 1.7, marginBottom: 28 }}>
              When a call disconnects unexpectedly — network drop, user hung up by mistake — SnapServe detects it and redials within seconds, with full context preserved. No lead is ever lost to a bad connection.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {["Drop detected in &lt;200ms", "Redial with full conversation context", "Caller picks up where they left off"].map(t => (
                <div key={t} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 20, height: 20, borderRadius: "50%", background: "rgba(249,115,22,0.12)", border: "1px solid rgba(249,115,22,0.3)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5.5l2 2 4-4" stroke="#f97316" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </div>
                  <span style={{ fontSize: "0.875rem", color: "#888" }} dangerouslySetInnerHTML={{ __html: t }} />
                </div>
              ))}
            </div>
          </div>

          {/* Visual: drop → redial diagram */}
          <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 20, padding: 32 }}>
            {[
              { step: "1", label: "Call active", detail: "Agent mid-conversation with caller", color: "#22c55e", icon: "📞" },
              { step: "2", label: "Drop detected", detail: "Connection lost · 180ms detection", color: "#ef4444", icon: "⚡" },
              { step: "3", label: "Auto-redial", detail: "Calling back with full context", color: "#f97316", icon: "🔄" },
              { step: "4", label: "Reconnected", detail: "Conversation resumes seamlessly", color: "#22c55e", icon: "✅" },
            ].map((s, i) => (
              <div key={s.step}>
                <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 0" }}>
                  <div style={{ width: 36, height: 36, borderRadius: "50%", background: `${s.color}18`, border: `1px solid ${s.color}40`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <span style={{ fontSize: 16 }}>{s.icon}</span>
                  </div>
                  <div>
                    <div style={{ fontSize: "0.85rem", fontWeight: 600, color: s.color }}>{s.label}</div>
                    <div style={{ fontSize: "0.75rem", color: "#444" }}>{s.detail}</div>
                  </div>
                </div>
                {i < 3 && <div style={{ marginLeft: 18, width: 1, height: 16, background: "rgba(255,255,255,0.06)" }} />}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── STATS ─────────────────────────────────────────────────────────── */}
      <section style={{ background: "rgba(249,115,22,0.04)", borderTop: "1px solid rgba(249,115,22,0.1)", borderBottom: "1px solid rgba(249,115,22,0.1)", padding: "60px 40px" }}>
        <div style={{ maxWidth: 900, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 2 }}>
          {STATS.map((s, i) => (
            <div key={s.label} style={{
              textAlign: "center", padding: "28px 16px",
              borderRight: i < STATS.length - 1 ? "1px solid rgba(255,255,255,0.06)" : "none",
            }}>
              <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "clamp(1.6rem,3vw,2.4rem)", fontWeight: 800, letterSpacing: "-1px", color: "#f97316", marginBottom: 8 }}>{s.value}</div>
              <div style={{ fontSize: "0.8rem", color: "#444", letterSpacing: "0.02em" }}>{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── COMPARISON TABLE ──────────────────────────────────────────────── */}
      <section id="compare" style={{ padding: "100px 40px", maxWidth: 900, margin: "0 auto" }}>
        <div style={{ textAlign: "center", marginBottom: 56 }}>
          <p style={{ fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", color: "#f97316", marginBottom: 14 }}>VS BOLNA AI</p>
          <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "clamp(1.8rem,3.5vw,2.8rem)", fontWeight: 800, letterSpacing: "-1.5px", marginBottom: 12 }}>
            Feature-by-feature
          </h2>
          <p style={{ color: "#555", fontSize: "0.95rem" }}>Everything Bolna is missing that SnapServe ships today.</p>
        </div>

        <div style={{ border: "1px solid rgba(255,255,255,0.07)", borderRadius: 20, overflow: "hidden" }}>
          {/* Header */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 180px 180px", background: "rgba(255,255,255,0.02)", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
            <div style={{ padding: "18px 24px", fontSize: "0.75rem", color: "#444", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>Feature</div>
            <div style={{ padding: "18px 24px", fontSize: "0.85rem", color: "#555", fontWeight: 600, textAlign: "center" }}>Bolna AI</div>
            <div style={{ padding: "18px 24px", fontSize: "0.85rem", color: "#f97316", fontWeight: 700, textAlign: "center", background: "rgba(249,115,22,0.06)", borderLeft: "1px solid rgba(249,115,22,0.15)" }}>SnapServe ✦</div>
          </div>

          {COMPARE_ROWS.map((row, i) => (
            <div key={row.feature} style={{
              display: "grid", gridTemplateColumns: "1fr 180px 180px",
              borderBottom: i < COMPARE_ROWS.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none",
              transition: "background 0.15s",
            }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.015)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = ""; }}>
              <div style={{ padding: "14px 24px", fontSize: "0.875rem", color: "#999", display: "flex", alignItems: "center" }}>{row.feature}</div>
              <div style={{ padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "center" }}><CheckMark val={row.bolna} /></div>
              <div style={{ padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(249,115,22,0.03)", borderLeft: "1px solid rgba(249,115,22,0.08)" }}><CheckMark val={row.snap} /></div>
            </div>
          ))}
        </div>
      </section>

      {/* ── PRICING ───────────────────────────────────────────────────────── */}
      <section id="pricing" style={{ padding: "80px 40px", background: "rgba(255,255,255,0.015)", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ maxWidth: 1000, margin: "0 auto" }}>
          <div style={{ marginBottom: 56 }}>
            <p style={{ fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", color: "#f97316", marginBottom: 16 }}>PRICING</p>
            <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "clamp(2rem,4vw,3rem)", fontWeight: 800, letterSpacing: "-1.5px", marginBottom: 12 }}>Pay per minute.<br/>No surprises.</h2>
            <p style={{ color: "#555", fontSize: "0.95rem" }}>Bring your own provider keys — you pay SnapServe for orchestration only.</p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16 }}>
            {[
              { tier: "Developer", price: "$0.08", unit: "/ min", highlight: false, features: ["Standard LLM models", "Basic voice clones", "Up to 10 concurrent calls", "Email support", "Caller memory included"] },
              { tier: "Production", price: "$0.12", unit: "/ min", highlight: true, features: ["All premium LLM models", "Ultra-low latency voices", "500 concurrent calls", "Smart SIP escalation", "Priority support"] },
              { tier: "Enterprise", price: "Custom", unit: "", highlight: false, features: ["Dedicated infrastructure", "Custom model fine-tuning", "Unlimited concurrency", "24/7 Slack Connect support", "SLA guarantee"] },
            ].map(plan => (
              <div key={plan.tier} style={{
                background: plan.highlight ? "rgba(249,115,22,0.06)" : "rgba(255,255,255,0.02)",
                border: plan.highlight ? "1px solid rgba(249,115,22,0.3)" : "1px solid rgba(255,255,255,0.07)",
                borderRadius: 20, padding: 28, display: "flex", flexDirection: "column", gap: 20,
                transition: "border-color 0.2s",
              }}
                onMouseEnter={e => { if (!plan.highlight) (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.15)"; }}
                onMouseLeave={e => { if (!plan.highlight) (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.07)"; }}>
                <div>
                  <div style={{ fontSize: "0.75rem", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: plan.highlight ? "#f97316" : "#444", marginBottom: 8 }}>{plan.tier}</div>
                  <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "2.2rem", fontWeight: 800, letterSpacing: "-1px", lineHeight: 1 }}>
                    {plan.price}<span style={{ fontSize: "0.95rem", fontWeight: 400, color: "#444", marginLeft: 4 }}>{plan.unit}</span>
                  </div>
                </div>
                <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
                  {plan.features.map(f => (
                    <li key={f} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: "0.85rem", color: "#666" }}>
                      <span style={{ width: 5, height: 5, borderRadius: "50%", background: plan.highlight ? "#f97316" : "rgba(255,255,255,0.2)", flexShrink: 0, display: "inline-block" }} />
                      {f}
                    </li>
                  ))}
                </ul>
                {plan.tier === "Enterprise" ? (
                  <a href="mailto:sales@snapserve.ai" style={{ display: "block", textAlign: "center", padding: "11px 20px", borderRadius: 100, fontSize: "0.875rem", fontWeight: 600, border: "1px solid rgba(255,255,255,0.15)", color: "#fff", textDecoration: "none", transition: "background 0.2s" }}
                    onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = ""; }}>
                    Contact sales
                  </a>
                ) : (
                  <Link href="/sign-up" style={{
                    display: "block", textAlign: "center", padding: "11px 20px", borderRadius: 100,
                    fontSize: "0.875rem", fontWeight: 700, textDecoration: "none",
                    background: plan.highlight ? "#f97316" : "transparent",
                    color: plan.highlight ? "#fff" : "#fff",
                    border: plan.highlight ? "none" : "1px solid rgba(255,255,255,0.15)",
                    transition: "all 0.2s",
                  }}
                    onMouseEnter={e => { if (!plan.highlight) e.currentTarget.style.background = "rgba(255,255,255,0.05)"; }}
                    onMouseLeave={e => { if (!plan.highlight) e.currentTarget.style.background = "transparent"; }}>
                    Start free
                  </Link>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA BANNER ────────────────────────────────────────────────────── */}
      <section style={{ padding: "80px 40px" }}>
        <div style={{
          maxWidth: 900, margin: "0 auto",
          background: "linear-gradient(135deg, rgba(249,115,22,0.12), rgba(234,88,12,0.06))",
          border: "1px solid rgba(249,115,22,0.2)",
          borderRadius: 28, padding: "60px 48px",
          textAlign: "center",
          position: "relative", overflow: "hidden",
        }}>
          <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at 50% 0%, rgba(249,115,22,0.08) 0%, transparent 70%)", pointerEvents: "none" }} />
          <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "clamp(1.8rem,3.5vw,2.8rem)", fontWeight: 800, letterSpacing: "-1.5px", marginBottom: 16, position: "relative" }}>
            Your callers deserve<br />an agent that remembers them.
          </h2>
          <p style={{ color: "#666", fontSize: "1rem", maxWidth: 400, margin: "0 auto 32px", position: "relative" }}>
            Get started in minutes. $5 free credit included. No credit card required.
          </p>
          <Link href="/sign-up" style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            background: "#f97316", color: "#fff",
            fontSize: "1rem", fontWeight: 700,
            padding: "16px 36px", borderRadius: 100, textDecoration: "none",
            boxShadow: "0 0 40px rgba(249,115,22,0.4)",
            transition: "box-shadow 0.2s",
            position: "relative",
          }}
            onMouseEnter={e => { e.currentTarget.style.boxShadow = "0 0 60px rgba(249,115,22,0.6)"; }}
            onMouseLeave={e => { e.currentTarget.style.boxShadow = "0 0 40px rgba(249,115,22,0.4)"; }}>
            Start building free →
          </Link>
        </div>
      </section>

      {/* ── FOOTER ────────────────────────────────────────────────────────── */}
      <footer style={{ borderTop: "1px solid rgba(255,255,255,0.06)", padding: "48px 40px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", flexDirection: "column", gap: 32 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 32 }}>
            <div style={{ maxWidth: 260 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 3, width: 20 }}>
                  <div style={{ height: 4, borderRadius: 2, width: 12, background: "#f97316" }} />
                  <div style={{ height: 4, borderRadius: 2, width: 16, background: "#555" }} />
                  <div style={{ height: 4, borderRadius: 2, width: 12, background: "#333" }} />
                </div>
                <span style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: "0.95rem", fontWeight: 700, color: "#fff" }}>
                  SnapServe AI
                </span>
              </div>
              <p style={{ fontSize: "0.8rem", color: "#333", lineHeight: 1.6 }}>Carrier-grade voice orchestration for the AI era.</p>
            </div>

            <div style={{ display: "flex", gap: 60, flexWrap: "wrap" }}>
              {[
                { title: "Platform", links: ["Assistants", "Campaigns", "Scheduling", "Providers", "Voices"] },
                { title: "Developers", links: ["API Reference", "Documentation", "Status"] },
                { title: "Company", links: ["Privacy", "Terms", "Contact"] },
              ].map(col => (
                <div key={col.title}>
                  <p style={{ fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#333", marginBottom: 16 }}>{col.title}</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {col.links.map(l => (
                      <a key={l} href="#" style={{ fontSize: "0.8rem", color: "#444", textDecoration: "none", transition: "color 0.2s" }}
                        onMouseEnter={e => { e.currentTarget.style.color = "#aaa"; }}
                        onMouseLeave={e => { e.currentTarget.style.color = "#444"; }}>
                        {l}
                      </a>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ borderTop: "1px solid rgba(255,255,255,0.04)", paddingTop: 24, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <p style={{ fontSize: "0.78rem", color: "#2a2a2a" }}>© 2026 SnapServe AI. All rights reserved.</p>
            <p style={{ fontSize: "0.78rem", color: "#f97316", opacity: 0.5 }}>Built on open-source · Bolna inspired</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
