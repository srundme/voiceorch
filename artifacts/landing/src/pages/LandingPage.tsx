import { useRef, useEffect, useState } from "react";
import { HeroOrb } from "@/components/HeroOrb";

/* ── helpers ─────────────────────────────────────────────────────────── */
function useInView(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, visible };
}

function Reveal({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  const { ref, visible } = useInView();
  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(28px)",
        transition: `opacity 0.72s ease ${delay}ms, transform 0.72s ease ${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

/* ── wave SVGs (vobiz-inspired) ──────────────────────────────────────── */
function WaveLeft() {
  return (
    <svg viewBox="0 0 900 700" fill="none" xmlns="http://www.w3.org/2000/svg"
      style={{ position: "absolute", left: 0, top: "50%", transform: "translateY(-50%)", width: "48%", height: "auto", opacity: 0.45, pointerEvents: "none" }}>
      <path d="M-60 350 C100 180, 260 520, 420 320 C560 140, 680 480, 900 300" stroke="url(#wl1)" strokeWidth="2.5" fill="none" />
      <path d="M-60 390 C120 200, 300 560, 460 340 C590 160, 710 500, 900 320" stroke="url(#wl2)" strokeWidth="1.5" fill="none" />
      <path d="M-60 310 C80 140, 220 490, 390 290 C530 110, 660 460, 900 270" stroke="url(#wl3)" strokeWidth="1" fill="none" />
      <path d="M-60 430 C150 250, 330 570, 490 370 C620 200, 740 540, 900 360" stroke="url(#wl4)" strokeWidth="0.8" fill="none" />

      <path d="M-60 350 C100 180, 260 520, 420 320 C560 140, 680 480, 900 300 L900 360 C680 540, 560 200, 420 380 C260 580, 100 240, -60 410 Z"
        fill="url(#wlf)" opacity="0.12" />

      <defs>
        <linearGradient id="wl1" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="40%" stopColor="#a0a0b0" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#7c3aed" stopOpacity="0.2" />
        </linearGradient>
        <linearGradient id="wl2" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="50%" stopColor="#8080a0" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#6d28d9" stopOpacity="0.15" />
        </linearGradient>
        <linearGradient id="wl3" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="60%" stopColor="#606080" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#5b21b6" stopOpacity="0.1" />
        </linearGradient>
        <linearGradient id="wl4" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="70%" stopColor="#505070" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#4c1d95" stopOpacity="0.08" />
        </linearGradient>
        <linearGradient id="wlf" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="50%" stopColor="#9090b0" stopOpacity="1" />
          <stop offset="100%" stopColor="#7c3aed" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function WaveRight() {
  return (
    <svg viewBox="0 0 900 700" fill="none" xmlns="http://www.w3.org/2000/svg"
      style={{ position: "absolute", right: 0, top: "50%", transform: "translateY(-50%) scaleX(-1)", width: "48%", height: "auto", opacity: 0.55, pointerEvents: "none" }}>
      <path d="M-60 350 C100 180, 260 520, 420 320 C560 140, 680 480, 900 300" stroke="url(#wr1)" strokeWidth="2.5" fill="none" />
      <path d="M-60 390 C120 200, 300 560, 460 340 C590 160, 710 500, 900 320" stroke="url(#wr2)" strokeWidth="1.8" fill="none" />
      <path d="M-60 310 C80 140, 220 490, 390 290 C530 110, 660 460, 900 270" stroke="url(#wr3)" strokeWidth="1.2" fill="none" />
      <path d="M-60 430 C150 250, 330 570, 490 370 C620 200, 740 540, 900 360" stroke="url(#wr4)" strokeWidth="0.9" fill="none" />

      <path d="M-60 350 C100 180, 260 520, 420 320 C560 140, 680 480, 900 300 L900 360 C680 540, 560 200, 420 380 C260 580, 100 240, -60 410 Z"
        fill="url(#wrf)" opacity="0.14" />

      <defs>
        <linearGradient id="wr1" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#7c3aed" stopOpacity="0.2" />
          <stop offset="50%" stopColor="#a855f7" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#c084fc" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="wr2" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#6d28d9" stopOpacity="0.15" />
          <stop offset="50%" stopColor="#8b5cf6" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#a78bfa" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="wr3" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#5b21b6" stopOpacity="0.1" />
          <stop offset="60%" stopColor="##7c3aed" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="wr4" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#4c1d95" stopOpacity="0.08" />
          <stop offset="70%" stopColor="#6d28d9" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#7c3aed" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="wrf" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#7c3aed" stopOpacity="0" />
          <stop offset="50%" stopColor="#a855f7" stopOpacity="1" />
          <stop offset="100%" stopColor="#c084fc" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/* ── feature card ────────────────────────────────────────────────────── */
function FeatureCard({ icon, title, description, delay = 0 }: { icon: React.ReactNode; title: string; description: string; delay?: number }) {
  const [hovered, setHovered] = useState(false);
  return (
    <Reveal delay={delay}>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          background: hovered ? "rgba(124,58,237,0.08)" : "rgba(255,255,255,0.025)",
          border: `1px solid ${hovered ? "rgba(139,92,246,0.4)" : "rgba(255,255,255,0.07)"}`,
          borderRadius: 16,
          padding: "2rem",
          transition: "all 0.25s ease",
          cursor: "default",
        }}
      >
        <div style={{
          width: 44, height: 44,
          borderRadius: 12,
          border: "1px solid rgba(139,92,246,0.3)",
          background: "rgba(124,58,237,0.12)",
          display: "flex", alignItems: "center", justifyContent: "center",
          marginBottom: "1.25rem",
        }}>
          {icon}
        </div>
        <h3 style={{ fontFamily: "var(--font-display)", fontSize: "1.05rem", fontWeight: 600, marginBottom: "0.6rem", color: "#fff" }}>{title}</h3>
        <p style={{ fontSize: "0.875rem", color: "#777", lineHeight: 1.65 }}>{description}</p>
      </div>
    </Reveal>
  );
}

/* ── comparison row ──────────────────────────────────────────────────── */
function CompareRow({ left, right }: { left: string; right: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1px", background: "rgba(255,255,255,0.06)", borderRadius: 12, overflow: "hidden", marginBottom: "1px" }}>
      <div style={{ background: "#0a0a0e", padding: "1rem 1.25rem", display: "flex", alignItems: "center", gap: "0.6rem" }}>
        <span style={{ color: "#444", fontSize: "1rem" }}>✗</span>
        <span style={{ fontSize: "0.875rem", color: "#555" }}>{left}</span>
      </div>
      <div style={{ background: "#0d0914", padding: "1rem 1.25rem", display: "flex", alignItems: "center", gap: "0.6rem" }}>
        <span style={{ color: "#a855f7", fontSize: "1rem" }}>✓</span>
        <span style={{ fontSize: "0.875rem", color: "#ccc" }}>{right}</span>
      </div>
    </div>
  );
}

/* ── persona card ────────────────────────────────────────────────────── */
function PersonaCard({ icon, title, description, delay = 0 }: { icon: string; title: string; description: string; delay?: number }) {
  const [hovered, setHovered] = useState(false);
  return (
    <Reveal delay={delay}>
      <div
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          background: hovered ? "rgba(124,58,237,0.07)" : "rgba(255,255,255,0.02)",
          border: `1px solid ${hovered ? "rgba(139,92,246,0.35)" : "rgba(255,255,255,0.06)"}`,
          borderRadius: 16,
          padding: "2rem",
          transition: "all 0.25s ease",
        }}
      >
        <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>{icon}</div>
        <h3 style={{ fontFamily: "var(--font-display)", fontSize: "1.1rem", fontWeight: 700, marginBottom: "0.5rem", color: "#fff" }}>{title}</h3>
        <p style={{ fontSize: "0.875rem", color: "#666", lineHeight: 1.6 }}>{description}</p>
      </div>
    </Reveal>
  );
}

/* ── pricing card ────────────────────────────────────────────────────── */
function PricingCard({ plan, price, sub, features, highlight, cta, ctaAction, delay = 0 }: {
  plan: string; price: string; sub?: string; features: string[]; highlight?: boolean;
  cta: string; ctaAction: () => void; delay?: number;
}) {
  return (
    <Reveal delay={delay}>
      <div style={{
        background: highlight ? "linear-gradient(135deg, rgba(124,58,237,0.18), rgba(168,85,247,0.08))" : "rgba(255,255,255,0.025)",
        border: `1px solid ${highlight ? "rgba(139,92,246,0.55)" : "rgba(255,255,255,0.07)"}`,
        borderRadius: 20,
        padding: "2.25rem",
        display: "flex", flexDirection: "column", gap: "1.5rem",
        position: "relative",
        height: "100%",
      }}>
        {highlight && (
          <div style={{
            position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)",
            background: "linear-gradient(90deg, #7c3aed, #a855f7)",
            borderRadius: 999, padding: "4px 14px",
            fontSize: "0.72rem", fontWeight: 700, letterSpacing: 1, color: "#fff", whiteSpace: "nowrap",
          }}>
            MOST POPULAR
          </div>
        )}
        <div>
          <div style={{ fontSize: "0.75rem", fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase", color: "#666", marginBottom: "0.5rem" }}>{plan}</div>
          <div style={{ fontFamily: "var(--font-display)", fontSize: "2.6rem", fontWeight: 800, letterSpacing: "-1px", color: "#fff", lineHeight: 1 }}>
            {price}
            {sub && <span style={{ fontSize: "1rem", fontWeight: 400, color: "#555", marginLeft: 4 }}>{sub}</span>}
          </div>
        </div>
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.65rem" }}>
          {features.map((f, i) => (
            <li key={i} style={{ fontSize: "0.875rem", color: "#777", display: "flex", alignItems: "flex-start", gap: "0.6rem" }}>
              <span style={{ color: highlight ? "#a855f7" : "#555", flexShrink: 0, marginTop: 1 }}>→</span>
              {f}
            </li>
          ))}
        </ul>
        <button
          onClick={ctaAction}
          style={{
            marginTop: "auto",
            padding: "0.75rem 1.5rem",
            borderRadius: 999,
            border: highlight ? "none" : "1px solid rgba(255,255,255,0.15)",
            background: highlight ? "linear-gradient(90deg, #7c3aed, #a855f7)" : "transparent",
            color: "#fff",
            fontSize: "0.875rem",
            fontWeight: 600,
            cursor: "pointer",
            fontFamily: "var(--font-sans)",
            transition: "opacity 0.2s",
          }}
          onMouseEnter={e => (e.currentTarget.style.opacity = "0.85")}
          onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
        >
          {cta}
        </button>
      </div>
    </Reveal>
  );
}

/* ── main landing page ───────────────────────────────────────────────── */
export default function LandingPage() {
  const signIn = () => { window.location.href = "/api/auth/google/connect"; };

  return (
    <div style={{
      minHeight: "100vh",
      background: "#060608",
      color: "#fff",
      fontFamily: "var(--font-sans)",
      overflowX: "hidden",
      WebkitFontSmoothing: "antialiased",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=Space+Grotesk:wght@400;500;600;700;800&display=swap');
        :root {
          --bg: #060608;
          --font-sans: 'Inter', sans-serif;
          --font-display: 'Space Grotesk', sans-serif;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        a { text-decoration: none; color: inherit; }
        @keyframes pulse-dot { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.6;transform:scale(0.8)} }
        @keyframes float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }
        @keyframes shimmer { 0%{background-position:-200% center} 100%{background-position:200% center} }
        @keyframes slideUp { from{opacity:0;transform:translateY(20px)} to{opacity:1;transform:translateY(0)} }
      `}</style>

      {/* ── NAV ─────────────────────────────────────────────────────── */}
      <nav style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 50,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 3rem", height: 62,
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(6,6,8,0.82)",
        backdropFilter: "blur(18px)",
        WebkitBackdropFilter: "blur(18px)",
      }}>
        <a href="/" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: "50%", background: "linear-gradient(135deg,#7c3aed,#c084fc)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/></svg>
          </div>
          <span style={{ fontFamily: "var(--font-display)", fontSize: "1.1rem", fontWeight: 700, letterSpacing: "-0.3px" }}>
            SnapServe <span style={{ color: "#555", fontWeight: 400 }}>AI</span>
          </span>
        </a>

        <div style={{ display: "flex", gap: "2.5rem", alignItems: "center" }}>
          {["Features", "How it works", "Pricing"].map(l => (
            <a key={l} href={`#${l.toLowerCase().replace(/ /g, "-")}`}
              style={{ fontSize: "0.875rem", color: "#666", transition: "color 0.2s" }}
              onMouseEnter={e => (e.currentTarget.style.color = "#fff")}
              onMouseLeave={e => (e.currentTarget.style.color = "#666")}
            >{l}</a>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <button onClick={signIn}
            style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: "0.875rem", color: "#666", fontFamily: "var(--font-sans)", transition: "color 0.2s" }}
            onMouseEnter={e => (e.currentTarget.style.color = "#fff")}
            onMouseLeave={e => (e.currentTarget.style.color = "#666")}
          >Sign in</button>
          <button onClick={signIn} style={{
            background: "linear-gradient(90deg,#7c3aed,#a855f7)",
            border: "none", cursor: "pointer",
            padding: "0.5rem 1.25rem", borderRadius: 999,
            fontSize: "0.875rem", fontWeight: 600, color: "#fff",
            fontFamily: "var(--font-sans)",
            transition: "opacity 0.2s, box-shadow 0.2s",
            boxShadow: "0 0 18px rgba(124,58,237,0.35)",
          }}
            onMouseEnter={e => { e.currentTarget.style.opacity = "0.9"; e.currentTarget.style.boxShadow = "0 0 26px rgba(124,58,237,0.55)"; }}
            onMouseLeave={e => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.boxShadow = "0 0 18px rgba(124,58,237,0.35)"; }}
          >Get started →</button>
        </div>
      </nav>

      {/* ── HERO ────────────────────────────────────────────────────── */}
      <section style={{ position: "relative", minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", overflow: "hidden", paddingTop: 62 }}>
        {/* Background radial glow */}
        <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse 70% 55% at 50% 50%, rgba(124,58,237,0.12) 0%, transparent 70%)", pointerEvents: "none" }} />

        <WaveLeft />
        <WaveRight />

        {/* Orb */}
        <div style={{ position: "relative", width: "min(480px, 90vw)", height: "min(480px, 90vw)", animation: "float 6s ease-in-out infinite", zIndex: 2 }}>
          <HeroOrb className="w-full h-full" />
        </div>

        {/* Headline below orb */}
        <div style={{ textAlign: "center", maxWidth: 720, padding: "0 1.5rem", zIndex: 2, marginTop: "1.5rem", animation: "slideUp 0.8s ease 0.2s both" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(124,58,237,0.12)", border: "1px solid rgba(139,92,246,0.25)", borderRadius: 999, padding: "6px 16px", fontSize: "0.78rem", color: "#a855f7", marginBottom: "1.5rem" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#a855f7", boxShadow: "0 0 8px #a855f7", animation: "pulse-dot 2s infinite", display: "inline-block" }} />
            Beta · Now live · $5 free credits
          </div>

          <h1 style={{
            fontFamily: "var(--font-display)",
            fontSize: "clamp(2.8rem, 6.5vw, 5.5rem)",
            fontWeight: 800,
            lineHeight: 1.06,
            letterSpacing: "-2.5px",
            marginBottom: "1.25rem",
          }}>
            Voice Agents<br />
            <span style={{
              background: "linear-gradient(90deg, #8b5cf6, #c084fc, #a855f7)",
              backgroundSize: "200% auto",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              animation: "shimmer 4s linear infinite",
            }}>That Remember</span>
          </h1>

          <p style={{ fontSize: "clamp(1rem,1.8vw,1.2rem)", color: "#666", lineHeight: 1.65, maxWidth: 540, margin: "0 auto 2rem" }}>
            Every call gets smarter. Give your AI voice agents persistent relationship memory — so they pick up exactly where they left off, every time.
          </p>

          <div style={{ display: "flex", gap: "1rem", justifyContent: "center", flexWrap: "wrap" }}>
            <button onClick={signIn} style={{
              background: "linear-gradient(90deg,#7c3aed,#a855f7)",
              border: "none", cursor: "pointer",
              padding: "0.85rem 2rem", borderRadius: 999,
              fontSize: "1rem", fontWeight: 600, color: "#fff",
              fontFamily: "var(--font-sans)",
              boxShadow: "0 0 28px rgba(124,58,237,0.4)",
              transition: "all 0.2s",
            }}
              onMouseEnter={e => { e.currentTarget.style.boxShadow = "0 0 40px rgba(124,58,237,0.6)"; e.currentTarget.style.transform = "translateY(-1px)"; }}
              onMouseLeave={e => { e.currentTarget.style.boxShadow = "0 0 28px rgba(124,58,237,0.4)"; e.currentTarget.style.transform = "translateY(0)"; }}
            >Start Free →</button>
            <a href="mailto:sales@snapserve.ai" style={{
              padding: "0.85rem 2rem", borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.12)",
              fontSize: "1rem", fontWeight: 500, color: "#aaa",
              transition: "all 0.2s",
              display: "inline-flex", alignItems: "center",
            }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(139,92,246,0.4)"; e.currentTarget.style.color = "#fff"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)"; e.currentTarget.style.color = "#aaa"; }}
            >Book Demo</a>
          </div>
          <p style={{ fontSize: "0.78rem", color: "#333", marginTop: "1rem" }}>No credit card required · $5 Free Credits · Bring Your Own API Keys</p>
        </div>

        {/* Scroll hint */}
        <div style={{ position: "absolute", bottom: "2rem", left: "50%", transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 6, opacity: 0.3 }}>
          <span style={{ fontSize: "0.7rem", letterSpacing: 2, textTransform: "uppercase", color: "#666" }}>Scroll</span>
          <div style={{ width: 1, height: 40, background: "linear-gradient(to bottom, #666, transparent)" }} />
        </div>
      </section>

      {/* ── PROBLEM ─────────────────────────────────────────────────── */}
      <section id="problem" style={{ padding: "8rem 2rem", maxWidth: 900, margin: "0 auto" }}>
        <Reveal>
          <p style={{ fontSize: "0.72rem", fontWeight: 700, letterSpacing: "3px", textTransform: "uppercase", color: "#7c3aed", marginBottom: "1.5rem" }}>The Problem</p>
        </Reveal>
        <Reveal delay={80}>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(2rem,4.5vw,3.5rem)", fontWeight: 800, lineHeight: 1.1, letterSpacing: "-1.5px", marginBottom: "2.5rem" }}>
            Voice AI Can Talk.<br />
            <span style={{ color: "#333" }}>It Can't Remember.</span>
          </h2>
        </Reveal>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "1.5rem" }}>
          {[
            { label: "Today's platforms can answer calls.", accent: false },
            { label: "They can make calls.", accent: false },
            { label: "They can sound human.", accent: false },
            { label: "But when the same person answers next week,\nthe conversation starts from zero.", accent: true },
          ].map((item, i) => (
            <Reveal key={i} delay={i * 60}>
              <div style={{
                background: item.accent ? "rgba(124,58,237,0.06)" : "rgba(255,255,255,0.02)",
                border: `1px solid ${item.accent ? "rgba(124,58,237,0.2)" : "rgba(255,255,255,0.05)"}`,
                borderRadius: 14,
                padding: "1.5rem",
              }}>
                <p style={{ fontSize: "1rem", color: item.accent ? "#c084fc" : "#555", lineHeight: 1.6, whiteSpace: "pre-line" }}>{item.label}</p>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={300}>
          <div style={{ marginTop: "3rem", borderLeft: "2px solid rgba(124,58,237,0.4)", paddingLeft: "1.5rem" }}>
            <p style={{ fontSize: "1.15rem", color: "#777", lineHeight: 1.7, fontStyle: "italic" }}>
              "Real businesses don't work like that.<br />Real relationships don't work like that."
            </p>
          </div>
        </Reveal>
      </section>

      {/* ── MEMORY DEMO ─────────────────────────────────────────────── */}
      <section style={{ padding: "6rem 2rem", background: "rgba(124,58,237,0.04)", borderTop: "1px solid rgba(124,58,237,0.1)", borderBottom: "1px solid rgba(124,58,237,0.1)" }}>
        <div style={{ maxWidth: 1000, margin: "0 auto" }}>
          <Reveal>
            <p style={{ fontSize: "0.72rem", fontWeight: 700, letterSpacing: "3px", textTransform: "uppercase", color: "#7c3aed", marginBottom: "1rem", textAlign: "center" }}>Relationship Memory™</p>
          </Reveal>
          <Reveal delay={80}>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(1.8rem,3.5vw,2.8rem)", fontWeight: 800, letterSpacing: "-1px", marginBottom: "0.75rem", textAlign: "center" }}>The Memory Layer For AI Voice Agents</h2>
          </Reveal>
          <Reveal delay={120}>
            <p style={{ fontSize: "1rem", color: "#555", textAlign: "center", maxWidth: 520, margin: "0 auto 4rem" }}>When a caller shares anything — plans, preferences, objections, timing — your agent stores it and uses it next time.</p>
          </Reveal>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px", borderRadius: 20, overflow: "hidden" }}>
            {/* WITHOUT */}
            <Reveal delay={160}>
              <div style={{ background: "rgba(10,10,14,0.9)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "20px 0 0 20px", padding: "2rem", height: "100%" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "1.5rem" }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444" }} />
                  <span style={{ fontSize: "0.72rem", fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: "#444" }}>Without SnapServe</span>
                </div>
                {[
                  { call: "Call #1", ai: "Would you like to learn more about our product?", caller: "I'm busy. Call me next Tuesday.", isAI: false },
                  { call: "Call #2", ai: "Hi, would you like to learn more about our product?", caller: "Who are you?", isAI: false },
                ].map((c, i) => (
                  <div key={i} style={{ marginBottom: "1.5rem" }}>
                    <div style={{ fontSize: "0.72rem", fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", color: "#333", marginBottom: "0.75rem" }}>{c.call}</div>
                    <div style={{ background: "rgba(255,255,255,0.04)", borderRadius: 10, padding: "0.75rem 1rem", marginBottom: 6 }}>
                      <span style={{ fontSize: "0.72rem", color: "#555", display: "block", marginBottom: 4 }}>AI</span>
                      <span style={{ fontSize: "0.875rem", color: "#666" }}>{c.ai}</span>
                    </div>
                    <div style={{ background: "rgba(255,255,255,0.02)", borderRadius: 10, padding: "0.75rem 1rem" }}>
                      <span style={{ fontSize: "0.72rem", color: "#555", display: "block", marginBottom: 4 }}>Caller</span>
                      <span style={{ fontSize: "0.875rem", color: "#555" }}>{c.caller}</span>
                    </div>
                    {i === 0 && <div style={{ marginTop: 8, padding: "0.5rem 0.75rem", background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.12)", borderRadius: 8 }}>
                      <span style={{ fontSize: "0.78rem", color: "#ef4444" }}>✗ Context lost. Conversation reset.</span>
                    </div>}
                  </div>
                ))}
              </div>
            </Reveal>

            {/* WITH */}
            <Reveal delay={220}>
              <div style={{ background: "linear-gradient(135deg, rgba(124,58,237,0.1), rgba(168,85,247,0.05))", border: "1px solid rgba(139,92,246,0.25)", borderRadius: "0 20px 20px 0", padding: "2rem", height: "100%" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "1.5rem" }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#a855f7", boxShadow: "0 0 8px #a855f7" }} />
                  <span style={{ fontSize: "0.72rem", fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: "#a855f7" }}>With SnapServe</span>
                </div>
                <div style={{ marginBottom: "1.5rem" }}>
                  <div style={{ fontSize: "0.72rem", fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", color: "#6d28d9", marginBottom: "0.75rem" }}>Call #1</div>
                  <div style={{ background: "rgba(124,58,237,0.1)", borderRadius: 10, padding: "0.75rem 1rem", marginBottom: 6 }}>
                    <span style={{ fontSize: "0.72rem", color: "#7c3aed", display: "block", marginBottom: 4 }}>AI</span>
                    <span style={{ fontSize: "0.875rem", color: "#888" }}>Would you like to learn more about our product?</span>
                  </div>
                  <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "0.75rem 1rem", marginBottom: 8 }}>
                    <span style={{ fontSize: "0.72rem", color: "#666", display: "block", marginBottom: 4 }}>Caller</span>
                    <span style={{ fontSize: "0.875rem", color: "#bbb" }}>I'm busy. Call me next Tuesday. I'm interested in your Enterprise package.</span>
                  </div>
                  <div style={{ padding: "0.5rem 0.75rem", background: "rgba(124,58,237,0.12)", border: "1px solid rgba(139,92,246,0.25)", borderRadius: 8 }}>
                    <span style={{ fontSize: "0.78rem", color: "#a855f7" }}>✓ Memory stored automatically.</span>
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: "0.72rem", fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", color: "#6d28d9", marginBottom: "0.75rem" }}>Call #2</div>
                  <div style={{ background: "rgba(124,58,237,0.12)", border: "1px solid rgba(139,92,246,0.2)", borderRadius: 10, padding: "0.75rem 1rem", marginBottom: 6 }}>
                    <span style={{ fontSize: "0.72rem", color: "#7c3aed", display: "block", marginBottom: 4 }}>AI</span>
                    <span style={{ fontSize: "0.875rem", color: "#ddd", lineHeight: 1.6 }}>
                      "Hi John. Last week you asked me to call back today regarding the Enterprise package. Is now a good time to continue our conversation?"
                    </span>
                  </div>
                  <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "0.75rem 1rem", marginBottom: 8 }}>
                    <span style={{ fontSize: "0.72rem", color: "#666", display: "block", marginBottom: 4 }}>Caller</span>
                    <span style={{ fontSize: "0.875rem", color: "#aaa" }}>Yes.</span>
                  </div>
                  <div style={{ padding: "0.5rem 0.75rem", background: "rgba(124,58,237,0.15)", border: "1px solid rgba(168,85,247,0.35)", borderRadius: 8 }}>
                    <span style={{ fontSize: "0.78rem", color: "#c084fc", fontWeight: 600 }}>✓ The conversation continues — not restarts.</span>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── FEATURES ────────────────────────────────────────────────── */}
      <section id="features" style={{ padding: "8rem 2rem", maxWidth: 1100, margin: "0 auto" }}>
        <Reveal>
          <p style={{ fontSize: "0.72rem", fontWeight: 700, letterSpacing: "3px", textTransform: "uppercase", color: "#7c3aed", marginBottom: "0.75rem" }}>Platform</p>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(1.8rem,3.5vw,2.8rem)", fontWeight: 800, letterSpacing: "-1px", marginBottom: "0.75rem" }}>Everything You Need To Deploy Voice AI</h2>
          <p style={{ fontSize: "1rem", color: "#555", marginBottom: "3.5rem", maxWidth: 480 }}>More than memory — a complete orchestration platform for production voice agents.</p>
        </Reveal>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "1rem" }}>
          <FeatureCard delay={0} icon={<svg viewBox="0 0 24 24" width="20" height="20" stroke="#a855f7" fill="none" strokeWidth="1.8"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>}
            title="Real-Time Voice Orchestration"
            description="Connect OpenAI, Deepgram, ElevenLabs, Gemini, Sarvam, Twilio and more. Build custom voice pipelines in minutes. Sub-100ms end-to-end latency."
          />
          <FeatureCard delay={60} icon={<svg viewBox="0 0 24 24" width="20" height="20" stroke="#a855f7" fill="none" strokeWidth="1.8"><path d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2z"/><path d="M12 8v4l3 3"/></svg>}
            title="Relationship Memory™"
            description="Agents remember every caller across sessions. Callback requests, preferences, objections, booking history — all retrieved automatically on the next call."
          />
          <FeatureCard delay={120} icon={<svg viewBox="0 0 24 24" width="20" height="20" stroke="#a855f7" fill="none" strokeWidth="1.8"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.13 11.8a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.04 1h3a2 2 0 0 1 2 1.72"/></svg>}
            title="Outbound Campaigns"
            description="Upload leads. Schedule calls. Track dispositions. Automate follow-ups. CRM webhook delivery on every call completion."
          />
          <FeatureCard delay={0} icon={<svg viewBox="0 0 24 24" width="20" height="20" stroke="#a855f7" fill="none" strokeWidth="1.8"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>}
            title="Smart Scheduling"
            description="Built-in booking engine with availability windows, timezone awareness, and Google Calendar sync. No third-party scheduler needed."
          />
          <FeatureCard delay={60} icon={<svg viewBox="0 0 24 24" width="20" height="20" stroke="#a855f7" fill="none" strokeWidth="1.8"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>}
            title="Knowledge Base"
            description="Give agents access to documents, FAQs, and company knowledge during live conversations. Full-text search over attached content in real time."
          />
          <FeatureCard delay={120} icon={<svg viewBox="0 0 24 24" width="20" height="20" stroke="#a855f7" fill="none" strokeWidth="1.8"><path d="M3 3h18v18H3zM3 9h18M9 21V9"/></svg>}
            title="Live Call Monitoring"
            description="Watch active calls in real time. Inspect transcript, sentiment, and pipeline state from the dashboard without interrupting the agent."
          />
          <FeatureCard delay={0} icon={<svg viewBox="0 0 24 24" width="20" height="20" stroke="#a855f7" fill="none" strokeWidth="1.8"><path d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2z"/><path d="M12 8v4l2 2"/></svg>}
            title="Web Voice Widget"
            description="Add voice AI to any website using a single script tag. Floating widget with real-time waveform and transcript. No phone number needed."
          />
          <FeatureCard delay={60} icon={<svg viewBox="0 0 24 24" width="20" height="20" stroke="#a855f7" fill="none" strokeWidth="1.8"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>}
            title="Bring Your Own Keys"
            description="Your providers, your API keys, your costs. No vendor lock-in. No forced model choices. Connect any combination of ASR, LLM, TTS and telephony providers."
          />
          <FeatureCard delay={120} icon={<svg viewBox="0 0 24 24" width="20" height="20" stroke="#a855f7" fill="none" strokeWidth="1.8"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7M11 18H8a2 2 0 0 1-2-2V9"/></svg>}
            title="Webhooks & CRM Integration"
            description="Deliver call outcomes, bookings, and transcripts to any CRM or tool via webhooks. Built for Zapier, HubSpot, Salesforce, and custom pipelines."
          />
        </div>
      </section>

      {/* ── PROVIDERS ───────────────────────────────────────────────── */}
      <section style={{ padding: "6rem 2rem", borderTop: "1px solid rgba(255,255,255,0.05)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <Reveal>
            <p style={{ fontSize: "0.72rem", fontWeight: 700, letterSpacing: "3px", textTransform: "uppercase", color: "#7c3aed", textAlign: "center", marginBottom: "0.75rem" }}>Providers</p>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(1.8rem,3.5vw,2.6rem)", fontWeight: 800, letterSpacing: "-1px", textAlign: "center", marginBottom: "0.75rem" }}>Your providers. Your keys. Your control.</h2>
            <p style={{ fontSize: "1rem", color: "#555", textAlign: "center", marginBottom: "3.5rem" }}>No vendor lock-in. No forced model choices. Connect any combination.</p>
          </Reveal>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "0.75rem" }}>
            {[
              { name: "OpenAI", category: "LLM / TTS" },
              { name: "Anthropic", category: "LLM" },
              { name: "Google Gemini", category: "LLM" },
              { name: "DeepSeek", category: "LLM" },
              { name: "Mistral AI", category: "LLM" },
              { name: "Sarvam", category: "ASR / LLM / TTS" },
              { name: "Deepgram", category: "ASR / TTS" },
              { name: "ElevenLabs", category: "TTS" },
              { name: "Cartesia", category: "TTS" },
              { name: "Azure", category: "ASR / TTS" },
              { name: "Twilio", category: "Telephony" },
              { name: "Plivo", category: "Telephony" },
              { name: "Vobiz", category: "Telephony" },
              { name: "AssemblyAI", category: "ASR" },
              { name: "Cohere", category: "LLM" },
            ].map((p, i) => (
              <Reveal key={p.name} delay={i * 30}>
                <div style={{
                  background: "rgba(255,255,255,0.025)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 12,
                  padding: "0.85rem 1rem",
                  transition: "all 0.2s",
                }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(139,92,246,0.3)"; (e.currentTarget as HTMLElement).style.background = "rgba(124,58,237,0.07)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.06)"; (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.025)"; }}
                >
                  <div style={{ fontSize: "0.875rem", fontWeight: 600, color: "#ccc", marginBottom: 2 }}>{p.name}</div>
                  <div style={{ fontSize: "0.7rem", color: "#444" }}>{p.category}</div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── BUILT FOR ───────────────────────────────────────────────── */}
      <section style={{ padding: "8rem 2rem", maxWidth: 1000, margin: "0 auto" }}>
        <Reveal>
          <p style={{ fontSize: "0.72rem", fontWeight: 700, letterSpacing: "3px", textTransform: "uppercase", color: "#7c3aed", marginBottom: "0.75rem" }}>Built For</p>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(1.8rem,3.5vw,2.6rem)", fontWeight: 800, letterSpacing: "-1px", marginBottom: "3.5rem" }}>Who uses SnapServe</h2>
        </Reveal>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem" }}>
          <PersonaCard delay={0} icon="🏢" title="AI Agencies" description="Deploy voice agents for multiple clients from one platform. White-label ready. Full multi-tenant isolation." />
          <PersonaCard delay={80} icon="⚡" title="Developers" description="Skip months of infrastructure work. Launch production-ready voice AI in an afternoon, not months." />
          <PersonaCard delay={160} icon="🚀" title="SaaS Founders" description="Add voice capabilities to your product without building the backend. API-first, embed anywhere." />
          <PersonaCard delay={240} icon="🏗️" title="Enterprises" description="Scale thousands of conversations while maintaining full context across every customer interaction." />
        </div>
      </section>

      {/* ── WHY SNAPSERVE ───────────────────────────────────────────── */}
      <section id="how-it-works" style={{ padding: "6rem 2rem", background: "rgba(255,255,255,0.015)", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <Reveal>
            <p style={{ fontSize: "0.72rem", fontWeight: 700, letterSpacing: "3px", textTransform: "uppercase", color: "#7c3aed", marginBottom: "0.75rem" }}>Why SnapServe</p>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(1.8rem,3.5vw,2.6rem)", fontWeight: 800, letterSpacing: "-1px", marginBottom: "0.75rem" }}>Most platforms help you make calls.<br/>SnapServe helps you build relationships.</h2>
            <p style={{ fontSize: "1rem", color: "#555", marginBottom: "3rem", maxWidth: 480 }}>The difference between a voice tool and a voice platform.</p>
          </Reveal>

          <div style={{ borderRadius: 16, overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", background: "rgba(255,255,255,0.04)", borderRadius: "14px 14px 0 0", overflow: "hidden" }}>
              <div style={{ padding: "0.75rem 1.25rem", fontSize: "0.72rem", fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: "#444" }}>Other platforms</div>
              <div style={{ padding: "0.75rem 1.25rem", fontSize: "0.72rem", fontWeight: 700, letterSpacing: 2, textTransform: "uppercase", color: "#a855f7", background: "rgba(124,58,237,0.08)" }}>SnapServe</div>
            </div>
            {[
              ["Orchestrate conversations", "Remember them"],
              ["Handle voice", "Handle continuity"],
              ["Start every call from zero", "Continue from exactly where you left off"],
              ["Lock you into one provider", "Let you mix any provider freely"],
              ["Charge for bundled models", "Charge orchestration only — your keys, your costs"],
              ["One conversation at a time", "Persistent relationship across every call"],
            ].map(([l, r], i) => (
              <Reveal key={i} delay={i * 40}>
                <CompareRow left={l} right={r} />
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── PRICING ─────────────────────────────────────────────────── */}
      <section id="pricing" style={{ padding: "8rem 2rem", maxWidth: 1000, margin: "0 auto" }}>
        <Reveal>
          <p style={{ fontSize: "0.72rem", fontWeight: 700, letterSpacing: "3px", textTransform: "uppercase", color: "#7c3aed", marginBottom: "0.75rem" }}>Pricing</p>
          <h2 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(2rem,4vw,3rem)", fontWeight: 800, letterSpacing: "-1.5px", marginBottom: "0.75rem" }}>Pay per minute.<br/>No surprises.</h2>
          <p style={{ fontSize: "1rem", color: "#555", marginBottom: "3.5rem" }}>You pay providers directly. SnapServe only charges for orchestration and memory.</p>
        </Reveal>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1.25rem", alignItems: "start" }}>
          <PricingCard
            delay={0}
            plan="Developer"
            price="$0.08"
            sub="/ min"
            cta="Start free"
            ctaAction={signIn}
            features={[
              "All provider integrations",
              "Persistent caller memory",
              "Outbound campaigns",
              "Standard models",
              "Email support",
              "$5 free credit to start",
            ]}
          />
          <PricingCard
            delay={100}
            plan="Production"
            price="$0.12"
            sub="/ min"
            highlight
            cta="Get started"
            ctaAction={signIn}
            features={[
              "Everything in Developer",
              "Ultra-low latency pipeline",
              "Zero-shot prompt engine",
              "Smart SIP escalation",
              "Up to 500 concurrent calls",
              "Priority support",
            ]}
          />
          <PricingCard
            delay={200}
            plan="Enterprise"
            price="Custom"
            cta="Contact sales"
            ctaAction={() => { window.location.href = "mailto:sales@snapserve.ai"; }}
            features={[
              "Dedicated infrastructure",
              "Custom model fine-tuning",
              "Unlimited concurrency",
              "HIPAA & SOC2 compliance",
              "24/7 Slack Connect support",
              "SLA guarantees",
            ]}
          />
        </div>

        <Reveal delay={300}>
          <p style={{ textAlign: "center", fontSize: "0.8rem", color: "#333", marginTop: "2rem" }}>All plans include $5 free credit · No card required to start · Top up via Razorpay</p>
        </Reveal>
      </section>

      {/* ── FINAL CTA ───────────────────────────────────────────────── */}
      <section style={{ padding: "8rem 2rem", position: "relative", overflow: "hidden", textAlign: "center" }}>
        <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse 60% 70% at 50% 50%, rgba(124,58,237,0.14) 0%, transparent 70%)", pointerEvents: "none" }} />
        <div style={{ position: "relative", zIndex: 1, maxWidth: 680, margin: "0 auto" }}>
          <Reveal>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: "clamp(2rem,5vw,4rem)", fontWeight: 800, lineHeight: 1.1, letterSpacing: "-2px", marginBottom: "1.5rem" }}>
              Build Voice Agents<br />
              <span style={{ background: "linear-gradient(90deg, #8b5cf6, #c084fc)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                That Never Forget
              </span>
            </h2>
          </Reveal>
          <Reveal delay={80}>
            <p style={{ fontSize: "1.1rem", color: "#555", lineHeight: 1.65, marginBottom: "2.5rem" }}>
              Stop rebuilding context. Stop losing conversations.<br />
              Stop treating every call like the first call.
            </p>
          </Reveal>
          <Reveal delay={160}>
            <button onClick={signIn} style={{
              background: "linear-gradient(90deg,#7c3aed,#a855f7)",
              border: "none", cursor: "pointer",
              padding: "1rem 2.5rem", borderRadius: 999,
              fontSize: "1.1rem", fontWeight: 700, color: "#fff",
              fontFamily: "var(--font-sans)",
              boxShadow: "0 0 36px rgba(124,58,237,0.45)",
              transition: "all 0.2s",
            }}
              onMouseEnter={e => { e.currentTarget.style.boxShadow = "0 0 52px rgba(124,58,237,0.65)"; e.currentTarget.style.transform = "translateY(-2px)"; }}
              onMouseLeave={e => { e.currentTarget.style.boxShadow = "0 0 36px rgba(124,58,237,0.45)"; e.currentTarget.style.transform = "translateY(0)"; }}
            >Start Free Today →</button>
          </Reveal>
        </div>
      </section>

      {/* ── FOOTER ──────────────────────────────────────────────────── */}
      <footer style={{ borderTop: "1px solid rgba(255,255,255,0.05)", padding: "3rem 3rem", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 22, height: 22, borderRadius: "50%", background: "linear-gradient(135deg,#7c3aed,#c084fc)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/></svg>
          </div>
          <span style={{ fontFamily: "var(--font-display)", fontSize: "0.95rem", fontWeight: 700, color: "#555" }}>SnapServe AI</span>
          <span style={{ fontSize: "0.8rem", color: "#2a2a2a", marginLeft: 8 }}>© 2026 SnapServe Inc.</span>
        </div>
        <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
          {[["Privacy", "/privacy"], ["Terms", "/terms"], ["Docs", "/"], ["Status", "/"], ["Contact", "mailto:sales@snapserve.ai"]].map(([label, href]) => (
            <a key={label} href={href} style={{ fontSize: "0.825rem", color: "#2a2a2a", transition: "color 0.2s" }}
              onMouseEnter={e => (e.currentTarget.style.color = "#666")}
              onMouseLeave={e => (e.currentTarget.style.color = "#2a2a2a")}
            >{label}</a>
          ))}
        </div>
      </footer>
    </div>
  );
}
