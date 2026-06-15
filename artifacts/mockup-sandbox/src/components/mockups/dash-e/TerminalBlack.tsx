import React, { useState } from "react";
import {
  Monitor, Users, Zap, CalendarDays, Brain, Phone,
  Key, Mic2, Webhook, Wallet, TrendingUp, ShieldCheck,
  Settings, Search, Bell, ChevronRight, Activity,
  ArrowUpRight, ArrowDownRight, Circle, BarChart3,
} from "lucide-react";

const NAV = [
  { icon: Monitor, label: "Command Center", active: true },
  { icon: Users, label: "Agents" },
  { icon: Zap, label: "Campaigns" },
  { icon: CalendarDays, label: "Scheduling" },
  { icon: Brain, label: "Memory / CRM" },
  { icon: Phone, label: "Call Logs" },
];

const SETTINGS = [
  { icon: Key, label: "Providers" },
  { icon: Mic2, label: "Voices" },
  { icon: Phone, label: "Phone Numbers" },
  { icon: ShieldCheck, label: "Verification" },
  { icon: Webhook, label: "Webhooks" },
  { icon: Wallet, label: "Wallet" },
  { icon: TrendingUp, label: "Usage" },
  { icon: Settings, label: "General" },
];

const KPIs = [
  { label: "ACTIVE AGENTS", value: "12", delta: "+2", up: true, sub: "3 live now" },
  { label: "CALLS TODAY", value: "847", delta: "+18%", up: true, sub: "vs yesterday" },
  { label: "SUCCESS RATE", value: "94.2%", delta: "+1.3%", up: true, sub: "last 7 days" },
  { label: "AVG DURATION", value: "2m 41s", delta: "-8s", up: false, sub: "this week" },
];

const LIVE = [
  { id: "AGT-001", name: "Sales Qualifier", status: "LIVE", calls: 34, ok: 96 },
  { id: "AGT-002", name: "Outbound Dialer", status: "LIVE", calls: 21, ok: 90 },
  { id: "AGT-004", name: "Support Triage", status: "IDLE", calls: 0, ok: 100 },
  { id: "AGT-007", name: "Lead Nurture", status: "LIVE", calls: 12, ok: 88 },
];

const CALLS = [
  { num: "+91 98400 12345", agent: "Sales Qualifier", dur: "3m 12s", status: "SUCCESS" },
  { num: "+91 80005 67890", agent: "Outbound Dialer", dur: "1m 44s", status: "FAILED" },
  { num: "+91 70001 11223", agent: "Lead Nurture",    dur: "4m 07s", status: "SUCCESS" },
  { num: "+91 99800 33445", agent: "Sales Qualifier", dur: "0m 55s", status: "DROPPED" },
  { num: "+91 88002 55667", agent: "Support Triage",  dur: "2m 28s", status: "SUCCESS" },
];

const BAR_DATA = [42, 58, 71, 55, 88, 94, 76, 63, 81, 90, 68, 84, 77, 65, 92, 87, 74, 83, 96, 70, 85, 62, 79, 88];

function MiniBar({ data }: { data: number[] }) {
  const max = Math.max(...data);
  return (
    <div className="flex items-end gap-[2px] h-16">
      {data.map((v, i) => (
        <div
          key={i}
          className="flex-1 rounded-sm"
          style={{
            height: `${(v / max) * 100}%`,
            background: i === data.length - 1
              ? "#22c55e"
              : `rgba(34,197,94,${0.15 + (v / max) * 0.35})`,
          }}
        />
      ))}
    </div>
  );
}

export function TerminalBlack() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div
      className="flex h-screen overflow-hidden text-xs select-none"
      style={{ background: "#000", color: "#e4e4e7", fontFamily: "'JetBrains Mono', 'Fira Code', ui-monospace, monospace" }}
    >
      {/* ── Sidebar ── */}
      <aside
        style={{
          width: collapsed ? 48 : 200,
          minWidth: collapsed ? 48 : 200,
          background: "#080808",
          borderRight: "1px solid #1a1a1a",
          transition: "width 0.18s ease",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Logo */}
        <div
          className="flex items-center gap-2 px-3 py-4"
          style={{ borderBottom: "1px solid #1a1a1a", minHeight: 52 }}
        >
          <div className="w-6 h-6 rounded flex items-center justify-center flex-shrink-0"
            style={{ background: "#22c55e", boxShadow: "0 0 8px rgba(34,197,94,0.5)" }}>
            <span style={{ color: "#000", fontWeight: 900, fontSize: 11 }}>V</span>
          </div>
          {!collapsed && (
            <span style={{ color: "#fff", fontWeight: 700, fontSize: 12, letterSpacing: "0.04em" }}>
              VOICEORCH
            </span>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 overflow-auto">
          <div className="px-2 mb-2">
            {!collapsed && (
              <span style={{ color: "#444", fontSize: 9, letterSpacing: "0.1em" }}>MAIN</span>
            )}
          </div>
          {NAV.map(({ icon: Icon, label, active }) => (
            <div
              key={label}
              className="flex items-center gap-2 px-2 py-[7px] mx-1 rounded cursor-pointer mb-[2px]"
              style={{
                background: active ? "rgba(34,197,94,0.1)" : "transparent",
                borderLeft: active ? "2px solid #22c55e" : "2px solid transparent",
                color: active ? "#22c55e" : "#666",
              }}
            >
              <Icon size={13} />
              {!collapsed && <span style={{ fontSize: 11 }}>{label}</span>}
            </div>
          ))}

          <div className="px-2 mt-4 mb-2">
            {!collapsed && (
              <span style={{ color: "#444", fontSize: 9, letterSpacing: "0.1em" }}>CONFIG</span>
            )}
          </div>
          {SETTINGS.map(({ icon: Icon, label }) => (
            <div
              key={label}
              className="flex items-center gap-2 px-2 py-[6px] mx-1 rounded cursor-pointer mb-[2px]"
              style={{ color: "#555", borderLeft: "2px solid transparent" }}
            >
              <Icon size={12} />
              {!collapsed && <span style={{ fontSize: 11 }}>{label}</span>}
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div
          className="flex items-center gap-2 px-3 py-3"
          style={{ borderTop: "1px solid #1a1a1a" }}
        >
          <div className="w-5 h-5 rounded-sm flex items-center justify-center flex-shrink-0"
            style={{ background: "#1a1a1a", border: "1px solid #2a2a2a" }}>
            <span style={{ color: "#22c55e", fontSize: 9, fontWeight: 700 }}>S</span>
          </div>
          {!collapsed && (
            <div className="flex flex-col">
              <span style={{ color: "#ccc", fontSize: 10 }}>snapserve</span>
              <span style={{ color: "#444", fontSize: 9 }}>$5.00 bal</span>
            </div>
          )}
        </div>
      </aside>

      {/* ── Main ── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Topbar */}
        <header
          className="flex items-center gap-3 px-4"
          style={{
            height: 48,
            borderBottom: "1px solid #1a1a1a",
            background: "#000",
          }}
        >
          <button onClick={() => setCollapsed(!collapsed)}
            style={{ color: "#444", cursor: "pointer", padding: 4, lineHeight: 0 }}>
            <ChevronRight size={14} style={{ transform: collapsed ? "rotate(0)" : "rotate(180deg)", transition: "0.2s" }} />
          </button>

          <div className="flex items-center gap-1" style={{ color: "#444", fontSize: 10 }}>
            <span>~</span>
            <span style={{ color: "#22c55e" }}>/command-center</span>
          </div>

          <div className="flex-1" />

          {/* Search */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded"
            style={{ background: "#0d0d0d", border: "1px solid #1f1f1f", width: 180 }}>
            <Search size={11} style={{ color: "#444" }} />
            <span style={{ color: "#333", fontSize: 11 }}>search...</span>
          </div>

          <Bell size={14} style={{ color: "#444" }} />

          {/* Status */}
          <div className="flex items-center gap-1.5">
            <span style={{ color: "#22c55e", fontSize: 9 }}>●</span>
            <span style={{ color: "#555", fontSize: 10 }}>LIVE · 3 agents</span>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-auto p-4" style={{ background: "#000" }}>

          {/* KPI row */}
          <div className="grid grid-cols-4 gap-3 mb-4">
            {KPIs.map((k) => (
              <div key={k.label} className="rounded-md p-3"
                style={{ background: "#080808", border: "1px solid #1a1a1a" }}>
                <div className="flex items-center justify-between mb-2">
                  <span style={{ color: "#444", fontSize: 9, letterSpacing: "0.08em" }}>{k.label}</span>
                  <span
                    style={{
                      color: k.up ? "#22c55e" : "#ef4444",
                      fontSize: 9,
                      display: "flex",
                      alignItems: "center",
                      gap: 1,
                    }}
                  >
                    {k.up ? <ArrowUpRight size={9} /> : <ArrowDownRight size={9} />}
                    {k.delta}
                  </span>
                </div>
                <div style={{ color: "#fff", fontSize: 22, fontWeight: 700, lineHeight: 1 }}>{k.value}</div>
                <div style={{ color: "#444", fontSize: 9, marginTop: 4 }}>{k.sub}</div>
              </div>
            ))}
          </div>

          {/* Chart + Live agents */}
          <div className="grid grid-cols-3 gap-3 mb-4">
            {/* Bar chart */}
            <div className="col-span-2 rounded-md p-4"
              style={{ background: "#080808", border: "1px solid #1a1a1a" }}>
              <div className="flex items-center justify-between mb-3">
                <span style={{ color: "#666", fontSize: 10, letterSpacing: "0.06em" }}>CALL VOLUME · 24H</span>
                <div className="flex items-center gap-1">
                  <span style={{ color: "#22c55e", fontSize: 9 }}>●</span>
                  <span style={{ color: "#444", fontSize: 9 }}>847 total</span>
                </div>
              </div>
              <MiniBar data={BAR_DATA} />
              <div className="flex justify-between mt-2">
                {["00:00", "06:00", "12:00", "18:00", "now"].map(t => (
                  <span key={t} style={{ color: "#333", fontSize: 9 }}>{t}</span>
                ))}
              </div>
            </div>

            {/* Live agents */}
            <div className="rounded-md p-3" style={{ background: "#080808", border: "1px solid #1a1a1a" }}>
              <div className="flex items-center justify-between mb-3">
                <span style={{ color: "#666", fontSize: 10, letterSpacing: "0.06em" }}>LIVE AGENTS</span>
                <Activity size={11} style={{ color: "#444" }} />
              </div>
              <div className="flex flex-col gap-2">
                {LIVE.map((a) => (
                  <div key={a.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span style={{
                        width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                        background: a.status === "LIVE" ? "#22c55e" : "#2a2a2a",
                        boxShadow: a.status === "LIVE" ? "0 0 6px #22c55e" : "none",
                        display: "inline-block",
                      }} />
                      <span style={{ color: a.status === "LIVE" ? "#ccc" : "#444", fontSize: 10 }}>{a.name}</span>
                    </div>
                    <span style={{ color: "#444", fontSize: 9 }}>{a.calls} calls</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Call log */}
          <div className="rounded-md" style={{ background: "#080808", border: "1px solid #1a1a1a" }}>
            <div className="flex items-center justify-between px-4 py-3"
              style={{ borderBottom: "1px solid #111" }}>
              <span style={{ color: "#666", fontSize: 10, letterSpacing: "0.06em" }}>RECENT CALLS</span>
              <span style={{ color: "#333", fontSize: 9, cursor: "pointer" }}>VIEW ALL →</span>
            </div>
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: "1px solid #111" }}>
                  {["NUMBER", "AGENT", "DURATION", "STATUS"].map(h => (
                    <th key={h} className="px-4 py-2 text-left"
                      style={{ color: "#333", fontSize: 9, letterSpacing: "0.08em", fontWeight: 400 }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {CALLS.map((c, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #0d0d0d" }}>
                    <td className="px-4 py-2" style={{ color: "#888", fontSize: 10 }}>{c.num}</td>
                    <td className="px-4 py-2" style={{ color: "#666", fontSize: 10 }}>{c.agent}</td>
                    <td className="px-4 py-2" style={{ color: "#666", fontSize: 10 }}>{c.dur}</td>
                    <td className="px-4 py-2">
                      <span style={{
                        fontSize: 9,
                        padding: "2px 6px",
                        borderRadius: 2,
                        letterSpacing: "0.06em",
                        background: c.status === "SUCCESS" ? "rgba(34,197,94,0.1)"
                          : c.status === "FAILED" ? "rgba(239,68,68,0.1)"
                          : "rgba(245,158,11,0.1)",
                        color: c.status === "SUCCESS" ? "#22c55e"
                          : c.status === "FAILED" ? "#ef4444"
                          : "#f59e0b",
                        border: `1px solid ${c.status === "SUCCESS" ? "rgba(34,197,94,0.2)"
                          : c.status === "FAILED" ? "rgba(239,68,68,0.2)"
                          : "rgba(245,158,11,0.2)"}`,
                      }}>
                        {c.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </main>
      </div>
    </div>
  );
}
