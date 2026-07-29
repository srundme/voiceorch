import { useEffect, useRef } from "react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { SnapServeSarvamLockup } from "@/components/logo";

/* ─────────────────────────────────────────────────────────────────────────── */
/*  DATA                                                                        */
/* ─────────────────────────────────────────────────────────────────────────── */

const DIFFERENTIATORS = [
  {
    tag: "01 — MEMORY",
    headline: "Your agent never\nforgets a caller.",
    body: "Every call extracts structured facts, episode summaries, and verbatim quotes into a 3-layer memory graph. The next call starts with full context — no repeated intros, no forgotten promises.",
    accent: "#F7941D",
    glow: "rgba(247,148,29,0.15)",
    detail: ["Facts extracted per call", "Episode summaries archived", "Verbatim sentences preserved"],
    icon: "M",
  },
  {
    tag: "02 — RESILIENCE",
    headline: "Call drops mid-\nconversation? We redial.",
    body: "Network blip, bad signal, accidental hang-up — SnapServe detects the drop in under 200 ms and automatically redials, resuming with full conversation context. Zero leads lost to bad connections.",
    accent: "#3D47D8",
    glow: "rgba(61,71,216,0.15)",
    detail: ["<200ms drop detection", "Auto-redial with context", "Seamless resume for caller"],
    icon: "R",
  },
  {
    tag: "03 — IDENTITY",
    headline: "Voice prints.\nGender detection.",
    body: "Identify returning callers by their voice signature — even from a different number. Real-time gender analysis shapes tone and vocabulary. No other voice AI platform ships both together.",
    accent: "#f59e0b",
    glow: "rgba(245,158,11,0.15)",
    detail: ["Azure Speaker Recognition", "Real-time gender analysis", "Cross-number caller ID"],
    icon: "V",
  },
  {
    tag: "04 — CAMPAIGNS",
    headline: "Upload 10,000 leads.\nWatch them get called.",
    body: "Full outbound campaign engine — CSV import, batch management, retry logic, DNC filtering, live queue monitoring, disposition tracking, and callback scheduling. Not an API you glue together. A platform.",
    accent: "#22c55e",
    glow: "rgba(34,197,94,0.15)",
    detail: ["CSV batch import", "Smart retry + DNC", "Live command center"],
    icon: "C",
  },
  {
    tag: "05 — SCHEDULING",
    headline: "Agent books the\nmeeting mid-call.",
    body: "Built-in booking engine with Google Calendar sync, availability windows, timezone awareness, and double-booking prevention. The agent books the appointment before the call ends — no Cal.com, no Zapier, no third party.",
    accent: "#ec4899",
    glow: "rgba(236,72,153,0.15)",
    detail: ["Books during the call", "Google Calendar sync", "No third-party needed"],
    icon: "S",
  },
];

const STATS = [
  { value: 3, suffix: "-layer", label: "Memory Architecture" },
  { value: 200, suffix: "ms", label: "Drop Detection Speed", prefix: "<" },
  { value: 20, suffix: "+", label: "Providers Supported" },
  { value: 99.9, suffix: "%", label: "Platform Uptime" },
];

const COMPARE = [
  { f: "Persistent Caller Memory",      bolna: false },
  { f: "Structured Fact Extraction",    bolna: false },
  { f: "Auto-Redial on Mid-Call Drop",  bolna: false },
  { f: "Voice Prints (Speaker ID)",     bolna: false },
  { f: "Gender Detection",              bolna: false },
  { f: "Native Booking Engine",         bolna: false },
  { f: "AI Books Appointment Mid-Call", bolna: false },
  { f: "Real-Time Command Center",      bolna: false },
  { f: "Indian Telephony (Vobiz)",      bolna: false },
  { f: "Campaign Engine + Batches",     bolna: "partial" },
  { f: "Bring Your Own Provider Keys",  bolna: true },
  { f: "Knowledge Base",                bolna: true },
];

/* ─────────────────────────────────────────────────────────────────────────── */
/*  COMPONENT                                                                   */
/* ─────────────────────────────────────────────────────────────────────────── */

export default function LandingPage() {
  const { signIn } = useAuth();
  const rootRef   = useRef<HTMLDivElement>(null);
  const heroRef   = useRef<HTMLDivElement>(null);
  const orbRef    = useRef<HTMLDivElement>(null);
  const statsRef  = useRef<HTMLDivElement>(null);
  const countersRef = useRef<HTMLSpanElement[]>([]);

  /* Stat counters via IntersectionObserver */
  useEffect(() => {
    const spans = document.querySelectorAll<HTMLSpanElement>(".stat-num");
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target as HTMLSpanElement;
        const idx = Array.from(spans).indexOf(el);
        const stat = STATS[idx];
        if (!stat) return;
        const isFloat = stat.value % 1 !== 0;
        let start = 0;
        const step = stat.value / 40;
        const tick = () => {
          start = Math.min(start + step, stat.value);
          el.textContent = isFloat ? start.toFixed(1) : Math.round(start).toString();
          if (start < stat.value) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        observer.unobserve(el);
      });
    }, { threshold: 0.3 });
    spans.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={rootRef} style={{ background: "#000", color: "#fff", fontFamily: "'Inter',sans-serif", overflowX: "hidden", WebkitFontSmoothing: "antialiased", MozOsxFontSmoothing: "grayscale" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=Cal+Sans&display=swap');

        * { box-sizing: border-box; margin: 0; padding: 0; }

        /* Grid overlay */
        .grid-bg {
          background-image:
            linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px);
          background-size: 60px 60px;
        }

        /* Gradient text */
        .grad-orange { background: linear-gradient(135deg, #F7941D, #F9A94A); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
        .grad-cyan   { background: linear-gradient(135deg, #3D47D8, #9AA3FF); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
        .grad-white  { background: linear-gradient(180deg, #fff 60%, rgba(255,255,255,0.55)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }

        /* Ticker */
        @keyframes ticker { from { transform: translateX(0) } to { transform: translateX(-50%) } }
        .ticker-inner { animation: ticker 22s linear infinite; display: flex; width: max-content; }

        /* Glow pulse */
        @keyframes orb-pulse { 0%,100% { opacity:0.55; transform:scale(1) } 50% { opacity:0.75; transform:scale(1.06) } }
        .orb-anim { animation: orb-pulse 6s ease-in-out infinite; }

        /* Btn hover */
        .btn-primary:hover { opacity:.9; box-shadow: 0 0 40px rgba(247,148,29,.45); }
        .btn-ghost:hover   { background: rgba(255,255,255,.06); border-color: rgba(255,255,255,.3); }
        .nav-link:hover    { color:#fff; }

        /* Compare row */
        .cmp-row:hover { background: rgba(255,255,255,.018); }

        /* Feature card hover */
        .diff-card:hover .diff-inner { border-color: rgba(255,255,255,.12); }
      `}</style>

      {/* ── NAV ─────────────────────────────────────────────────────────── */}
      <nav style={{ position: "fixed", inset: "0 0 auto", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 32px", height: 58, background: "rgba(0,0,0,0.8)", backdropFilter: "blur(20px)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 9, textDecoration: "none" }}>
          <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
            <rect width="26" height="26" rx="7" fill="#F7941D"/>
            <rect x="4" y="7" width="3" height="12" rx="1.5" fill="white" opacity=".9"/>
            <rect x="9" y="4" width="3" height="18" rx="1.5" fill="white"/>
            <rect x="14" y="9" width="3" height="8" rx="1.5" fill="white" opacity=".8"/>
            <rect x="19" y="5" width="3" height="16" rx="1.5" fill="white" opacity=".9"/>
          </svg>
          <span style={{ fontWeight: 700, fontSize: 15, letterSpacing: "-0.4px", color: "#fff" }}>SnapServe <span style={{ color: "#555", fontWeight: 400 }}>AI</span></span>
        </Link>

        <div style={{ display: "flex", gap: 32 }}>
          {[["#features","Features"],["#compare","vs Bolna"],["#pricing","Pricing"]].map(([h,l]) => (
            <a key={h} href={h} className="nav-link" style={{ fontSize: 13.5, color: "#555", textDecoration: "none", transition: "color .15s", fontWeight: 500 }}>{l}</a>
          ))}
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <Link href="/sign-in" className="nav-link" style={{ fontSize: 13.5, color: "#555", textDecoration: "none", transition: "color .15s", fontWeight: 500 }}>Sign in</Link>
          <Link href="/sign-up" className="btn-primary" style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#F7941D", color: "#fff", fontSize: 13.5, fontWeight: 600, padding: "8px 18px", borderRadius: 8, textDecoration: "none", transition: "opacity .2s, box-shadow .2s", letterSpacing: "-0.1px" }}>
            Get started →
          </Link>
        </div>
      </nav>

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <section ref={heroRef} className="grid-bg" style={{ position: "relative", minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "120px 24px 100px", overflow: "hidden" }}>

        {/* Gradient vignette over grid */}
        <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse 80% 60% at 50% 50%, rgba(0,0,0,0) 0%, #000 100%)", pointerEvents: "none" }} />

        {/* Orbs */}
        <div className="hero-orb orb-anim" style={{ position: "absolute", top: "15%", left: "50%", transform: "translateX(-50%)", width: 700, height: 700, borderRadius: "50%", background: "radial-gradient(circle, rgba(247,148,29,0.18) 0%, rgba(247,148,29,0.04) 50%, transparent 70%)", pointerEvents: "none", zIndex: 0 }} />
        <div style={{ position: "absolute", top: "30%", left: "20%", width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgba(61,71,216,0.06) 0%, transparent 70%)", pointerEvents: "none", zIndex: 0 }} />

        <div style={{ position: "relative", zIndex: 1, maxWidth: 900 }}>
          {/* Badge */}
          <div className="hero-badge" style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(247,148,29,0.12)", border: "1px solid rgba(247,148,29,0.35)", borderRadius: 100, padding: "6px 16px", marginBottom: 36 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#F7941D", display: "inline-block", boxShadow: "0 0 8px #F7941D" }} />
            <span style={{ fontSize: 12, color: "#F9A94A", fontWeight: 600, letterSpacing: "0.06em" }}>POWERED BY SARVAM · INDIC VOICE AI</span>
          </div>

          {/* Headline */}
          <h1 className="hero-h1" style={{ fontWeight: 800, lineHeight: 1.03, letterSpacing: "-4px", marginBottom: 28, overflow: "hidden" }}>
            <span className="grad-white" style={{ display: "block", fontSize: "clamp(3.5rem,8vw,7rem)", fontFamily: "Inter,sans-serif" }}>The Voice AI</span>
            <span className="grad-orange" style={{ display: "block", fontSize: "clamp(3.5rem,8vw,7rem)", fontFamily: "Inter,sans-serif" }}>Platform That</span>
            <span className="grad-white" style={{ display: "block", fontSize: "clamp(3.5rem,8vw,7rem)", fontFamily: "Inter,sans-serif" }}>Remembers</span>
          </h1>

          <p className="hero-sub" style={{ fontSize: "clamp(1rem,1.8vw,1.2rem)", color: "#555", lineHeight: 1.7, maxWidth: 520, margin: "0 auto 44px", fontWeight: 400 }}>
            SnapServe — powered by Sarvam — builds living memory of every caller so your Indic voice agents already know them next time.
          </p>

          {/* CTAs */}
          <div className="hero-ctas" style={{ display: "flex", gap: 14, justifyContent: "center", flexWrap: "wrap", marginBottom: 20 }}>
            <Link href="/sign-up" className="btn-primary" style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#F7941D", color: "#fff", fontSize: 15, fontWeight: 700, padding: "14px 28px", borderRadius: 10, textDecoration: "none", transition: "opacity .2s, box-shadow .2s", letterSpacing: "-0.2px" }}>
              Start building free
            </Link>
            <a href="#features" className="btn-ghost" style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.04)", color: "#fff", fontSize: 15, fontWeight: 500, padding: "14px 28px", borderRadius: 10, textDecoration: "none", border: "1px solid rgba(255,255,255,0.1)", transition: "background .2s, border-color .2s" }}>
              See what's different
            </a>
          </div>

          <p className="hero-note" style={{ fontSize: 12, color: "#333", letterSpacing: "0.02em" }}>₹500 free credit · No card required</p>
        </div>

        {/* Bottom gradient fade */}
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 200, background: "linear-gradient(to bottom, transparent, #000)", pointerEvents: "none" }} />
      </section>

      {/* ── TICKER ──────────────────────────────────────────────────────── */}
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)", borderBottom: "1px solid rgba(255,255,255,0.05)", padding: "13px 0", overflow: "hidden" }}>
        <div className="ticker-inner">
          {Array.from({ length: 2 }, (_, ri) =>
            ["Caller Memory", "Auto-Redial", "Voice Prints", "Gender Detection", "Campaign Engine", "Native Scheduling", "BYOP", "Live Command Center", "Indian Telephony", "Bolna doesn't have this"].map((item, i) => (
              <span key={`${ri}-${i}`} style={{ fontSize: 11, color: item === "Bolna doesn't have this" ? "#F7941D" : "#2a2a2a", fontWeight: item === "Bolna doesn't have this" ? 700 : 500, letterSpacing: "0.12em", textTransform: "uppercase", padding: "0 36px", whiteSpace: "nowrap" }}>
                {item} {item !== "Bolna doesn't have this" && <span style={{ color: "#1a1a1a", marginLeft: 36 }}>·</span>}
              </span>
            ))
          )}
        </div>
      </div>

      {/* ── 5 DIFFERENTIATORS ───────────────────────────────────────────── */}
      <section id="features" style={{ padding: "120px 24px", maxWidth: 1100, margin: "0 auto" }}>
        <div className="reveal" style={{ textAlign: "center", marginBottom: 80 }}>
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "#F7941D", marginBottom: 16 }}>Exclusive features</p>
          <h2 style={{ fontWeight: 800, fontSize: "clamp(2rem,4vw,3.2rem)", letterSpacing: "-2px", lineHeight: 1.1, marginBottom: 16 }}>
            5 things Bolna doesn't have
          </h2>
          <p style={{ color: "#444", fontSize: "1rem", maxWidth: 440, margin: "0 auto" }}>Built from scratch. Not on a roadmap. Shipped today.</p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))", gap: 1, border: "1px solid rgba(255,255,255,0.07)", borderRadius: 20, overflow: "hidden" }}>
          {DIFFERENTIATORS.map((d, i) => (
            <div key={d.tag} className="diff-card" style={{ position: "relative" }}>
              <div className="diff-inner" style={{ height: "100%", padding: "36px 32px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", transition: "border-color .2s", display: "flex", flexDirection: "column", gap: 20 }}>
                {/* Glow spot */}
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: `linear-gradient(90deg, transparent, ${d.accent}60, transparent)` }} />

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: d.accent }}>{d.tag}</span>
                  <span style={{ fontSize: 28 }}>{d.icon}</span>
                </div>

                <h3 style={{ fontWeight: 800, fontSize: "1.4rem", letterSpacing: "-0.8px", lineHeight: 1.2, whiteSpace: "pre-line", color: "#fff" }}>{d.headline}</h3>

                <p style={{ fontSize: "0.875rem", color: "#555", lineHeight: 1.7, flex: 1 }}>{d.body}</p>

                <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
                  {d.detail.map(dt => (
                    <li key={dt} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: "0.8rem", color: "#444" }}>
                      <span style={{ width: 18, height: 18, borderRadius: "50%", background: `${d.accent}18`, border: `1px solid ${d.accent}40`, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <svg width="9" height="9" viewBox="0 0 9 9" fill="none"><path d="M1.5 4.5l2 2 4-4" stroke={d.accent} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                      </span>
                      {dt}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── MEMORY ARCHITECTURE ─────────────────────────────────────────── */}
      <section style={{ background: "#050505", borderTop: "1px solid rgba(255,255,255,0.05)", borderBottom: "1px solid rgba(255,255,255,0.05)", padding: "100px 24px" }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <div className="reveal" style={{ textAlign: "center", marginBottom: 64 }}>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "#F7941D", marginBottom: 16 }}>Memory architecture</p>
            <h2 style={{ fontWeight: 800, fontSize: "clamp(2rem,4vw,3rem)", letterSpacing: "-2px", lineHeight: 1.1, marginBottom: 14 }}>
              3 layers. Every call.<br />Zero configuration.
            </h2>
            <p style={{ color: "#444", fontSize: "0.95rem", maxWidth: 420, margin: "0 auto" }}>SnapServe extracts, stores, and retrieves caller context automatically on every call.</p>
          </div>

          {/* Pipeline row */}
          <div className="reveal" style={{ display: "flex", alignItems: "stretch", gap: 0, overflowX: "auto", paddingBottom: 8 }}>
            {[
              { label: "Caller Rings",      sub: "phone or webcall",           color: "#6b7280", icon: "C" },
              { label: "Voice Analysis",    sub: "gender · voice print",        color: "#F7941D", icon: "V" },
              { label: "Memory Query",      sub: "facts · episodes · sentences", color: "#F7941D", icon: "M", accent: true },
              { label: "LLM Response",      sub: "context-aware reply",          color: "#3D47D8", icon: "L" },
              { label: "Action Taken",      sub: "book · transfer · callback",   color: "#22c55e", icon: "OK" },
            ].map((n, i, arr) => (
              <div key={n.label} style={{ display: "flex", alignItems: "center", flex: i === 2 ? "0 0 auto" : "1 1 0" }}>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 12, minWidth: 120 }}>
                  <div style={{ width: 72, height: 72, borderRadius: 18, background: n.accent ? "rgba(247,148,29,0.12)" : "rgba(255,255,255,0.03)", border: n.accent ? "1px solid rgba(247,148,29,0.35)" : "1px solid rgba(255,255,255,0.07)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, boxShadow: n.accent ? "0 0 30px rgba(247,148,29,0.15)" : "none" }}>
                    {n.icon}
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: n.accent ? "#F7941D" : "#aaa" }}>{n.label}</div>
                    <div style={{ fontSize: 10, color: "#333", marginTop: 3 }}>{n.sub}</div>
                  </div>
                </div>
                {i < arr.length - 1 && (
                  <div style={{ display: "flex", alignItems: "center", padding: "0 4px", flexShrink: 0 }}>
                    <div style={{ width: 32, height: 1, background: "rgba(247,148,29,0.25)" }} />
                    <div style={{ width: 0, height: 0, borderTop: "4px solid transparent", borderBottom: "4px solid transparent", borderLeft: "5px solid rgba(247,148,29,0.4)" }} />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* 3-layer cards */}
          <div className="reveal" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginTop: 48 }}>
            {[
              { title: "Facts Layer",    desc: "Structured facts extracted per call — budget, intent, family info, product interest", icon: "F", color: "#F7941D" },
              { title: "Episode Layer",  desc: "AI-written summary of each call stored as a searchable episode in the memory graph", icon: "E", color: "#3D47D8" },
              { title: "Sentence Layer", desc: "Verbatim notable quotes preserved word-for-word — what they actually said", icon: "Q", color: "#22c55e" },
            ].map(c => (
              <div key={c.title} style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: "24px 22px", transition: "border-color .2s" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = `${c.color}50`; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.07)"; }}>
                <div style={{ fontSize: 24, marginBottom: 12 }}>{c.icon}</div>
                <div style={{ fontWeight: 700, fontSize: 14, color: c.color, marginBottom: 8 }}>{c.title}</div>
                <div style={{ fontSize: 12, color: "#444", lineHeight: 1.65 }}>{c.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── STATS ───────────────────────────────────────────────────────── */}
      <section style={{ padding: "80px 24px" }}>
        <div style={{ maxWidth: 800, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 0 }}>
          {STATS.map((s, i) => (
            <div key={s.label} style={{ textAlign: "center", padding: "32px 16px", borderRight: i < STATS.length - 1 ? "1px solid rgba(255,255,255,0.05)" : "none" }}>
              <div style={{ fontWeight: 800, fontSize: "clamp(2rem,4vw,3rem)", letterSpacing: "-2px", color: "#F7941D", marginBottom: 8, fontVariantNumeric: "tabular-nums" }}>
                {s.prefix ?? ""}<span className="stat-num">0</span>{s.suffix}
              </div>
              <div style={{ fontSize: 11, color: "#333", letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 600 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── AUTO-REDIAL DEEP DIVE ────────────────────────────────────────── */}
      <section style={{ padding: "80px 24px", background: "#050505", borderTop: "1px solid rgba(255,255,255,0.05)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <div style={{ maxWidth: 1000, margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 72, alignItems: "center" }}>
          <div className="reveal">
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "#3D47D8", marginBottom: 18 }}>Auto-redial</p>
            <h2 style={{ fontWeight: 800, fontSize: "clamp(1.8rem,3vw,2.6rem)", letterSpacing: "-1.5px", lineHeight: 1.15, marginBottom: 18 }}>
              Lost connection.<br />Zero lost leads.
            </h2>
            <p style={{ color: "#444", fontSize: "0.95rem", lineHeight: 1.75, marginBottom: 28 }}>
              Network blip, accidental hang-up, bad signal — SnapServe detects the disconnect in under 200 ms and redials automatically. The caller picks up exactly where they left off.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {["Drop detected in <200ms", "Redial with full context preserved", "Caller resumes — no re-intro needed"].map(t => (
                <div key={t} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ width: 22, height: 22, borderRadius: "50%", background: "rgba(61,71,216,0.1)", border: "1px solid rgba(61,71,216,0.3)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5.5l2 2 4-4" stroke="#3D47D8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </div>
                  <span style={{ fontSize: "0.85rem", color: "#555" }}>{t}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Timeline visual */}
          <div className="reveal" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 20, padding: 32 }}>
            {[
              { step: "Active call",     detail: "Agent mid-conversation",              icon: "C", color: "#22c55e" },
              { step: "Drop detected",   detail: "180ms · connection lost",             icon: "L", color: "#ef4444" },
              { step: "Auto-redial",     detail: "Calling back with full memory",       icon: "R", color: "#f59e0b" },
              { step: "Reconnected",     detail: "Conversation resumes seamlessly",      icon: "OK", color: "#22c55e" },
            ].map((s, i) => (
              <div key={s.step}>
                <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 0" }}>
                  <div style={{ width: 40, height: 40, borderRadius: "50%", background: `${s.color}12`, border: `1px solid ${s.color}40`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>
                    {s.icon}
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: s.color }}>{s.step}</div>
                    <div style={{ fontSize: 11, color: "#333", marginTop: 2 }}>{s.detail}</div>
                  </div>
                </div>
                {i < 3 && <div style={{ marginLeft: 20, width: 1, height: 14, background: "rgba(255,255,255,0.04)" }} />}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── COMPARISON ──────────────────────────────────────────────────── */}
      <section id="compare" style={{ padding: "100px 24px" }}>
        <div style={{ maxWidth: 860, margin: "0 auto" }}>
          <div className="reveal" style={{ textAlign: "center", marginBottom: 60 }}>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "#F7941D", marginBottom: 16 }}>vs Bolna AI</p>
            <h2 style={{ fontWeight: 800, fontSize: "clamp(2rem,4vw,3rem)", letterSpacing: "-2px", lineHeight: 1.1, marginBottom: 12 }}>Feature by feature</h2>
            <p style={{ color: "#444", fontSize: "0.95rem" }}>Everything Bolna is missing that SnapServe ships today.</p>
          </div>

          <div className="reveal" style={{ border: "1px solid rgba(255,255,255,0.07)", borderRadius: 20, overflow: "hidden" }}>
            {/* Header */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 160px 160px", background: "rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              <div style={{ padding: "16px 24px", fontSize: 11, color: "#333", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>Feature</div>
              <div style={{ padding: "16px 24px", textAlign: "center", fontSize: 13, color: "#444", fontWeight: 600 }}>Bolna AI</div>
              <div style={{ padding: "16px 24px", textAlign: "center", fontSize: 13, fontWeight: 700, background: "rgba(247,148,29,0.07)", borderLeft: "1px solid rgba(247,148,29,0.12)", color: "#F7941D" }}>SnapServe</div>
            </div>

            {COMPARE.map((row, i) => (
              <div key={row.f} className="cmp-row" style={{ display: "grid", gridTemplateColumns: "1fr 160px 160px", borderBottom: i < COMPARE.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none", transition: "background .15s" }}>
                <div style={{ padding: "13px 24px", fontSize: 13.5, color: "#555", display: "flex", alignItems: "center" }}>{row.f}</div>
                <div style={{ padding: "13px 24px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {row.bolna === true
                    ? <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8.5l3 3 7-7" stroke="#444" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    : row.bolna === "partial"
                    ? <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 8h8" stroke="#333" strokeWidth="1.5" strokeLinecap="round"/></svg>
                    : <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 3l8 8M11 3l-8 8" stroke="#222" strokeWidth="1.5" strokeLinecap="round"/></svg>
                  }
                </div>
                <div style={{ padding: "13px 24px", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(247,148,29,0.03)", borderLeft: "1px solid rgba(247,148,29,0.07)" }}>
                  <div style={{ width: 22, height: 22, borderRadius: "50%", background: "rgba(247,148,29,0.12)", border: "1px solid rgba(247,148,29,0.35)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5.5l2 2 4-4" stroke="#F7941D" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PRICING ─────────────────────────────────────────────────────── */}
      <section id="pricing" style={{ padding: "80px 24px", background: "#050505", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
        <div style={{ maxWidth: 960, margin: "0 auto" }}>
          <div className="reveal" style={{ marginBottom: 56 }}>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "#F7941D", marginBottom: 16 }}>Pricing</p>
            <h2 style={{ fontWeight: 800, fontSize: "clamp(2rem,4vw,3rem)", letterSpacing: "-2px", lineHeight: 1.1, marginBottom: 10 }}>Pay per minute.<br/>No surprises.</h2>
            <p style={{ color: "#444", fontSize: "0.95rem" }}>Default stack is Sarvam STT + TTS. Bring your own keys for other providers when you need them.</p>
          </div>

          <div className="reveal" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
            {[
              { tier: "Starter", price: "₹5", unit: "/min", hi: false, features: ["Flat platform fee", "Sarvam-powered defaults", "10 concurrent calls", "Email support", "Caller memory included"] },
              { tier: "Production", price: "₹5", unit: "/min", hi: true,  features: ["Same flat ₹5/min", "Card wallet top-ups", "500 concurrent calls", "Priority support", "Smart SIP escalation"] },
              { tier: "Enterprise", price: "Custom", unit: "",    hi: false, features: ["Dedicated infrastructure", "Custom model fine-tuning", "Unlimited concurrency", "24/7 Slack support", "SLA guarantee"] },
            ].map(plan => (
              <div key={plan.tier} style={{ position: "relative", background: plan.hi ? "rgba(247,148,29,0.07)" : "rgba(255,255,255,0.02)", border: plan.hi ? "1px solid rgba(247,148,29,0.3)" : "1px solid rgba(255,255,255,0.07)", borderRadius: 18, padding: 28, display: "flex", flexDirection: "column", gap: 22, transition: "border-color .2s" }}
                onMouseEnter={e => { if (!plan.hi) (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.14)"; }}
                onMouseLeave={e => { if (!plan.hi) (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.07)"; }}>
                {plan.hi && <div style={{ position: "absolute", top: -1, left: 24, right: 24, height: 1, background: "linear-gradient(90deg, transparent, #F7941D, transparent)" }} />}
                <div>
                  <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: plan.hi ? "#F7941D" : "#333", marginBottom: 10 }}>{plan.tier}</div>
                  <div style={{ fontWeight: 800, fontSize: "2.2rem", letterSpacing: "-1.5px", lineHeight: 1 }}>
                    {plan.price}<span style={{ fontSize: "0.9rem", fontWeight: 400, color: "#333", marginLeft: 4 }}>{plan.unit}</span>
                  </div>
                </div>
                <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
                  {plan.features.map(f => (
                    <li key={f} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "#444" }}>
                      <span style={{ width: 4, height: 4, borderRadius: "50%", background: plan.hi ? "#F7941D" : "#333", flexShrink: 0 }} />
                      {f}
                    </li>
                  ))}
                </ul>
                {plan.tier === "Enterprise"
                  ? <a href="mailto:sales@snapserve.ai" className="btn-ghost" style={{ display: "block", textAlign: "center", padding: "11px 0", borderRadius: 9, fontSize: 13.5, fontWeight: 600, border: "1px solid rgba(255,255,255,0.1)", color: "#fff", textDecoration: "none", transition: "background .2s, border-color .2s" }}>Contact sales</a>
                  : <Link href="/sign-up" style={{ display: "block", textAlign: "center", padding: "11px 0", borderRadius: 9, fontSize: 13.5, fontWeight: 700, background: plan.hi ? "#F7941D" : "rgba(255,255,255,0.05)", color: "#fff", textDecoration: "none", border: plan.hi ? "none" : "1px solid rgba(255,255,255,0.08)", transition: "opacity .2s" }}
                    onMouseEnter={e => { e.currentTarget.style.opacity = "0.85"; }}
                    onMouseLeave={e => { e.currentTarget.style.opacity = "1"; }}>
                    Start free
                  </Link>
                }
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ─────────────────────────────────────────────────────────── */}
      <section style={{ padding: "100px 24px" }}>
        <div style={{ maxWidth: 760, margin: "0 auto", textAlign: "center" }}>
          <div className="reveal" style={{ position: "relative", background: "rgba(247,148,29,0.05)", border: "1px solid rgba(247,148,29,0.18)", borderRadius: 24, padding: "72px 48px", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 500, height: 300, borderRadius: "50%", background: "radial-gradient(ellipse, rgba(247,148,29,0.12) 0%, transparent 70%)", pointerEvents: "none" }} />
            <h2 style={{ fontWeight: 800, fontSize: "clamp(1.8rem,4vw,3rem)", letterSpacing: "-2px", lineHeight: 1.1, marginBottom: 16, position: "relative" }}>
              Your callers deserve an<br />agent that remembers them.
            </h2>
            <p style={{ color: "#444", fontSize: "0.95rem", marginBottom: 36, position: "relative" }}>
              ₹500 free credit. Pay by card. Takes 2 minutes.
            </p>
            <Link href="/sign-up" className="btn-primary" style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#F7941D", color: "#fff", fontSize: 15, fontWeight: 700, padding: "15px 36px", borderRadius: 10, textDecoration: "none", transition: "opacity .2s, box-shadow .2s", letterSpacing: "-0.2px", position: "relative", boxShadow: "0 0 40px rgba(247,148,29,0.3)" }}>
              Start building free →
            </Link>
          </div>
        </div>
      </section>

      {/* ── FOOTER ──────────────────────────────────────────────────────── */}
      <footer style={{ borderTop: "1px solid rgba(255,255,255,0.05)", padding: "48px 32px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 36, marginBottom: 48 }}>
            <div style={{ maxWidth: 220 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                <svg width="22" height="22" viewBox="0 0 26 26" fill="none">
                  <rect width="26" height="26" rx="7" fill="#F7941D"/>
                  <rect x="4" y="7" width="3" height="12" rx="1.5" fill="white" opacity=".9"/>
                  <rect x="9" y="4" width="3" height="18" rx="1.5" fill="white"/>
                  <rect x="14" y="9" width="3" height="8" rx="1.5" fill="white" opacity=".8"/>
                  <rect x="19" y="5" width="3" height="16" rx="1.5" fill="white" opacity=".9"/>
                </svg>
                <span style={{ fontWeight: 700, fontSize: 14, color: "#fff", letterSpacing: "-0.3px" }}>SnapServe AI</span>
              </div>
              <p style={{ fontSize: 12, color: "#2a2a2a", lineHeight: 1.65 }}>SnapServe — powered by Sarvam. Indic voice agents with caller memory.</p>
            </div>
            <div style={{ display: "flex", gap: 60, flexWrap: "wrap" }}>
              {[
                { title: "Platform", links: ["Assistants","Campaigns","Scheduling","Providers","Voices"] },
                { title: "Developers", links: ["API Reference","Docs","Status","Changelog"] },
                { title: "Company", links: ["Privacy","Terms","Contact"] },
              ].map(col => (
                <div key={col.title}>
                  <p style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#252525", marginBottom: 16 }}>{col.title}</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {col.links.map(l => (
                      <a key={l} href="#" className="nav-link" style={{ fontSize: 13, color: "#333", textDecoration: "none", transition: "color .15s" }}>{l}</a>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.04)", paddingTop: 24, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
            <p style={{ fontSize: 12, color: "#1f1f1f" }}>© 2026 SnapServe AI. All rights reserved.</p>
            <SnapServeSarvamLockup height={16} on="dark" className="opacity-55" />
          </div>
        </div>
      </footer>
    </div>
  );
}
