import React, { useState } from "react";
import {
  Monitor, Users, Zap, CalendarDays, Brain, Phone,
  Key, Mic2, Webhook, Wallet, TrendingUp, ShieldCheck,
  Settings, Search, Bell, ArrowRight, ArrowUpRight, Layers,
} from "lucide-react";

const NAV = [
  { icon: Monitor, label: "Command Center", active: true },
  { icon: Users, label: "Agents" },
  { icon: Zap, label: "Campaigns" },
  { icon: CalendarDays, label: "Scheduling" },
  { icon: Brain, label: "Memory / CRM" },
  { icon: Phone, label: "Call Logs" },
];

const CONFIG_NAV = [
  { icon: Key, label: "Providers" },
  { icon: Mic2, label: "Voices" },
  { icon: Phone, label: "Phone Numbers" },
  { icon: ShieldCheck, label: "Verification" },
  { icon: Webhook, label: "Webhooks" },
  { icon: Wallet, label: "Wallet" },
  { icon: TrendingUp, label: "Usage" },
  { icon: Settings, label: "General" },
];

const AGENTS = [
  { name: "Sales Qualifier", status: "live", calls: 34, success: 96, model: "gpt-4o-mini" },
  { name: "Outbound Dialer", status: "live", calls: 21, success: 90, model: "deepseek-r1" },
  { name: "Support Triage",  status: "idle", calls: 0, success: 100, model: "claude-3.5" },
  { name: "Lead Nurture",    status: "live", calls: 12, success: 88, model: "gpt-4o" },
];

const CALLS = [
  { from: "+91 98400 12345", agent: "Sales Qualifier", dur: "3:12", ok: true },
  { from: "+91 80005 67890", agent: "Outbound Dialer",  dur: "1:44", ok: false },
  { from: "+91 70001 11223", agent: "Lead Nurture",     dur: "4:07", ok: true },
  { from: "+91 99800 33445", agent: "Sales Qualifier",  dur: "0:55", ok: false },
  { from: "+91 88002 55667", agent: "Support Triage",   dur: "2:28", ok: true },
];

// Sparkline data
const SPARK = [30, 55, 40, 70, 60, 85, 72, 90, 78, 95, 83, 100, 88, 76, 92];

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(...data);
  const points = data.map((v, i) => [
    (i / (data.length - 1)) * 140,
    40 - (v / max) * 36,
  ]);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p[0]},${p[1]}`).join(" ");
  return (
    <svg width="140" height="40" style={{ overflow: "visible" }}>
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={points[points.length - 1][0]} cy={points[points.length - 1][1]} r="3" fill={color} />
    </svg>
  );
}

export function ObsidianEditorial() {
  return (
    <div
      className="flex h-screen overflow-hidden"
      style={{
        background: "#000",
        color: "#e5e7eb",
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      {/* ── Sidebar ── */}
      <aside style={{
        width: 64,
        minWidth: 64,
        background: "#000",
        borderRight: "1px solid #1c1c1c",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "16px 0",
        gap: 4,
      }}>
        {/* Logo */}
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          background: "#fff",
          display: "flex", alignItems: "center", justifyContent: "center",
          marginBottom: 20,
        }}>
          <Layers size={18} style={{ color: "#000" }} />
        </div>

        {NAV.map(({ icon: Icon, active }) => (
          <div key={active?.toString()} className="flex items-center justify-center"
            style={{
              width: 36, height: 36, borderRadius: 8, cursor: "pointer",
              background: active ? "#fff" : "transparent",
              color: active ? "#000" : "#333",
            }}>
            <Icon size={16} />
          </div>
        ))}

        <div style={{ flex: 1 }} />
        <div style={{ width: 28, height: 1, background: "#1c1c1c", margin: "8px 0" }} />

        {CONFIG_NAV.slice(0, 4).map(({ icon: Icon }) => (
          <div key={Math.random()} className="flex items-center justify-center"
            style={{ width: 36, height: 36, borderRadius: 8, cursor: "pointer", color: "#2a2a2a" }}>
            <Icon size={15} />
          </div>
        ))}

        {/* User avatar */}
        <div style={{
          width: 30, height: 30, borderRadius: "50%",
          border: "1px solid #1c1c1c",
          display: "flex", alignItems: "center", justifyContent: "center",
          marginTop: 12,
          cursor: "pointer",
        }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "#f59e0b" }}>S</span>
        </div>
      </aside>

      {/* ── Main ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* Header */}
        <header style={{
          display: "flex", alignItems: "flex-end", justifyContent: "space-between",
          padding: "20px 32px 14px",
          borderBottom: "1px solid #111",
        }}>
          <div>
            <div style={{
              color: "#333", fontSize: 10, fontWeight: 600,
              letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 4,
            }}>
              VoiceOrch / Command Center
            </div>
            <h1 style={{
              color: "#fff", fontSize: 28, fontWeight: 800,
              letterSpacing: "-0.04em", lineHeight: 1,
            }}>
              Live Overview
            </h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              background: "#0a0a0a", border: "1px solid #1c1c1c",
              borderRadius: 8, padding: "6px 12px",
            }}>
              <Search size={12} style={{ color: "#333" }} />
              <span style={{ color: "#2a2a2a", fontSize: 12 }}>Search…</span>
            </div>
            <div style={{
              width: 32, height: 32,
              background: "#0a0a0a", border: "1px solid #1c1c1c",
              borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer",
            }}>
              <Bell size={14} style={{ color: "#333" }} />
            </div>
            <div style={{
              display: "flex", alignItems: "center", gap: 6,
              background: "#f59e0b",
              borderRadius: 8, padding: "6px 14px", cursor: "pointer",
            }}>
              <span style={{ color: "#000", fontSize: 12, fontWeight: 700 }}>New Agent</span>
            </div>
          </div>
        </header>

        {/* Content */}
        <main style={{ flex: 1, overflowY: "auto", padding: "24px 32px", background: "#000" }}>

          {/* Top metrics row — editorial big numbers */}
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
            borderBottom: "1px solid #111",
            marginBottom: 28,
          }}>
            {[
              { label: "Agents", val: "12", delta: "+2", note: "3 live" },
              { label: "Calls Today", val: "847", delta: "↑18%", note: "vs yesterday" },
              { label: "Success Rate", val: "94%", delta: "+1.3pt", note: "last 7d" },
              { label: "Avg Duration", val: "2:41", delta: "−8s", note: "this week" },
            ].map((m, i) => (
              <div key={m.label} style={{
                padding: "0 24px 20px",
                borderLeft: i > 0 ? "1px solid #111" : "none",
              }}>
                <div style={{
                  color: "#2a2a2a", fontSize: 10,
                  letterSpacing: "0.1em", textTransform: "uppercase",
                  marginBottom: 6,
                }}>
                  {m.label}
                </div>
                <div style={{
                  display: "flex", alignItems: "baseline", gap: 8,
                }}>
                  <span style={{
                    color: "#fff", fontSize: 36,
                    fontWeight: 800, letterSpacing: "-0.05em", lineHeight: 1,
                  }}>
                    {m.val}
                  </span>
                  <span style={{
                    fontSize: 12, fontWeight: 600,
                    color: m.delta.startsWith("+") || m.delta.startsWith("↑") ? "#22c55e" : "#ef4444",
                  }}>
                    {m.delta}
                  </span>
                </div>
                <div style={{ color: "#2a2a2a", fontSize: 11, marginTop: 4 }}>{m.note}</div>
              </div>
            ))}
          </div>

          {/* Two columns */}
          <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 32 }}>

            {/* Left: call log + sparkline */}
            <div>
              {/* Sparkline header */}
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                marginBottom: 12,
              }}>
                <span style={{
                  color: "#333", fontSize: 10,
                  letterSpacing: "0.1em", textTransform: "uppercase",
                }}>
                  Call Volume · 24H
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#f59e0b", display: "inline-block" }} />
                  <span style={{ color: "#333", fontSize: 10 }}>847 calls</span>
                </div>
              </div>
              <div style={{ marginBottom: 24 }}>
                <Sparkline data={SPARK} color="#f59e0b" />
              </div>

              {/* Call log */}
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                marginBottom: 10,
              }}>
                <span style={{
                  color: "#333", fontSize: 10,
                  letterSpacing: "0.1em", textTransform: "uppercase",
                }}>
                  Recent Calls
                </span>
                <span style={{ color: "#2a2a2a", fontSize: 11, cursor: "pointer" }}>
                  All logs <ArrowRight size={10} style={{ display: "inline" }} />
                </span>
              </div>

              {CALLS.map((c, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center",
                  borderBottom: "1px solid #0d0d0d",
                  padding: "10px 0", gap: 12,
                }}>
                  {/* Status bar */}
                  <div style={{
                    width: 3, height: 32, borderRadius: 2, flexShrink: 0,
                    background: c.ok ? "#22c55e" : "#1c1c1c",
                  }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ color: "#9ca3af", fontSize: 12, fontWeight: 500 }}>{c.from}</div>
                    <div style={{ color: "#374151", fontSize: 11, marginTop: 1 }}>{c.agent}</div>
                  </div>
                  <span style={{ color: "#2a2a2a", fontSize: 11 }}>{c.dur}</span>
                  <span style={{
                    fontSize: 10, fontWeight: 700,
                    letterSpacing: "0.06em",
                    color: c.ok ? "#22c55e" : "#ef4444",
                  }}>
                    {c.ok ? "OK" : "FAIL"}
                  </span>
                </div>
              ))}
            </div>

            {/* Right: agents */}
            <div>
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                marginBottom: 16,
              }}>
                <span style={{
                  color: "#333", fontSize: 10,
                  letterSpacing: "0.1em", textTransform: "uppercase",
                }}>
                  Agents
                </span>
                <span style={{
                  color: "#000", background: "#f59e0b",
                  fontSize: 10, fontWeight: 700,
                  padding: "2px 8px", borderRadius: 4, cursor: "pointer",
                }}>
                  + New
                </span>
              </div>

              {AGENTS.map((a) => (
                <div key={a.name} style={{
                  padding: "14px 0",
                  borderBottom: "1px solid #0d0d0d",
                }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{
                        width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                        background: a.status === "live" ? "#22c55e"
                          : a.status === "idle" ? "#f59e0b" : "#1c1c1c",
                      }} />
                      <span style={{ color: "#e5e7eb", fontSize: 13, fontWeight: 600 }}>{a.name}</span>
                    </div>
                    <ArrowUpRight size={13} style={{ color: "#2a2a2a", cursor: "pointer" }} />
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 18 }}>
                    <span style={{
                      fontSize: 10, color: "#1f2937",
                      background: "#0a0a0a", border: "1px solid #1c1c1c",
                      borderRadius: 4, padding: "1px 6px",
                    }}>
                      {a.model}
                    </span>
                    <span style={{ color: "#2a2a2a", fontSize: 11 }}>{a.calls} calls</span>
                    <span style={{ color: "#374151", fontSize: 10, marginLeft: "auto" }}>
                      {a.success}% success
                    </span>
                  </div>

                  {/* Progress bar */}
                  <div style={{
                    marginTop: 8, marginLeft: 18,
                    height: 2, background: "#0d0d0d", borderRadius: 1, overflow: "hidden",
                  }}>
                    <div style={{
                      height: "100%", width: `${a.success}%`,
                      background: a.success >= 90 ? "#22c55e" : "#f59e0b",
                      borderRadius: 1,
                    }} />
                  </div>
                </div>
              ))}

              {/* Balance card */}
              <div style={{
                marginTop: 20,
                background: "#0a0a0a",
                border: "1px solid #1c1c1c",
                borderRadius: 10,
                padding: "14px 16px",
                display: "flex", alignItems: "center", justifyContent: "space-between",
              }}>
                <div>
                  <div style={{ color: "#2a2a2a", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase" }}>Wallet</div>
                  <div style={{ color: "#fff", fontSize: 20, fontWeight: 800, letterSpacing: "-0.03em" }}>$5.00</div>
                </div>
                <div style={{
                  background: "#f59e0b", borderRadius: 6, padding: "6px 12px", cursor: "pointer",
                }}>
                  <span style={{ color: "#000", fontSize: 11, fontWeight: 700 }}>Top Up</span>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
