
const BG = "#0B0D12";
const SIDEBAR = "#0E1117";
const CARD = "#12161F";
const ELEVATED = "#171C26";
const BORDER = "rgba(255,255,255,0.05)";
const BORDER_MED = "rgba(255,255,255,0.07)";
const HOVER = "rgba(255,255,255,0.03)";
const ACTIVE = "rgba(255,255,255,0.06)";
const TEXT = "#F3F4F6";
const TEXT2 = "#9CA3AF";
const TEXT3 = "#6B7280";
const TEXT4 = "#4B5563";
const SUCCESS_MUTED = "#4B6A5A";
const DANGER_MUTED = "#6A4B4B";
const WARN_MUTED = "#6A5E3A";

const navItems = [
  { label: "Overview", icon: "▣", active: true },
  { label: "Agents", icon: "◈", badge: "12" },
  { label: "Calls", icon: "◉", badge: "284" },
  { label: "Campaigns", icon: "◫" },
  { label: "Providers", icon: "◎" },
  { label: "Scheduling", icon: "◷" },
  { label: "Transfers", icon: "⇄" },
];

const metrics = [
  { label: "Active Agents", value: "4", note: "of 12 total", trend: "stable" },
  { label: "Calls Today", value: "284", note: "+18% from yesterday", trend: "up" },
  { label: "Success Rate", value: "94.2%", note: "↑ 1.3 pts this week", trend: "up" },
  { label: "Avg Duration", value: "3:42", note: "8s faster than avg", trend: "up" },
];

const agents = [
  { name: "Sales Qualifier", provider: "GPT-4o · ElevenLabs", calls: 84, success: 96, active: true },
  { name: "Support Tier 1", provider: "GPT-4o · Deepgram", calls: 120, success: 91, active: true },
  { name: "Appointment Setter", provider: "Claude · Polly", calls: 47, success: 88, active: false },
  { name: "Lead Nurture", provider: "GPT-4o · Cartesia", calls: 33, success: 97, active: true },
];

const calls = [
  { agent: "Sales Qualifier", num: "+91 98765 43210", dur: "4:12", status: "completed" },
  { agent: "Support Tier 1", num: "+91 87654 32109", dur: "2:55", status: "completed" },
  { agent: "Support Tier 1", num: "+91 76543 21098", dur: "0:48", status: "failed" },
  { agent: "Appointment Setter", num: "+91 65432 10987", dur: "6:01", status: "completed" },
  { agent: "Lead Nurture", num: "+91 54321 09876", dur: "1:33", status: "in-progress" },
];

const bars = [28, 44, 36, 62, 50, 74, 42, 60, 70, 54, 82, 66, 48, 72];

export function MonochromeObsidian() {
  return (
    <div style={{ background: BG, fontFamily: "'Inter', system-ui, sans-serif", display: "flex", minHeight: "100vh", color: TEXT, fontSize: 13, letterSpacing: "-0.01em" }}>

      {/* Sidebar */}
      <aside style={{ width: 216, background: SIDEBAR, borderRight: `1px solid ${BORDER}`, display: "flex", flexDirection: "column", padding: "22px 0", flexShrink: 0, position: "sticky", top: 0, height: "100vh" }}>

        {/* Logo */}
        <div style={{ padding: "0 18px 28px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <div style={{ width: 26, height: 26, borderRadius: 7, background: ELEVATED, border: `1px solid ${BORDER_MED}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: TEXT2 }}>S</span>
            </div>
            <span style={{ fontWeight: 500, fontSize: 14, color: TEXT, letterSpacing: "-0.02em" }}>SnapServe</span>
            <span style={{ marginLeft: "auto", fontSize: 9, padding: "2px 5px", borderRadius: 4, background: ELEVATED, color: TEXT3, fontWeight: 500, border: `1px solid ${BORDER}` }}>PRO</span>
          </div>
        </div>

        {/* Search */}
        <div style={{ padding: "0 12px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", borderRadius: 8, background: ELEVATED, border: `1px solid ${BORDER}`, cursor: "text" }}>
            <span style={{ fontSize: 11, color: TEXT4 }}>⌕</span>
            <span style={{ fontSize: 12, color: TEXT4 }}>Search...</span>
            <span style={{ marginLeft: "auto", fontSize: 9, padding: "1px 5px", borderRadius: 3, background: BG, color: TEXT4, border: `1px solid ${BORDER}` }}>⌘K</span>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: "0 8px", display: "flex", flexDirection: "column", gap: 1 }}>
          <div style={{ fontSize: 9, fontWeight: 600, color: TEXT4, letterSpacing: "0.1em", padding: "0 10px 8px", textTransform: "uppercase" }}>Platform</div>
          {navItems.map(item => (
            <div key={item.label} style={{
              display: "flex", alignItems: "center", gap: 9, padding: "7px 10px",
              borderRadius: 7, cursor: "pointer",
              background: item.active ? ACTIVE : "transparent",
              color: item.active ? TEXT : TEXT3,
            }}>
              <span style={{ fontSize: 12, color: item.active ? TEXT2 : TEXT4 }}>{item.icon}</span>
              <span style={{ fontWeight: item.active ? 500 : 400, fontSize: 13 }}>{item.label}</span>
              {item.badge && (
                <span style={{ marginLeft: "auto", fontSize: 10, color: TEXT4, fontWeight: 500 }}>{item.badge}</span>
              )}
            </div>
          ))}
        </nav>

        {/* Bottom */}
        <div style={{ padding: "16px 8px 0", borderTop: `1px solid ${BORDER}`, display: "flex", flexDirection: "column", gap: 1 }}>
          {[{ icon: "◪", label: "API Keys" }, { icon: "⚙", label: "Settings" }].map(item => (
            <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 10px", borderRadius: 7, cursor: "pointer", color: TEXT4 }}>
              <span style={{ fontSize: 12 }}>{item.icon}</span>
              <span style={{ fontSize: 13 }}>{item.label}</span>
            </div>
          ))}

          {/* User */}
          <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 9, padding: "9px 10px", borderRadius: 8, background: ELEVATED, border: `1px solid ${BORDER}`, cursor: "pointer" }}>
            <div style={{ width: 26, height: 26, borderRadius: "50%", background: "#1F2533", border: `1px solid ${BORDER_MED}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: TEXT2 }}>R</span>
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: TEXT, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Rohan Shah</div>
              <div style={{ fontSize: 10, color: TEXT4 }}>Pro · $12.40</div>
            </div>
            <span style={{ marginLeft: "auto", fontSize: 11, color: TEXT4 }}>⋯</span>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column" }}>

        {/* Topbar */}
        <div style={{ padding: "16px 36px", borderBottom: `1px solid ${BORDER}`, display: "flex", alignItems: "center", justifyContent: "space-between", background: SIDEBAR, flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 11, color: TEXT4, marginBottom: 2 }}>Wed, May 28</div>
            <div style={{ fontSize: 17, fontWeight: 600, color: TEXT, letterSpacing: "-0.025em" }}>Overview</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div style={{ padding: "6px 12px", borderRadius: 7, background: ELEVATED, border: `1px solid ${BORDER_MED}`, fontSize: 12, color: TEXT3, cursor: "pointer" }}>Last 24h ▾</div>
            <div style={{ padding: "6px 14px", borderRadius: 7, background: ELEVATED, border: `1px solid ${BORDER_MED}`, fontSize: 12, color: TEXT2, fontWeight: 500, cursor: "pointer" }}>+ New Agent</div>
          </div>
        </div>

        <div style={{ padding: "32px 36px", display: "flex", flexDirection: "column", gap: 20 }}>

          {/* Metric Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            {metrics.map(m => (
              <div key={m.label} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "18px 20px" }}>
                <div style={{ fontSize: 10, fontWeight: 500, color: TEXT4, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 12 }}>{m.label}</div>
                <div style={{ fontSize: 28, fontWeight: 600, color: TEXT, letterSpacing: "-0.04em", lineHeight: 1 }}>{m.value}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 10 }}>
                  <span style={{ fontSize: 10, color: m.trend === "up" ? "#5A7A65" : TEXT4 }}>
                    {m.trend === "up" ? "↑" : "→"}
                  </span>
                  <span style={{ fontSize: 11, color: TEXT3 }}>{m.note}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Chart Row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 260px", gap: 12 }}>

            {/* Call Volume */}
            <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "22px 24px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 22 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500, color: TEXT, letterSpacing: "-0.015em" }}>Call Volume</div>
                  <div style={{ fontSize: 11, color: TEXT4, marginTop: 2 }}>284 calls · updating live</div>
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  {["1H", "6H", "24H", "7D"].map((t, i) => (
                    <button key={t} style={{
                      padding: "4px 9px", borderRadius: 5, fontSize: 10, cursor: "pointer", fontWeight: i === 2 ? 500 : 400,
                      background: i === 2 ? ELEVATED : "transparent",
                      border: `1px solid ${i === 2 ? BORDER_MED : "transparent"}`,
                      color: i === 2 ? TEXT2 : TEXT4,
                    }}>{t}</button>
                  ))}
                </div>
              </div>

              {/* Bars */}
              <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 80 }}>
                {bars.map((h, i) => {
                  const isRecent = i >= bars.length - 4;
                  return (
                    <div key={i} style={{
                      flex: 1, height: `${h}%`, borderRadius: "2px 2px 0 0",
                      background: isRecent ? `rgba(255,255,255,${0.1 + (i - (bars.length - 4)) * 0.04})` : "rgba(255,255,255,0.04)",
                    }} />
                  );
                })}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
                {["6AM", "9AM", "12PM", "3PM", "6PM", "9PM"].map(t => (
                  <span key={t} style={{ fontSize: 9, color: TEXT4 }}>{t}</span>
                ))}
              </div>
            </div>

            {/* Status Breakdown */}
            <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: "22px 20px" }}>
              <div style={{ fontSize: 14, fontWeight: 500, color: TEXT, letterSpacing: "-0.015em", marginBottom: 20 }}>Call Status</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {[
                  { label: "Completed", pct: 94, color: "rgba(255,255,255,0.18)" },
                  { label: "In Progress", pct: 3, color: "rgba(255,255,255,0.10)" },
                  { label: "Failed", pct: 3, color: "rgba(255,255,255,0.06)" },
                ].map(s => (
                  <div key={s.label}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                      <span style={{ fontSize: 11, color: TEXT3 }}>{s.label}</span>
                      <span style={{ fontSize: 11, fontWeight: 600, color: TEXT2 }}>{s.pct}%</span>
                    </div>
                    <div style={{ height: 3, borderRadius: 2, background: ELEVATED }}>
                      <div style={{ height: "100%", width: `${s.pct}%`, borderRadius: 2, background: s.color }} />
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 24, padding: "14px", background: ELEVATED, borderRadius: 9 }}>
                <div style={{ fontSize: 10, color: TEXT4, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.08em" }}>Total Today</div>
                <div style={{ fontSize: 24, fontWeight: 600, color: TEXT, letterSpacing: "-0.04em" }}>284</div>
              </div>
            </div>
          </div>

          {/* Agents */}
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, overflow: "hidden" }}>
            <div style={{ padding: "16px 22px", borderBottom: `1px solid ${BORDER}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 14, fontWeight: 500, color: TEXT, letterSpacing: "-0.015em" }}>Agents</span>
              <span style={{ fontSize: 11, color: TEXT3, cursor: "pointer" }}>View all →</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "2.5fr 1.5fr 80px 80px 60px", padding: "8px 22px", borderBottom: `1px solid ${BORDER}`, background: "#0F1319" }}>
              {["Name", "Stack", "Calls", "Success", "Status"].map(h => (
                <span key={h} style={{ fontSize: 9, fontWeight: 600, color: TEXT4, textTransform: "uppercase", letterSpacing: "0.09em" }}>{h}</span>
              ))}
            </div>
            {agents.map((a, i) => (
              <div key={a.name} style={{ display: "grid", gridTemplateColumns: "2.5fr 1.5fr 80px 80px 60px", padding: "13px 22px", borderBottom: i < agents.length - 1 ? `1px solid ${BORDER}` : "none", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: ELEVATED, border: `1px solid ${BORDER_MED}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: TEXT3 }}>{a.name[0]}</span>
                  </div>
                  <span style={{ fontWeight: 500, color: TEXT, fontSize: 13 }}>{a.name}</span>
                </div>
                <span style={{ fontSize: 11, color: TEXT4 }}>{a.provider}</span>
                <span style={{ fontSize: 13, color: TEXT2, fontWeight: 500 }}>{a.calls}</span>
                <span style={{ fontSize: 13, color: TEXT2, fontWeight: 500 }}>{a.success}%</span>
                <span style={{ fontSize: 10, padding: "3px 7px", borderRadius: 5, width: "fit-content", fontWeight: 500,
                  background: a.active ? "rgba(255,255,255,0.05)" : "transparent",
                  border: `1px solid ${a.active ? BORDER_MED : BORDER}`,
                  color: a.active ? TEXT2 : TEXT4,
                }}>{a.active ? "active" : "off"}</span>
              </div>
            ))}
          </div>

        </div>
      </main>

      {/* Right panel */}
      <aside style={{ width: 236, borderLeft: `1px solid ${BORDER}`, background: SIDEBAR, padding: "22px 16px", display: "flex", flexDirection: "column", gap: 16, flexShrink: 0 }}>

        {/* System */}
        <div>
          <div style={{ fontSize: 9, fontWeight: 600, color: TEXT4, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10 }}>System</div>
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 10, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "11px 13px", borderBottom: `1px solid ${BORDER}` }}>
              <div style={{ width: 5, height: 5, borderRadius: "50%", background: "rgba(255,255,255,0.2)", flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: TEXT2, fontWeight: 500 }}>All systems operational</span>
            </div>
            {[["P50 Latency", "320ms"], ["STT Accuracy", "97.2%"], ["TTS Chars", "41.2K"], ["Uptime", "99.98%"]].map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "8px 13px", borderBottom: `1px solid ${BORDER}` }}>
                <span style={{ fontSize: 11, color: TEXT4 }}>{k}</span>
                <span style={{ fontSize: 11, color: TEXT2, fontWeight: 500 }}>{v}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Calls */}
        <div>
          <div style={{ fontSize: 9, fontWeight: 600, color: TEXT4, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10 }}>Recent Calls</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {calls.map((c, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 12px", background: CARD, borderRadius: 9, border: `1px solid ${BORDER}` }}>
                <div style={{ width: 5, height: 5, borderRadius: "50%", flexShrink: 0,
                  background: c.status === "completed" ? "rgba(255,255,255,0.2)" : c.status === "failed" ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.14)",
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: TEXT2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.num}</div>
                  <div style={{ fontSize: 10, color: TEXT4 }}>{c.agent} · {c.dur}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Provider stack */}
        <div>
          <div style={{ fontSize: 9, fontWeight: 600, color: TEXT4, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10 }}>Provider Stack</div>
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 10, overflow: "hidden" }}>
            {[["STT", "Deepgram"], ["LLM", "GPT-4o"], ["TTS", "ElevenLabs"], ["Tel", "Twilio"]].map(([role, name], i, arr) => (
              <div key={role} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 13px", borderBottom: i < arr.length - 1 ? `1px solid ${BORDER}` : "none" }}>
                <span style={{ fontSize: 9, fontWeight: 600, color: TEXT4, textTransform: "uppercase", letterSpacing: "0.08em" }}>{role}</span>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 11, color: TEXT2 }}>{name}</span>
                  <div style={{ width: 4, height: 4, borderRadius: "50%", background: "rgba(255,255,255,0.18)" }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Wallet */}
        <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "14px" }}>
          <div style={{ fontSize: 9, fontWeight: 600, color: TEXT4, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 8 }}>Wallet</div>
          <div style={{ fontSize: 24, fontWeight: 600, color: TEXT, letterSpacing: "-0.04em" }}>$12.40</div>
          <div style={{ height: 2, borderRadius: 1, background: ELEVATED, marginTop: 10, marginBottom: 6 }}>
            <div style={{ height: "100%", width: "38%", borderRadius: 1, background: "rgba(255,255,255,0.15)" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontSize: 10, color: TEXT4 }}>$7.60 used</span>
            <span style={{ fontSize: 10, color: TEXT4 }}>$20 limit</span>
          </div>
          <div style={{ marginTop: 10, padding: "6px 10px", borderRadius: 6, background: ELEVATED, border: `1px solid ${BORDER_MED}`, color: TEXT3, fontSize: 11, fontWeight: 500, textAlign: "center", cursor: "pointer" }}>Add Credits</div>
        </div>

      </aside>
    </div>
  );
}
