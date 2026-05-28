
const BG = "#060C18";
const GLASS = "rgba(255,255,255,0.03)";
const GLASS_BORDER = "rgba(255,255,255,0.07)";
const GLASS_ELEVATED = "rgba(255,255,255,0.055)";
const CARD_GRADIENT = "linear-gradient(135deg, rgba(120,80,220,0.08) 0%, rgba(30,50,120,0.05) 100%)";
const PRIMARY = "#9333EA";
const PRIMARY2 = "#C084FC";
const PRIMARY_DIM = "rgba(147,51,234,0.15)";
const ACCENT = "#38BDF8";
const TEXT = "#F1F5F9";
const TEXT2 = "#94A3B8";
const TEXT3 = "#475569";
const SUCCESS = "#4ADE80";
const DANGER = "#F87171";

const nav = [
  { label: "Dashboard", icon: "◈", active: true },
  { label: "Agents", icon: "◉" },
  { label: "Calls", icon: "◦◦" },
  { label: "Campaigns", icon: "▣" },
  { label: "Providers", icon: "◎" },
  { label: "Scheduling", icon: "◷" },
];

const stats = [
  { label: "Agents Live", value: "4", icon: "◉", color: SUCCESS, sub: "12 total" },
  { label: "Calls Today", value: "284", icon: "◦", color: ACCENT, sub: "+18% vs yesterday" },
  { label: "Success", value: "94%", icon: "◈", color: PRIMARY2, sub: "↑ 1.3 pts" },
  { label: "Avg Duration", value: "3:42", icon: "◷", color: "#FB923C", sub: "8s improved" },
];

const bars = [30, 50, 40, 68, 55, 80, 45, 70, 82, 60, 92, 75];

const calls = [
  { name: "Sales Qualifier", phone: "+91 98765 43210", t: "4:12", ok: true },
  { name: "Support T1", phone: "+91 87654 32109", t: "2:55", ok: true },
  { name: "Support T1", phone: "+91 76543 21098", t: "0:48", ok: false },
  { name: "Lead Nurture", phone: "+91 65432 10987", t: "6:01", ok: true },
];

export function GlassyPremium() {
  return (
    <div style={{ background: BG, fontFamily: "'Inter', system-ui, sans-serif", minHeight: "100vh", display: "flex", color: TEXT, fontSize: 13, position: "relative" }}>

      {/* Ambient glow */}
      <div style={{ position: "fixed", top: -200, left: 100, width: 600, height: 600, borderRadius: "50%", background: "radial-gradient(circle, rgba(147,51,234,0.07) 0%, transparent 70%)", pointerEvents: "none" }} />
      <div style={{ position: "fixed", bottom: -100, right: 100, width: 400, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgba(56,189,248,0.05) 0%, transparent 70%)", pointerEvents: "none" }} />

      {/* Sidebar */}
      <aside style={{ width: 220, background: GLASS, backdropFilter: "blur(20px)", borderRight: `1px solid ${GLASS_BORDER}`, display: "flex", flexDirection: "column", padding: "24px 0", flexShrink: 0, position: "sticky", top: 0, height: "100vh", zIndex: 10 }}>

        {/* Logo */}
        <div style={{ padding: "0 18px 32px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: `linear-gradient(135deg, ${PRIMARY}, ${ACCENT})`, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 0 20px rgba(147,51,234,0.4)` }}>
              <span style={{ fontSize: 14, fontWeight: 800, color: "#fff" }}>S</span>
            </div>
            <span style={{ fontWeight: 600, fontSize: 14, color: TEXT, letterSpacing: "-0.01em" }}>SnapServe</span>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: "0 10px", display: "flex", flexDirection: "column", gap: 2 }}>
          {nav.map(item => (
            <div key={item.label} style={{
              display: "flex", alignItems: "center", gap: 10, padding: "9px 12px",
              borderRadius: 10, cursor: "pointer",
              background: item.active ? PRIMARY_DIM : "transparent",
              border: `1px solid ${item.active ? "rgba(147,51,234,0.25)" : "transparent"}`,
              color: item.active ? PRIMARY2 : TEXT2,
            }}>
              <span style={{ fontSize: 14 }}>{item.icon}</span>
              <span style={{ fontWeight: item.active ? 500 : 400 }}>{item.label}</span>
              {item.active && (
                <span style={{ marginLeft: "auto", width: 6, height: 6, borderRadius: "50%", background: PRIMARY, boxShadow: `0 0 6px ${PRIMARY}` }} />
              )}
            </div>
          ))}
        </nav>

        {/* User */}
        <div style={{ padding: "16px 10px 0", borderTop: `1px solid ${GLASS_BORDER}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 10, background: GLASS_ELEVATED, border: `1px solid ${GLASS_BORDER}` }}>
            <div style={{ width: 30, height: 30, borderRadius: "50%", background: `linear-gradient(135deg, ${PRIMARY}, ${ACCENT})`, flexShrink: 0, boxShadow: `0 0 10px rgba(147,51,234,0.3)` }} />
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: TEXT }}>Rohan Shah</div>
              <div style={{ fontSize: 10, color: TEXT3 }}>Pro · $12.40 credit</div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex: 1, padding: "36px 40px", overflow: "auto" }}>

        {/* Header */}
        <div style={{ marginBottom: 36, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: "0.12em", color: TEXT3, textTransform: "uppercase", fontWeight: 500, marginBottom: 6 }}>AI Voice Platform</div>
            <h1 style={{ fontSize: 28, fontWeight: 700, color: TEXT, margin: 0, letterSpacing: "-0.03em", background: `linear-gradient(135deg, ${TEXT} 60%, ${PRIMARY2})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>Dashboard</h1>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <div style={{ padding: "8px 16px", borderRadius: 10, background: GLASS, border: `1px solid ${GLASS_BORDER}`, fontSize: 12, color: TEXT2, cursor: "pointer" }}>Filter ▾</div>
            <div style={{ padding: "8px 18px", borderRadius: 10, background: `linear-gradient(135deg, ${PRIMARY}, #7C3AED)`, fontSize: 12, color: "#fff", fontWeight: 600, cursor: "pointer", boxShadow: `0 4px 20px rgba(147,51,234,0.35)` }}>+ New Agent</div>
          </div>
        </div>

        {/* Stats Grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 24 }}>
          {stats.map(s => (
            <div key={s.label} style={{ background: CARD_GRADIENT, border: `1px solid ${GLASS_BORDER}`, borderRadius: 16, padding: "20px", position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", top: -20, right: -20, width: 80, height: 80, borderRadius: "50%", background: `radial-gradient(circle, ${s.color}15, transparent 70%)` }} />
              <div style={{ fontSize: 18, color: s.color, marginBottom: 10, opacity: 0.8 }}>{s.icon}</div>
              <div style={{ fontSize: 30, fontWeight: 700, color: TEXT, letterSpacing: "-0.04em", lineHeight: 1 }}>{s.value}</div>
              <div style={{ fontSize: 10, color: TEXT3, marginTop: 4, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.06em" }}>{s.label}</div>
              <div style={{ fontSize: 11, color: TEXT2, marginTop: 8 }}>{s.sub}</div>
            </div>
          ))}
        </div>

        {/* Middle row */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 24 }}>

          {/* Chart */}
          <div style={{ background: CARD_GRADIENT, border: `1px solid ${GLASS_BORDER}`, borderRadius: 16, padding: "22px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: TEXT }}>Call Volume</div>
                <div style={{ fontSize: 11, color: TEXT3, marginTop: 2 }}>Today · 12h view</div>
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color: TEXT }}>284</div>
            </div>

            {/* Bars */}
            <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 80 }}>
              {bars.map((h, i) => (
                <div key={i} style={{
                  flex: 1, height: `${h}%`, borderRadius: "3px 3px 0 0",
                  background: i >= bars.length - 2
                    ? `linear-gradient(180deg, ${PRIMARY}, ${ACCENT})`
                    : GLASS_ELEVATED,
                  boxShadow: i >= bars.length - 2 ? `0 0 12px rgba(147,51,234,0.4)` : "none",
                }} />
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
              {["8AM", "11AM", "2PM", "5PM", "8PM"].map(t => (
                <span key={t} style={{ fontSize: 9, color: TEXT3 }}>{t}</span>
              ))}
            </div>
          </div>

          {/* Live Agents */}
          <div style={{ background: CARD_GRADIENT, border: `1px solid ${GLASS_BORDER}`, borderRadius: 16, padding: "22px" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: TEXT, marginBottom: 16 }}>Live Agents</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                { name: "Sales Qualifier", calls: 84, pct: 96, color: SUCCESS },
                { name: "Support Tier 1", calls: 120, pct: 91, color: ACCENT },
                { name: "Appointment Setter", calls: 47, pct: 88, color: PRIMARY2 },
                { name: "Lead Nurture", calls: 33, pct: 97, color: "#FB923C" },
              ].map(a => (
                <div key={a.name}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                    <span style={{ fontSize: 12, color: TEXT2 }}>{a.name}</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: a.color }}>{a.pct}%</span>
                  </div>
                  <div style={{ height: 3, borderRadius: 2, background: GLASS_ELEVATED }}>
                    <div style={{ height: "100%", width: `${a.pct}%`, borderRadius: 2, background: `linear-gradient(90deg, ${a.color}, ${a.color}aa)` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Recent calls */}
        <div style={{ background: CARD_GRADIENT, border: `1px solid ${GLASS_BORDER}`, borderRadius: 16, overflow: "hidden" }}>
          <div style={{ padding: "18px 22px", borderBottom: `1px solid ${GLASS_BORDER}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontWeight: 600, fontSize: 14, color: TEXT }}>Recent Calls</span>
            <span style={{ fontSize: 11, color: PRIMARY2, cursor: "pointer" }}>All calls →</span>
          </div>
          {calls.map((c, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 16, padding: "13px 22px", borderBottom: i < calls.length - 1 ? `1px solid ${GLASS_BORDER}` : "none" }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: c.ok ? SUCCESS : DANGER, boxShadow: `0 0 8px ${c.ok ? SUCCESS : DANGER}88`, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: TEXT }}>{c.name}</div>
                <div style={{ fontSize: 11, color: TEXT3, fontFamily: "monospace" }}>{c.phone}</div>
              </div>
              <div style={{ fontSize: 12, color: TEXT2, fontWeight: 500 }}>{c.t}</div>
              <div style={{ fontSize: 10, padding: "3px 8px", borderRadius: 6, background: c.ok ? "rgba(74,222,128,0.1)" : "rgba(248,113,113,0.1)", color: c.ok ? SUCCESS : DANGER, fontWeight: 600 }}>{c.ok ? "completed" : "failed"}</div>
            </div>
          ))}
        </div>

      </main>

      {/* Right panel */}
      <aside style={{ width: 240, borderLeft: `1px solid ${GLASS_BORDER}`, background: GLASS, backdropFilter: "blur(20px)", padding: "36px 18px", display: "flex", flexDirection: "column", gap: 18, flexShrink: 0 }}>

        {/* System health */}
        <div style={{ background: GLASS_ELEVATED, border: `1px solid ${GLASS_BORDER}`, borderRadius: 14, padding: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: SUCCESS, boxShadow: `0 0 8px ${SUCCESS}` }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: TEXT }}>All Systems Go</span>
          </div>
          {[["P50 Latency", "320ms"], ["STT Accuracy", "97.2%"], ["TTS Chars", "41.2K"], ["Uptime", "99.98%"]].map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: `1px solid rgba(255,255,255,0.04)` }}>
              <span style={{ fontSize: 11, color: TEXT3 }}>{k}</span>
              <span style={{ fontSize: 11, color: TEXT2, fontWeight: 500 }}>{v}</span>
            </div>
          ))}
        </div>

        {/* Wallet */}
        <div style={{ background: `linear-gradient(135deg, rgba(147,51,234,0.15), rgba(56,189,248,0.08))`, border: `1px solid rgba(147,51,234,0.25)`, borderRadius: 14, padding: "16px" }}>
          <div style={{ fontSize: 10, color: TEXT3, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 500, marginBottom: 6 }}>Wallet Balance</div>
          <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.04em", background: `linear-gradient(135deg, ${TEXT}, ${PRIMARY2})`, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>$12.40</div>
          <div style={{ height: 3, borderRadius: 2, background: "rgba(255,255,255,0.08)", marginTop: 14, marginBottom: 6 }}>
            <div style={{ height: "100%", width: "38%", borderRadius: 2, background: `linear-gradient(90deg, ${PRIMARY}, ${ACCENT})` }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontSize: 10, color: TEXT3 }}>$7.60 of $20</span>
            <span style={{ fontSize: 10, color: PRIMARY2, cursor: "pointer", fontWeight: 500 }}>Top up →</span>
          </div>
        </div>

        {/* Provider Stack */}
        <div style={{ background: GLASS_ELEVATED, border: `1px solid ${GLASS_BORDER}`, borderRadius: 14, padding: "14px" }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: TEXT2, marginBottom: 12 }}>Active Stack</div>
          {[["STT", "Deepgram"], ["LLM", "GPT-4o"], ["TTS", "ElevenLabs"], ["Tel", "Twilio"]].map(([role, name]) => (
            <div key={role} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 0", borderBottom: `1px solid rgba(255,255,255,0.04)` }}>
              <span style={{ fontSize: 10, color: TEXT3, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>{role}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 11, color: TEXT2 }}>{name}</span>
                <div style={{ width: 5, height: 5, borderRadius: "50%", background: SUCCESS, boxShadow: `0 0 5px ${SUCCESS}` }} />
              </div>
            </div>
          ))}
        </div>

      </aside>
    </div>
  );
}
