
const BG = "#0B1020";
const SIDEBAR_BG = "#0E1525";
const CARD = "#121A2B";
const ELEVATED = "#182235";
const BORDER = "rgba(255,255,255,0.05)";
const PRIMARY = "#8B5CF6";
const PRIMARY_DIM = "rgba(139,92,246,0.15)";
const TEXT = "#F8FAFC";
const TEXT2 = "#94A3B8";
const TEXT3 = "#64748B";
const SUCCESS = "#10B981";
const DANGER = "#EF4444";

const navItems = [
  { icon: "⬡", label: "Dashboard", active: true },
  { icon: "◈", label: "Agents" },
  { icon: "◉", label: "Calls" },
  { icon: "◻", label: "Campaigns" },
  { icon: "◎", label: "Providers" },
  { icon: "◷", label: "Scheduling" },
  { icon: "◐", label: "Transfers" },
];

const bottomNav = [
  { icon: "◪", label: "API Keys" },
  { icon: "⚙", label: "Settings" },
];

const metrics = [
  { label: "Total Agents", value: "12", delta: "+2", up: true, sub: "4 active now" },
  { label: "Calls Today", value: "284", delta: "+18%", up: true, sub: "vs yesterday" },
  { label: "Success Rate", value: "94.2%", delta: "+1.3%", up: true, sub: "last 7 days" },
  { label: "Avg Duration", value: "3m 42s", delta: "-8s", up: false, sub: "per call" },
];

const agents = [
  { name: "Sales Qualifier", status: "active", calls: 84, success: "96%" },
  { name: "Support Tier 1", status: "active", calls: 120, success: "91%" },
  { name: "Appointment Setter", status: "inactive", calls: 47, success: "88%" },
  { name: "Lead Nurture", status: "active", calls: 33, success: "97%" },
];

const chartBars = [40, 65, 45, 80, 60, 90, 55, 75, 85, 70, 95, 78];
const chartLabels = ["9AM", "10", "11", "12PM", "1", "2", "3", "4", "5", "6", "7", "8PM"];

export function CartesiaDark() {
  return (
    <div style={{ background: BG, fontFamily: "'Inter', system-ui, sans-serif", display: "flex", minHeight: "100vh", color: TEXT, fontSize: 13 }}>

      {/* Sidebar */}
      <aside style={{ width: 220, background: SIDEBAR_BG, borderRight: `1px solid ${BORDER}`, display: "flex", flexDirection: "column", padding: "24px 0", flexShrink: 0, position: "sticky", top: 0, height: "100vh" }}>

        {/* Logo */}
        <div style={{ padding: "0 20px 32px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: PRIMARY, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700 }}>S</div>
            <span style={{ fontWeight: 600, fontSize: 14, color: TEXT }}>SnapServe</span>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: "0 12px", display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ fontSize: 10, fontWeight: 500, color: TEXT3, letterSpacing: "0.08em", padding: "0 8px 8px", textTransform: "uppercase" }}>Platform</div>
          {navItems.map(item => (
            <div key={item.label} style={{
              display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
              borderRadius: 8, cursor: "pointer",
              background: item.active ? PRIMARY_DIM : "transparent",
              color: item.active ? "#A78BFA" : TEXT2,
              fontWeight: item.active ? 500 : 400,
              transition: "all 0.15s",
            }}>
              <span style={{ fontSize: 14, opacity: item.active ? 1 : 0.6 }}>{item.icon}</span>
              <span>{item.label}</span>
              {item.active && <div style={{ marginLeft: "auto", width: 4, height: 4, borderRadius: "50%", background: PRIMARY }} />}
            </div>
          ))}
        </nav>

        {/* Bottom Nav */}
        <div style={{ padding: "16px 12px 0", borderTop: `1px solid ${BORDER}`, display: "flex", flexDirection: "column", gap: 2 }}>
          {bottomNav.map(item => (
            <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", borderRadius: 8, cursor: "pointer", color: TEXT3 }}>
              <span style={{ fontSize: 14 }}>{item.icon}</span>
              <span>{item.label}</span>
            </div>
          ))}
          {/* User */}
          <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10, padding: "10px", borderRadius: 8, background: ELEVATED }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: "linear-gradient(135deg, #8B5CF6, #3B82F6)", flexShrink: 0 }} />
            <div>
              <div style={{ color: TEXT, fontWeight: 500, fontSize: 12 }}>Rohan Shah</div>
              <div style={{ color: TEXT3, fontSize: 11 }}>Pro Plan</div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex: 1, padding: "40px 48px", maxWidth: 900, overflow: "auto" }}>

        {/* Header */}
        <div style={{ marginBottom: 40 }}>
          <div style={{ fontSize: 11, color: TEXT3, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8, fontWeight: 500 }}>Overview</div>
          <h1 style={{ fontSize: 26, fontWeight: 600, color: TEXT, margin: 0, letterSpacing: "-0.02em" }}>Dashboard</h1>
          <p style={{ color: TEXT2, marginTop: 6, fontSize: 13, fontWeight: 400 }}>Wednesday, May 28 · Your voice agents are running</p>
        </div>

        {/* Metric Cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 32 }}>
          {metrics.map(m => (
            <div key={m.label} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 16, padding: "20px 20px 18px" }}>
              <div style={{ fontSize: 11, color: TEXT3, fontWeight: 500, letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 12 }}>{m.label}</div>
              <div style={{ fontSize: 28, fontWeight: 600, color: TEXT, letterSpacing: "-0.03em", lineHeight: 1 }}>{m.value}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 500, color: m.up ? SUCCESS : DANGER }}>{m.delta}</span>
                <span style={{ fontSize: 11, color: TEXT3 }}>{m.sub}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Chart + Status Row */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 16, marginBottom: 32 }}>

          {/* Call Volume Chart */}
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 16, padding: "24px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: TEXT }}>Call Volume</div>
                <div style={{ fontSize: 11, color: TEXT3, marginTop: 2 }}>Last 12 hours</div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {["1D", "7D", "30D"].map((t, i) => (
                  <span key={t} style={{ fontSize: 11, padding: "4px 10px", borderRadius: 6, background: i === 0 ? PRIMARY_DIM : "transparent", color: i === 0 ? "#A78BFA" : TEXT3, cursor: "pointer" }}>{t}</span>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 100 }}>
              {chartBars.map((h, i) => (
                <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                  <div style={{ width: "100%", height: h, borderRadius: 4, background: i === 9 ? PRIMARY : ELEVATED, opacity: i === 9 ? 1 : 0.7, transition: "all 0.2s" }} />
                  <span style={{ fontSize: 9, color: TEXT3 }}>{chartLabels[i]}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Call Status Breakdown */}
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 16, padding: "24px" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: TEXT, marginBottom: 20 }}>Call Status</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {[
                { label: "Completed", pct: 94, color: SUCCESS },
                { label: "In Progress", pct: 3, color: PRIMARY },
                { label: "Failed", pct: 3, color: DANGER },
              ].map(s => (
                <div key={s.label}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: TEXT2 }}>{s.label}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: TEXT }}>{s.pct}%</span>
                  </div>
                  <div style={{ height: 4, borderRadius: 2, background: ELEVATED }}>
                    <div style={{ height: "100%", width: `${s.pct}%`, borderRadius: 2, background: s.color }} />
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 24, padding: "14px", background: ELEVATED, borderRadius: 12 }}>
              <div style={{ fontSize: 11, color: TEXT3, marginBottom: 4 }}>Total calls today</div>
              <div style={{ fontSize: 22, fontWeight: 600, color: TEXT }}>284</div>
            </div>
          </div>
        </div>

        {/* Agents Table */}
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 16, overflow: "hidden" }}>
          <div style={{ padding: "20px 24px", borderBottom: `1px solid ${BORDER}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: TEXT }}>Active Agents</div>
            <span style={{ fontSize: 11, color: "#A78BFA", cursor: "pointer", fontWeight: 500 }}>View all →</span>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                {["Agent", "Status", "Calls", "Success"].map(h => (
                  <th key={h} style={{ padding: "10px 24px", textAlign: "left", fontSize: 10, fontWeight: 500, color: TEXT3, textTransform: "uppercase", letterSpacing: "0.08em" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {agents.map((a, i) => (
                <tr key={a.name} style={{ borderBottom: i < agents.length - 1 ? `1px solid ${BORDER}` : "none" }}>
                  <td style={{ padding: "14px 24px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 32, height: 32, borderRadius: 10, background: ELEVATED, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600, color: "#A78BFA" }}>{a.name[0]}</div>
                      <span style={{ fontWeight: 500, color: TEXT, fontSize: 13 }}>{a.name}</span>
                    </div>
                  </td>
                  <td style={{ padding: "14px 24px" }}>
                    <span style={{ fontSize: 11, padding: "3px 8px", borderRadius: 6, background: a.status === "active" ? "rgba(16,185,129,0.1)" : ELEVATED, color: a.status === "active" ? SUCCESS : TEXT3, fontWeight: 500 }}>{a.status}</span>
                  </td>
                  <td style={{ padding: "14px 24px", color: TEXT2, fontWeight: 500 }}>{a.calls}</td>
                  <td style={{ padding: "14px 24px", color: SUCCESS, fontWeight: 600 }}>{a.success}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>

      {/* Right Panel */}
      <aside style={{ width: 260, background: SIDEBAR_BG, borderLeft: `1px solid ${BORDER}`, padding: "40px 20px", display: "flex", flexDirection: "column", gap: 20, flexShrink: 0 }}>

        {/* Live Status */}
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 14, padding: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: SUCCESS }} />
            <span style={{ fontSize: 12, fontWeight: 500, color: TEXT }}>System Live</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[["API Latency", "42ms"], ["STT", "Deepgram"], ["LLM", "GPT-4o"], ["TTS", "ElevenLabs"]].map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11, color: TEXT3 }}>{k}</span>
                <span style={{ fontSize: 11, color: TEXT2, fontWeight: 500 }}>{v}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Calls */}
        <div>
          <div style={{ fontSize: 11, color: TEXT3, fontWeight: 500, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>Recent Calls</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              { num: "+91 98765 43210", dur: "4m 12s", ok: true },
              { num: "+91 87654 32109", dur: "2m 55s", ok: true },
              { num: "+91 76543 21098", dur: "0m 48s", ok: false },
              { num: "+91 65432 10987", dur: "6m 01s", ok: true },
            ].map((c, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: CARD, borderRadius: 10, border: `1px solid ${BORDER}` }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: c.ok ? SUCCESS : DANGER, flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: TEXT2, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.num}</div>
                  <div style={{ fontSize: 10, color: TEXT3 }}>{c.dur}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Wallet */}
        <div style={{ background: "linear-gradient(135deg, rgba(139,92,246,0.2), rgba(59,130,246,0.1))", border: `1px solid rgba(139,92,246,0.3)`, borderRadius: 14, padding: "16px" }}>
          <div style={{ fontSize: 11, color: TEXT3, marginBottom: 6 }}>Wallet Balance</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: TEXT, letterSpacing: "-0.03em" }}>$12.40</div>
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, color: TEXT3, marginBottom: 4 }}>Usage this month</div>
            <div style={{ height: 4, borderRadius: 2, background: "rgba(255,255,255,0.1)" }}>
              <div style={{ height: "100%", width: "38%", borderRadius: 2, background: PRIMARY }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
              <span style={{ fontSize: 10, color: TEXT3 }}>$7.60 spent</span>
              <span style={{ fontSize: 10, color: TEXT3 }}>$20 cap</span>
            </div>
          </div>
        </div>

      </aside>
    </div>
  );
}
