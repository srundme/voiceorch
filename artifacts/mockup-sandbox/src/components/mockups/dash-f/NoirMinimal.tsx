import React, { useState } from "react";
import {
  Monitor, Users, Zap, CalendarDays, Brain, Phone,
  Key, Mic2, Webhook, Wallet, TrendingUp, ShieldCheck,
  Settings, Search, Bell, MoreHorizontal, ChevronDown,
  TrendingDown, Activity, Layers,
} from "lucide-react";

const NAV_ITEMS = [
  { icon: Monitor, label: "Command Center", href: "command-center", active: true },
  { icon: Users, label: "Agents", href: "agents", badge: "12" },
  { icon: Zap, label: "Campaigns", href: "campaigns" },
  { icon: CalendarDays, label: "Scheduling", href: "scheduling" },
  { icon: Brain, label: "Memory / CRM", href: "memory" },
  { icon: Phone, label: "Call Logs", href: "calls" },
];

const SETTINGS_ITEMS = [
  { icon: Key, label: "Providers" },
  { icon: Mic2, label: "Voices" },
  { icon: Phone, label: "Phone Numbers" },
  { icon: ShieldCheck, label: "Verification" },
  { icon: Webhook, label: "Webhooks" },
  { icon: Wallet, label: "Wallet" },
  { icon: TrendingUp, label: "Usage" },
  { icon: Settings, label: "General" },
];

const STATS = [
  { label: "Active Agents", val: "12", change: "+2 this week", pos: true, icon: Users },
  { label: "Calls Today", val: "847", change: "↑ 18% vs yesterday", pos: true, icon: Phone },
  { label: "Success Rate", val: "94.2%", change: "↑ 1.3 pts", pos: true, icon: Activity },
  { label: "Avg Duration", val: "2:41", change: "↓ 8s this week", pos: false, icon: TrendingDown },
];

const AGENTS = [
  { name: "Sales Qualifier", status: "live", calls: 34, success: 96, model: "gpt-4o" },
  { name: "Outbound Dialer", status: "live", calls: 21, success: 90, model: "deepseek" },
  { name: "Support Triage",  status: "idle", calls: 0,  success: 100, model: "claude-3" },
  { name: "Lead Nurture",    status: "live", calls: 12, success: 88, model: "gpt-4o" },
  { name: "Appointment Set", status: "off",  calls: 0,  success: 92, model: "mistral" },
];

const RECENT = [
  { from: "+91 98400 12345", agent: "Sales Qualifier",  when: "2m ago",  status: "success", dur: "3:12" },
  { from: "+91 80005 67890", agent: "Outbound Dialer",  when: "4m ago",  status: "failed",  dur: "1:44" },
  { from: "+91 70001 11223", agent: "Lead Nurture",     when: "7m ago",  status: "success", dur: "4:07" },
  { from: "+91 99800 33445", agent: "Sales Qualifier",  when: "9m ago",  status: "dropped", dur: "0:55" },
];

function Donut({ pct }: { pct: number }) {
  const r = 22, c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;
  return (
    <svg width="52" height="52" style={{ transform: "rotate(-90deg)" }}>
      <circle cx="26" cy="26" r={r} fill="none" stroke="#111" strokeWidth="4" />
      <circle cx="26" cy="26" r={r} fill="none" stroke="#818cf8" strokeWidth="4"
        strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round" />
    </svg>
  );
}

export function NoirMinimal() {
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div
      className="flex h-screen overflow-hidden"
      style={{
        background: "#060609",
        color: "#d1d5db",
        fontFamily: "'Inter', 'SF Pro Display', system-ui, sans-serif",
        fontSize: 13,
      }}
    >
      {/* ── Sidebar ── */}
      <aside style={{
        width: 220,
        minWidth: 220,
        background: "#07070b",
        borderRight: "1px solid rgba(255,255,255,0.04)",
        display: "flex",
        flexDirection: "column",
      }}>
        {/* Logo */}
        <div style={{
          padding: "18px 16px 14px",
          borderBottom: "1px solid rgba(255,255,255,0.04)",
        }}>
          <div className="flex items-center gap-2.5">
            <div style={{
              width: 28, height: 28, borderRadius: 8,
              background: "linear-gradient(135deg, #818cf8 0%, #6366f1 100%)",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 0 12px rgba(129,140,248,0.3)",
            }}>
              <Layers size={14} style={{ color: "#fff" }} />
            </div>
            <div>
              <div style={{ color: "#fff", fontWeight: 600, fontSize: 13, letterSpacing: "-0.01em" }}>VoiceOrch</div>
              <div style={{ color: "#374151", fontSize: 10 }}>v2.4.1</div>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, overflowY: "auto", padding: "12px 8px" }}>
          {NAV_ITEMS.map(({ icon: Icon, label, active, badge }) => (
            <div
              key={label}
              className="flex items-center justify-between px-3 py-2 rounded-lg mb-0.5 cursor-pointer group"
              style={{
                background: active ? "rgba(129,140,248,0.12)" : "transparent",
                color: active ? "#a5b4fc" : "#4b5563",
              }}
            >
              <div className="flex items-center gap-2.5">
                <Icon size={15} />
                <span style={{ fontSize: 13, fontWeight: active ? 500 : 400 }}>{label}</span>
              </div>
              {badge && (
                <span style={{
                  fontSize: 10, background: "rgba(129,140,248,0.15)",
                  color: "#818cf8", borderRadius: 10, padding: "1px 6px",
                }}>
                  {badge}
                </span>
              )}
            </div>
          ))}

          {/* Settings dropdown */}
          <div
            className="flex items-center justify-between px-3 py-2 rounded-lg mt-3 cursor-pointer"
            style={{ color: "#374151" }}
            onClick={() => setSettingsOpen(!settingsOpen)}
          >
            <div className="flex items-center gap-2.5">
              <Settings size={15} />
              <span style={{ fontSize: 13 }}>Settings</span>
            </div>
            <ChevronDown size={13} style={{
              transform: settingsOpen ? "rotate(180deg)" : "rotate(0)",
              transition: "0.2s",
            }} />
          </div>
          {settingsOpen && SETTINGS_ITEMS.map(({ icon: Icon, label }) => (
            <div
              key={label}
              className="flex items-center gap-2.5 px-3 py-1.5 cursor-pointer"
              style={{ color: "#374151", paddingLeft: 36 }}
            >
              <Icon size={12} />
              <span style={{ fontSize: 12 }}>{label}</span>
            </div>
          ))}
        </nav>

        {/* User */}
        <div style={{
          padding: "12px 14px",
          borderTop: "1px solid rgba(255,255,255,0.04)",
        }}>
          <div className="flex items-center gap-2.5">
            <div style={{
              width: 28, height: 28, borderRadius: "50%",
              background: "linear-gradient(135deg, #1f2937 0%, #111827 100%)",
              border: "1px solid rgba(255,255,255,0.08)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <span style={{ color: "#818cf8", fontSize: 11, fontWeight: 600 }}>S</span>
            </div>
            <div>
              <div style={{ color: "#9ca3af", fontSize: 12, fontWeight: 500 }}>SnapServe</div>
              <div style={{ color: "#374151", fontSize: 10 }}>$5.00 balance</div>
            </div>
          </div>
        </div>
      </aside>

      {/* ── Main ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Topbar */}
        <header style={{
          height: 56,
          display: "flex",
          alignItems: "center",
          padding: "0 24px",
          gap: 16,
          borderBottom: "1px solid rgba(255,255,255,0.04)",
          background: "#060609",
        }}>
          <div>
            <div style={{ color: "#fff", fontWeight: 600, fontSize: 16, letterSpacing: "-0.02em" }}>
              Command Center
            </div>
            <div style={{ color: "#374151", fontSize: 11 }}>Live overview · updated just now</div>
          </div>
          <div style={{ flex: 1 }} />
          {/* Search */}
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            background: "#0d0d12", border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 10, padding: "7px 12px", width: 200,
          }}>
            <Search size={13} style={{ color: "#374151" }} />
            <span style={{ color: "#1f2937", fontSize: 12 }}>Quick find…</span>
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 3 }}>
              <span style={{
                fontSize: 9, color: "#374151", background: "#111116",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 4, padding: "1px 4px",
              }}>⌘K</span>
            </div>
          </div>
          <div style={{
            width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center",
            background: "#0d0d12", border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 8, cursor: "pointer", position: "relative",
          }}>
            <Bell size={14} style={{ color: "#4b5563" }} />
            <span style={{
              position: "absolute", top: 6, right: 6,
              width: 5, height: 5, background: "#818cf8",
              borderRadius: "50%", border: "1px solid #060609",
            }} />
          </div>
        </header>

        {/* Body */}
        <main style={{ flex: 1, overflowY: "auto", padding: 24, background: "#060609" }}>

          {/* Stats */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 20 }}>
            {STATS.map((s) => (
              <div key={s.label} style={{
                background: "#09090e",
                border: "1px solid rgba(255,255,255,0.05)",
                borderRadius: 14,
                padding: "16px 18px",
              }}>
                <div style={{ color: "#374151", fontSize: 11, marginBottom: 10 }}>{s.label}</div>
                <div style={{ color: "#f9fafb", fontSize: 26, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1 }}>
                  {s.val}
                </div>
                <div style={{
                  marginTop: 8, fontSize: 11,
                  color: s.pos ? "#6ee7b7" : "#fca5a5",
                }}>
                  {s.change}
                </div>
              </div>
            ))}
          </div>

          {/* Middle row */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 20 }}>
            {/* Agents table */}
            <div style={{
              background: "#09090e",
              border: "1px solid rgba(255,255,255,0.05)",
              borderRadius: 14,
              overflow: "hidden",
            }}>
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "14px 18px",
                borderBottom: "1px solid rgba(255,255,255,0.04)",
              }}>
                <span style={{ color: "#9ca3af", fontSize: 12, fontWeight: 500 }}>Agents</span>
                <MoreHorizontal size={14} style={{ color: "#374151" }} />
              </div>
              <div style={{ padding: "8px 0" }}>
                {AGENTS.map((a) => (
                  <div key={a.name} style={{
                    display: "flex", alignItems: "center",
                    padding: "8px 18px", gap: 10,
                  }}>
                    <span style={{
                      width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                      background: a.status === "live" ? "#6ee7b7"
                        : a.status === "idle" ? "#fbbf24" : "#1f2937",
                      boxShadow: a.status === "live" ? "0 0 6px rgba(110,231,183,0.5)" : "none",
                    }} />
                    <span style={{ flex: 1, color: "#9ca3af", fontSize: 12 }}>{a.name}</span>
                    <span style={{ color: "#374151", fontSize: 11 }}>{a.calls} calls</span>
                    <span style={{
                      fontSize: 11, color: "#818cf8",
                      background: "rgba(129,140,248,0.08)",
                      borderRadius: 4, padding: "1px 6px",
                    }}>{a.success}%</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Donut + metrics */}
            <div style={{
              background: "#09090e",
              border: "1px solid rgba(255,255,255,0.05)",
              borderRadius: 14,
              padding: "16px 18px",
            }}>
              <div style={{ color: "#9ca3af", fontSize: 12, fontWeight: 500, marginBottom: 16 }}>Call Outcomes</div>
              <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
                <div style={{ position: "relative" }}>
                  <Donut pct={94} />
                  <div style={{
                    position: "absolute", inset: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexDirection: "column",
                  }}>
                    <span style={{ color: "#fff", fontSize: 14, fontWeight: 700, lineHeight: 1 }}>94%</span>
                  </div>
                </div>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
                  {[
                    { label: "Success", pct: 94, color: "#818cf8" },
                    { label: "Failed", pct: 4, color: "#374151" },
                    { label: "Dropped", pct: 2, color: "#1f2937" },
                  ].map(r => (
                    <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 6, height: 6, borderRadius: 2, background: r.color, flexShrink: 0 }} />
                      <span style={{ flex: 1, color: "#4b5563", fontSize: 11 }}>{r.label}</span>
                      <span style={{ color: "#6b7280", fontSize: 11 }}>{r.pct}%</span>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{
                marginTop: 16, paddingTop: 14,
                borderTop: "1px solid rgba(255,255,255,0.04)",
                display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10,
              }}>
                {[
                  { label: "Total calls", val: "847" },
                  { label: "Avg duration", val: "2m 41s" },
                  { label: "Escalations", val: "23" },
                  { label: "Recordings", val: "801" },
                ].map(m => (
                  <div key={m.label}>
                    <div style={{ color: "#1f2937", fontSize: 10 }}>{m.label}</div>
                    <div style={{ color: "#9ca3af", fontSize: 14, fontWeight: 600 }}>{m.val}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Recent calls */}
          <div style={{
            background: "#09090e",
            border: "1px solid rgba(255,255,255,0.05)",
            borderRadius: 14,
            overflow: "hidden",
          }}>
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "14px 18px",
              borderBottom: "1px solid rgba(255,255,255,0.04)",
            }}>
              <span style={{ color: "#9ca3af", fontSize: 12, fontWeight: 500 }}>Recent Calls</span>
              <span style={{ color: "#4b5563", fontSize: 11, cursor: "pointer" }}>View all</span>
            </div>
            <div>
              {RECENT.map((c, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center",
                  padding: "10px 18px", gap: 12,
                  borderBottom: i < RECENT.length - 1 ? "1px solid rgba(255,255,255,0.03)" : "none",
                }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ color: "#9ca3af", fontSize: 12 }}>{c.from}</div>
                    <div style={{ color: "#374151", fontSize: 11, marginTop: 1 }}>{c.agent}</div>
                  </div>
                  <span style={{ color: "#374151", fontSize: 11 }}>{c.when}</span>
                  <span style={{ color: "#4b5563", fontSize: 11, width: 36, textAlign: "right" }}>{c.dur}</span>
                  <span style={{
                    fontSize: 11, borderRadius: 6, padding: "2px 8px",
                    background: c.status === "success" ? "rgba(110,231,183,0.08)"
                      : c.status === "failed" ? "rgba(252,165,165,0.08)"
                      : "rgba(251,191,36,0.08)",
                    color: c.status === "success" ? "#6ee7b7"
                      : c.status === "failed" ? "#fca5a5"
                      : "#fbbf24",
                    textTransform: "capitalize",
                  }}>
                    {c.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
