
const BG = "#080D15";
const SIDEBAR_BG = "#0A0F1A";
const CARD = "#0F1623";
const ELEVATED = "#141D2E";
const BORDER = "rgba(255,255,255,0.06)";
const BORDER_STRONG = "rgba(255,255,255,0.09)";
const PRIMARY = "#6366F1";
const PRIMARY_DIM = "rgba(99,102,241,0.12)";
const TEXT = "#E2E8F0";
const TEXT2 = "#8B92A8";
const TEXT3 = "#4A5568";
const SUCCESS = "#34D399";
const DANGER = "#FC8181";
const WARNING = "#FBBF24";

const navItems = [
  { label: "Overview", icon: "▣", active: true },
  { label: "Agents", icon: "◈", count: 12 },
  { label: "Calls", icon: "◉", count: 284 },
  { label: "Campaigns", icon: "◫" },
  { label: "Providers", icon: "◎" },
  { label: "Scheduling", icon: "◷" },
  { label: "Transfers", icon: "⇄" },
];

const metrics = [
  { label: "Active Agents", value: "4", change: "of 12 total", dot: SUCCESS },
  { label: "Calls Today", value: "284", change: "+18% vs yesterday", dot: PRIMARY },
  { label: "Success Rate", value: "94.2%", change: "↑ 1.3 pts", dot: SUCCESS },
  { label: "Avg Duration", value: "3:42", change: "8s faster", dot: WARNING },
];

const recentCalls = [
  { agent: "Sales Qualifier", num: "+91 98765 43210", status: "completed", dur: "4:12" },
  { agent: "Support Tier 1", num: "+91 87654 32109", status: "completed", dur: "2:55" },
  { agent: "Support Tier 1", num: "+91 76543 21098", status: "failed", dur: "0:48" },
  { agent: "Appointment Setter", num: "+91 65432 10987", status: "completed", dur: "6:01" },
  { agent: "Lead Nurture", num: "+91 54321 09876", status: "in-progress", dur: "1:33" },
];

const bars = [38, 52, 44, 71, 58, 84, 49, 67, 78, 61, 90, 72, 55, 80];

export function LinearObsidian() {
  return (
    <div style={{ background: BG, fontFamily: "'Inter', system-ui, sans-serif", display: "flex", minHeight: "100vh", color: TEXT, fontSize: 13 }}>

      {/* Sidebar */}
      <aside style={{ width: 220, background: SIDEBAR_BG, borderRight: `1px solid ${BORDER_STRONG}`, display: "flex", flexDirection: "column", padding: "20px 0", flexShrink: 0, position: "sticky", top: 0, height: "100vh" }}>

        {/* Logo */}
        <div style={{ padding: "4px 16px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 24, height: 24, borderRadius: 6, background: PRIMARY, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: "#fff" }}>S</span>
            </div>
            <span style={{ fontWeight: 600, fontSize: 13, color: TEXT, letterSpacing: "-0.01em" }}>SnapServe</span>
            <span style={{ marginLeft: "auto", fontSize: 10, padding: "2px 6px", borderRadius: 4, background: PRIMARY_DIM, color: PRIMARY, fontWeight: 600 }}>PRO</span>
          </div>
        </div>

        {/* Section label */}
        <div style={{ fontSize: 10, fontWeight: 600, color: TEXT3, letterSpacing: "0.1em", padding: "0 16px 6px", textTransform: "uppercase" }}>Workspace</div>

        {/* Nav Items */}
        <nav style={{ flex: 1, padding: "0 8px", display: "flex", flexDirection: "column", gap: 1 }}>
          {navItems.map(item => (
            <div key={item.label} style={{
              display: "flex", alignItems: "center", gap: 9, padding: "7px 10px",
              borderRadius: 7, cursor: "pointer",
              background: item.active ? PRIMARY_DIM : "transparent",
              color: item.active ? "#818CF8" : TEXT2,
            }}>
              <span style={{ fontSize: 13, opacity: item.active ? 1 : 0.55 }}>{item.icon}</span>
              <span style={{ fontWeight: item.active ? 500 : 400, fontSize: 13 }}>{item.label}</span>
              {item.count !== undefined && (
                <span style={{ marginLeft: "auto", fontSize: 10, color: item.active ? "#818CF8" : TEXT3, fontWeight: 500 }}>{item.count}</span>
              )}
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div style={{ padding: "16px 8px 0", borderTop: `1px solid ${BORDER}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", borderRadius: 7, cursor: "pointer" }}>
            <div style={{ width: 26, height: 26, borderRadius: "50%", background: `linear-gradient(135deg, ${PRIMARY}, #EC4899)`, flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 12, fontWeight: 500, color: TEXT }}>Rohan Shah</div>
              <div style={{ fontSize: 11, color: TEXT3 }}>rohan@acme.com</div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main style={{ flex: 1, overflow: "auto" }}>

        {/* Top bar */}
        <div style={{ padding: "20px 36px", borderBottom: `1px solid ${BORDER}`, display: "flex", alignItems: "center", justifyContent: "space-between", background: SIDEBAR_BG }}>
          <div>
            <span style={{ fontSize: 11, color: TEXT3, fontWeight: 500 }}>May 28, 2026</span>
            <h1 style={{ margin: "2px 0 0", fontSize: 18, fontWeight: 600, color: TEXT, letterSpacing: "-0.02em" }}>Overview</h1>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <div style={{ padding: "6px 14px", borderRadius: 7, border: `1px solid ${BORDER_STRONG}`, fontSize: 12, color: TEXT2, cursor: "pointer" }}>Last 24h ▾</div>
            <div style={{ padding: "6px 14px", borderRadius: 7, background: PRIMARY, fontSize: 12, color: "#fff", fontWeight: 500, cursor: "pointer" }}>+ New Agent</div>
          </div>
        </div>

        <div style={{ padding: "32px 36px", display: "flex", flexDirection: "column", gap: 24 }}>

          {/* Metrics */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            {metrics.map(m => (
              <div key={m.label} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "18px 20px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
                  <div style={{ width: 5, height: 5, borderRadius: "50%", background: m.dot }} />
                  <span style={{ fontSize: 10, fontWeight: 600, color: TEXT3, textTransform: "uppercase", letterSpacing: "0.09em" }}>{m.label}</span>
                </div>
                <div style={{ fontSize: 30, fontWeight: 700, color: TEXT, letterSpacing: "-0.04em", lineHeight: 1 }}>{m.value}</div>
                <div style={{ fontSize: 11, color: TEXT3, marginTop: 8 }}>{m.change}</div>
              </div>
            ))}
          </div>

          {/* Chart */}
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "22px 24px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: TEXT }}>Call Volume</div>
                <div style={{ fontSize: 12, color: TEXT3, marginTop: 2 }}>Real-time · updating every 60s</div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {["1H", "6H", "24H", "7D"].map((t, i) => (
                  <button key={t} style={{ padding: "4px 10px", borderRadius: 6, background: i === 2 ? ELEVATED : "transparent", border: `1px solid ${i === 2 ? BORDER_STRONG : "transparent"}`, color: i === 2 ? TEXT : TEXT3, fontSize: 11, cursor: "pointer", fontWeight: i === 2 ? 500 : 400 }}>{t}</button>
                ))}
              </div>
            </div>

            {/* Chart bars */}
            <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 90, marginBottom: 8 }}>
              {bars.map((h, i) => (
                <div key={i} style={{ flex: 1, height: `${h}%`, borderRadius: "3px 3px 0 0", background: i === bars.length - 3 ? PRIMARY : ELEVATED, opacity: i === bars.length - 3 ? 1 : 0.75 }} />
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "0 2px" }}>
              {["6AM", "9AM", "12PM", "3PM", "6PM", "9PM"].map(t => (
                <span key={t} style={{ fontSize: 10, color: TEXT3 }}>{t}</span>
              ))}
            </div>
          </div>

          {/* Recent Calls Table */}
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, overflow: "hidden" }}>
            <div style={{ padding: "16px 20px", borderBottom: `1px solid ${BORDER}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontWeight: 600, fontSize: 14, color: TEXT }}>Recent Calls</span>
              <span style={{ fontSize: 11, color: PRIMARY, cursor: "pointer", fontWeight: 500 }}>View all calls →</span>
            </div>
            <div>
              {/* Header */}
              <div style={{ display: "grid", gridTemplateColumns: "2fr 2fr 1fr 1fr", padding: "8px 20px", background: ELEVATED, borderBottom: `1px solid ${BORDER}` }}>
                {["Agent", "Number", "Duration", "Status"].map(h => (
                  <span key={h} style={{ fontSize: 10, fontWeight: 600, color: TEXT3, textTransform: "uppercase", letterSpacing: "0.08em" }}>{h}</span>
                ))}
              </div>
              {recentCalls.map((c, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "2fr 2fr 1fr 1fr", padding: "12px 20px", borderBottom: i < recentCalls.length - 1 ? `1px solid ${BORDER}` : "none", alignItems: "center" }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: TEXT }}>{c.agent}</span>
                  <span style={{ fontSize: 12, color: TEXT2, fontFamily: "monospace" }}>{c.num}</span>
                  <span style={{ fontSize: 12, color: TEXT2 }}>{c.dur}</span>
                  <span style={{ fontSize: 10, padding: "3px 8px", borderRadius: 5, fontWeight: 600, width: "fit-content",
                    background: c.status === "completed" ? "rgba(52,211,153,0.1)" : c.status === "failed" ? "rgba(252,129,129,0.1)" : "rgba(99,102,241,0.12)",
                    color: c.status === "completed" ? SUCCESS : c.status === "failed" ? DANGER : PRIMARY,
                  }}>{c.status}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>

      {/* Right panel */}
      <aside style={{ width: 240, borderLeft: `1px solid ${BORDER_STRONG}`, padding: "20px 16px", display: "flex", flexDirection: "column", gap: 16, flexShrink: 0, background: SIDEBAR_BG }}>

        <div style={{ fontSize: 10, fontWeight: 600, color: TEXT3, textTransform: "uppercase", letterSpacing: "0.1em" }}>Live Insights</div>

        {/* Provider Stack */}
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "14px" }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: TEXT2, marginBottom: 12 }}>Provider Stack</div>
          {[
            { role: "STT", name: "Deepgram", ok: true },
            { role: "LLM", name: "GPT-4o", ok: true },
            { role: "TTS", name: "ElevenLabs", ok: true },
            { role: "Telephony", name: "Twilio", ok: true },
          ].map(p => (
            <div key={p.role} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${BORDER}` }}>
              <span style={{ fontSize: 10, color: TEXT3, fontWeight: 500, textTransform: "uppercase" }}>{p.role}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ fontSize: 11, color: TEXT2 }}>{p.name}</span>
                <div style={{ width: 5, height: 5, borderRadius: "50%", background: SUCCESS }} />
              </div>
            </div>
          ))}
        </div>

        {/* Wallet */}
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "14px" }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: TEXT2, marginBottom: 8 }}>Wallet</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: TEXT, letterSpacing: "-0.03em" }}>$12.40</div>
          <div style={{ height: 3, borderRadius: 2, background: ELEVATED, marginTop: 10, marginBottom: 4 }}>
            <div style={{ height: "100%", width: "38%", borderRadius: 2, background: PRIMARY }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontSize: 10, color: TEXT3 }}>$7.60 used</span>
            <span style={{ fontSize: 10, color: TEXT3 }}>$20 budget</span>
          </div>
          <div style={{ marginTop: 12, padding: "6px 10px", borderRadius: 6, background: PRIMARY_DIM, color: PRIMARY, fontSize: 11, fontWeight: 500, textAlign: "center", cursor: "pointer" }}>Add Credits</div>
        </div>

        {/* Latency */}
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "14px" }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: TEXT2, marginBottom: 12 }}>Latency (avg)</div>
          {[["STT", "68ms", 68], ["LLM", "240ms", 55], ["TTS", "110ms", 75]].map(([k, v, w]) => (
            <div key={k as string} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 10, color: TEXT3 }}>{k}</span>
                <span style={{ fontSize: 10, color: TEXT2, fontWeight: 500 }}>{v}</span>
              </div>
              <div style={{ height: 3, borderRadius: 2, background: ELEVATED }}>
                <div style={{ height: "100%", width: `${w}%`, borderRadius: 2, background: SUCCESS }} />
              </div>
            </div>
          ))}
        </div>

      </aside>
    </div>
  );
}
