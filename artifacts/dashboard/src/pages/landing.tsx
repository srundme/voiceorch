import { Link } from "wouter";
import { SnapServeIcon } from "@/components/logo";
import { ArrowRight, Check } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/* ── Feature card ────────────────────────────────────────────────────────── */
function FCard({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div
      className="p-8 transition-colors duration-200"
      style={{ background: "#111", borderRight: "1px solid rgba(255,255,255,0.07)" }}
      onMouseEnter={e => ((e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.03)")}
      onMouseLeave={e => ((e.currentTarget as HTMLElement).style.background = "#111")}
    >
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center mb-6"
        style={{ border: "1px solid rgba(255,255,255,0.12)" }}
      >
        {icon}
      </div>
      <h3 className="text-[15px] font-semibold text-white mb-2">{title}</h3>
      <p className="text-[13px] leading-relaxed" style={{ color: "#666" }}>{body}</p>
    </div>
  );
}

/* ── Pricing card ────────────────────────────────────────────────────────── */
function PCard({
  plan, price, per, items, cta, featured,
}: {
  plan: string; price: string; per: string;
  items: string[]; cta: string; featured?: boolean;
}) {
  return (
    <div
      className="flex flex-col gap-6 p-8 rounded-2xl"
      style={{
        background: featured ? "rgba(255,255,255,0.03)" : "#0d0d0d",
        border: `1px solid ${featured ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.08)"}`,
      }}
    >
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] mb-4" style={{ color: "#555" }}>{plan}</p>
        <div className="flex items-end gap-1.5 mb-1">
          <span className="text-[44px] font-black leading-none text-white">{price}</span>
          {per && <span className="text-[13px] mb-2" style={{ color: "#555" }}>{per}</span>}
        </div>
      </div>
      <div className="h-px" style={{ background: "rgba(255,255,255,0.06)" }} />
      <ul className="flex flex-col gap-3 flex-1">
        {items.map(item => (
          <li key={item} className="flex items-center gap-3 text-[13px]" style={{ color: "#666" }}>
            <Check className="h-3.5 w-3.5 shrink-0" style={{ color: "#555" }} />
            {item}
          </li>
        ))}
      </ul>
      <Link href={`${BASE}/sign-up`}>
        <button
          className={`w-full py-3 rounded-full text-[13px] font-bold transition-all duration-200 ${
            featured
              ? "bg-white text-black hover:bg-white/90"
              : "text-zinc-500 hover:text-zinc-300"
          }`}
          style={!featured ? { border: "1px solid rgba(255,255,255,0.1)" } : undefined}
        >
          {cta}
        </button>
      </Link>
    </div>
  );
}

/* ── Main ────────────────────────────────────────────────────────────────── */
export default function LandingPage() {
  return (
    <div className="min-h-screen text-white antialiased overflow-x-hidden" style={{ background: "#080808" }}>
      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.3} }
        .badge-dot { animation: blink 2.5s ease-in-out infinite; }
        .features-grid > div:last-child { border-right: none !important; }
        @media (max-width: 768px) {
          .features-grid { grid-template-columns: 1fr !important; }
          .features-grid > div { border-right: none !important; border-bottom: 1px solid rgba(255,255,255,0.07); }
          .features-grid > div:last-child { border-bottom: none !important; }
          .pricing-grid { grid-template-columns: 1fr !important; }
          .how-grid { grid-template-columns: 1fr !important; }
          .nav-center-links { display: none !important; }
        }
      `}</style>

      {/* ── Nav ── */}
      <header
        className="fixed top-0 inset-x-0 z-50 flex items-center justify-between px-8 h-[60px]"
        style={{
          background: "rgba(8,8,8,0.88)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
        }}
      >
        <Link href={`${BASE}/`}>
          <span className="inline-flex items-center gap-2.5 cursor-pointer">
            <SnapServeIcon size={20} className="text-white shrink-0" />
            <span className="text-[15px] leading-none select-none"
              style={{ fontFamily: "'Tex Gyre Heros', Helvetica, Arial, sans-serif", letterSpacing: "-0.01em" }}>
              <span style={{ fontWeight: 700 }}>Snap</span><span style={{ fontWeight: 400, color: "#666" }}>Serve</span>
            </span>
          </span>
        </Link>

        <nav className="nav-center-links flex items-center gap-8">
          {[["Features", "#features"], ["How it works", "#how"], ["Pricing", "#pricing"]].map(([l, h]) => (
            <a
              key={l} href={h}
              className="text-[13px] transition-colors duration-150"
              style={{ color: "#666" }}
              onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = "#fff")}
              onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = "#666")}
            >{l}</a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <Link href={`${BASE}/sign-in`}>
            <button
              className="text-[13px] transition-colors duration-150"
              style={{ color: "#666" }}
              onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = "#fff")}
              onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = "#666")}
            >Sign in</button>
          </Link>
          <Link href={`${BASE}/sign-up`}>
            <button className="inline-flex items-center gap-1.5 bg-white text-black text-[13px] font-bold px-4 py-1.5 rounded-full transition-all hover:opacity-90">
              Get started <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </Link>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="min-h-screen flex flex-col justify-center px-8 md:px-14 pt-20 pb-16 max-w-4xl">
        <div
          className="inline-flex items-center gap-2 w-fit px-3.5 py-1.5 rounded-full text-[12px] mb-9"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)", color: "#666" }}
        >
          <span
            className="badge-dot w-1.5 h-1.5 rounded-full"
            style={{ background: "#fff", boxShadow: "0 0 7px rgba(255,255,255,0.5)" }}
          />
          Beta · Now live
        </div>

        <h1
          className="font-black leading-[1.0] mb-7"
          style={{ fontSize: "clamp(3.5rem, 8.5vw, 7.5rem)", letterSpacing: "-0.04em" }}
        >
          Voice agents<br />
          <span style={{ color: "#2e2e2e" }}>that never</span><br />
          forget.
        </h1>

        <p className="text-[16px] leading-[1.75] mb-10 max-w-[480px]" style={{ color: "#555" }}>
          Build AI voice agents with persistent caller memory,
          real-time pipeline orchestration, and complete
          provider freedom. Ship in minutes, not months.
        </p>

        <div className="flex flex-wrap items-center gap-3 mb-4">
          <Link href={`${BASE}/sign-up`}>
            <button className="inline-flex items-center gap-2 bg-white text-black text-[15px] font-bold px-7 py-3.5 rounded-full transition-all hover:opacity-92">
              Start building free <ArrowRight className="h-4 w-4" />
            </button>
          </Link>
          <a href="#features">
            <button
              className="text-[15px] px-7 py-3.5 rounded-full transition-all"
              style={{ color: "#555", border: "1px solid rgba(255,255,255,0.1)" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.2)"; (e.currentTarget as HTMLElement).style.color = "#aaa"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.1)"; (e.currentTarget as HTMLElement).style.color = "#555"; }}
            >See features</button>
          </a>
        </div>

        <p className="text-[12px]" style={{ color: "#333" }}>$5 free credit · No card required</p>
      </section>

      {/* ── Features ── */}
      <section id="features" className="px-8 md:px-14 py-24 max-w-6xl mx-auto w-full">
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] mb-12" style={{ color: "#444" }}>Platform</p>
        <div
          className="features-grid rounded-2xl overflow-hidden"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            border: "1px solid rgba(255,255,255,0.07)",
          }}
        >
          <FCard
            icon={<svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="white" strokeWidth="1.5"><path d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2z"/><path d="M12 8v4l3 3"/></svg>}
            title="Persistent Memory"
            body="Agents remember every caller across sessions. Context carries forward automatically — no repeated intros, no forgotten preferences."
          />
          <FCard
            icon={<svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="white" strokeWidth="1.5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>}
            title="Real-Time Orchestration"
            body="Sub-100ms latency pipeline with hot-swap providers. Route ASR → LLM → TTS without dropped audio or context loss."
          />
          <FCard
            icon={<svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="white" strokeWidth="1.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>}
            title="Bring Your Own Keys"
            body="Connect Deepgram, OpenAI, ElevenLabs, Twilio and more. Your API keys, your costs — we handle the orchestration layer only."
          />
          <FCard
            icon={<svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="white" strokeWidth="1.5"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.13 11.8a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.04 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.09 8.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21 16.92z"/></svg>}
            title="Outbound Campaigns"
            body="Schedule and run bulk outbound call campaigns with smart retry logic, disposition tracking, and CRM webhook delivery."
          />
          <FCard
            icon={<svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="white" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>}
            title="Live Call Monitoring"
            body="Watch active calls in real time. Inspect transcript, sentiment, and pipeline state from the dashboard without interrupting the agent."
          />
          <FCard
            icon={<svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="white" strokeWidth="1.5"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/></svg>}
            title="Smart Scheduling"
            body="Built-in booking engine with availability windows, timezone awareness, and Google Calendar sync — no third-party scheduler needed."
          />
        </div>
      </section>

      {/* ── How it works ── */}
      <section id="how" className="px-8 md:px-14 py-24 max-w-6xl mx-auto w-full">
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] mb-12" style={{ color: "#444" }}>How it works</p>
        <div
          className="how-grid items-center gap-16"
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}
        >
          <div>
            <h2
              className="font-black leading-[1.1] mb-5"
              style={{ fontSize: "clamp(1.9rem, 3.5vw, 3rem)", letterSpacing: "-0.03em" }}
            >
              Your call pipeline,<br />in three lines of code.
            </h2>
            <p className="text-[14px] leading-[1.8] mb-8" style={{ color: "#555", maxWidth: 420 }}>
              Add your provider API keys, configure your agent's voice and prompt, then hit the API.
              SnapServe handles the WebSocket orchestration, fallback logic, and memory persistence automatically.
            </p>
            <Link href={`${BASE}/sign-up`}>
              <button className="inline-flex items-center gap-2 bg-white text-black text-[14px] font-bold px-6 py-3 rounded-full transition-all hover:opacity-90">
                View API docs <ArrowRight className="h-4 w-4" />
              </button>
            </Link>
          </div>

          {/* Terminal */}
          <div className="rounded-2xl overflow-hidden" style={{ background: "#0e0e0e", border: "1px solid rgba(255,255,255,0.12)" }}>
            <div
              className="flex items-center gap-2 px-4 py-3"
              style={{ background: "#161616", borderBottom: "1px solid rgba(255,255,255,0.07)" }}
            >
              <div className="w-3 h-3 rounded-full" style={{ background: "#ff5f56" }} />
              <div className="w-3 h-3 rounded-full" style={{ background: "#ffbd2e" }} />
              <div className="w-3 h-3 rounded-full" style={{ background: "#27c93f" }} />
              <span className="text-[11px] ml-2" style={{ color: "#444", fontFamily: "monospace" }}>
                POST /api/calls/outbound
              </span>
            </div>
            <div
              className="p-6 text-[12.5px] leading-[1.9]"
              style={{ fontFamily: "'Courier New', monospace", color: "#888" }}
            >
              <span style={{ color: "#555" }}>const</span> response{" "}
              <span style={{ color: "#555" }}>=</span>{" "}
              <span style={{ color: "#555" }}>await</span> fetch(<br />
              &nbsp;&nbsp;<span style={{ color: "#777" }}>'https://api.snapserve.ai/calls/outbound'</span>,<br />
              &nbsp;&nbsp;{"{"}<br />
              &nbsp;&nbsp;&nbsp;&nbsp;method: <span style={{ color: "#777" }}>'POST'</span>,<br />
              &nbsp;&nbsp;&nbsp;&nbsp;headers: {"{"} <span style={{ color: "#777" }}>'Authorization'</span>: <span style={{ color: "#777" }}>`Bearer $&#123;API_KEY&#125;`</span> {"}"},<br />
              &nbsp;&nbsp;&nbsp;&nbsp;body: JSON.stringify({"{"}<br />
              &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;agent_id: <span style={{ color: "#777" }}>'agt_8f2k9d'</span>,<br />
              &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;to: <span style={{ color: "#777" }}>'+14155550192'</span>,<br />
              &nbsp;&nbsp;&nbsp;&nbsp;{"}"}),<br />
              &nbsp;&nbsp;{"}"}<br />
              );
            </div>
          </div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" className="px-8 md:px-14 py-24 max-w-6xl mx-auto w-full">
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] mb-4" style={{ color: "#444" }}>Pricing</p>
        <h2
          className="font-black leading-[1.1] mb-3"
          style={{ fontSize: "clamp(2rem, 4vw, 3.2rem)", letterSpacing: "-0.03em" }}
        >
          Pay per minute.<br />No surprises.
        </h2>
        <p className="text-[14px] mb-14" style={{ color: "#555" }}>
          Bring your own provider keys — you only pay SnapServe for orchestration.
        </p>

        <div
          className="pricing-grid gap-5"
          style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)" }}
        >
          <PCard
            plan="Developer"
            price="$0.08"
            per="/ min"
            items={["Standard LLM models", "Basic voice clones", "Up to 10 concurrent calls", "Email support"]}
            cta="Start free"
          />
          <PCard
            plan="Production"
            price="$0.12"
            per="/ min"
            featured
            items={["Zero-shot prompt engine", "Ultra-low latency voices", "Persistent memory store", "Smart SIP escalation", "Up to 500 concurrent calls"]}
            cta="Get started"
          />
          <PCard
            plan="Enterprise"
            price="Custom"
            per=""
            items={["Dedicated infrastructure", "Custom model fine-tuning", "HIPAA & SOC2 compliance", "24/7 Slack Connect support", "Unlimited concurrency"]}
            cta="Contact sales"
          />
        </div>
      </section>

      {/* ── Footer ── */}
      <footer
        className="flex items-center justify-between flex-wrap gap-4 px-8 md:px-14 py-8"
        style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
      >
        <p className="text-[12px]" style={{ color: "#333" }}>© 2026 SnapServe Inc.</p>
        <div className="flex gap-6">
          {["Privacy", "Terms", "Docs", "Status"].map(l => (
            <a
              key={l} href="#"
              className="text-[12px] transition-colors duration-150"
              style={{ color: "#333" }}
              onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = "#666")}
              onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = "#333")}
            >{l}</a>
          ))}
        </div>
      </footer>
    </div>
  );
}
