import {
  Bot, Phone, MessageCircle, BookOpen, Mic, BrainCircuit, PhoneCall,
  Megaphone, BarChart3, KeyRound, Webhook, FileCode2, Wallet, Users,
  Search, Bell, ChevronRight, CircleDot, Plus, ArrowUpRight, AlertTriangle,
  LayoutGrid, Settings,
} from "lucide-react";

const nav = [
  { group: "", items: [{ icon: LayoutGrid, label: "Home", active: true }] },
  {
    group: "BUILD",
    items: [
      { icon: Bot, label: "Agents", badge: "4" },
      { icon: BookOpen, label: "Knowledge" },
      { icon: Mic, label: "Voices & Languages" },
      { icon: BrainCircuit, label: "Intelligence" },
    ],
  },
  {
    group: "CONNECT",
    items: [
      { icon: Phone, label: "Phone Numbers", badge: "2" },
      { icon: MessageCircle, label: "WhatsApp" },
      { icon: Settings, label: "Integrations" },
    ],
  },
  {
    group: "OPERATE",
    items: [
      { icon: PhoneCall, label: "Calls" },
      { icon: Megaphone, label: "Campaigns", badge: "1" },
      { icon: BarChart3, label: "Analytics" },
    ],
  },
  {
    group: "DEVELOPERS",
    items: [
      { icon: KeyRound, label: "API Keys" },
      { icon: Webhook, label: "Webhooks" },
      { icon: FileCode2, label: "API Docs" },
    ],
  },
  {
    group: "ACCOUNT",
    items: [
      { icon: Wallet, label: "Wallet & Billing" },
      { icon: Users, label: "Team" },
    ],
  },
];

function StatusDot({ ok }: { ok?: boolean }) {
  return (
    <span className={`inline-block h-2 w-2 rounded-full ${ok ? "bg-emerald-500" : "bg-amber-500"}`} />
  );
}

function Block({
  icon: Icon, title, status, ok, lines, cta,
}: {
  icon: any; title: string; status: string; ok?: boolean; lines: [string, string][]; cta: string;
}) {
  return (
    <div className="group rounded-xl border border-slate-200 bg-white p-5 transition-shadow hover:shadow-md">
      <div className="mb-4 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100">
            <Icon className="h-4.5 w-4.5 text-slate-700" size={18} />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-900">{title}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
              <StatusDot ok={ok} /> {status}
            </div>
          </div>
        </div>
        <ArrowUpRight className="h-4 w-4 text-slate-300 transition-colors group-hover:text-slate-500" />
      </div>
      <dl className="space-y-1.5">
        {lines.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between text-xs">
            <dt className="text-slate-500">{k}</dt>
            <dd className="font-medium text-slate-800">{v}</dd>
          </div>
        ))}
      </dl>
      <button className="mt-4 text-xs font-medium text-indigo-600 hover:text-indigo-700">
        {cta} →
      </button>
    </div>
  );
}

export function Home() {
  return (
    <div className="flex min-h-screen bg-slate-50 font-['Inter',sans-serif] text-slate-900">
      {/* Sidebar */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white">S</div>
          <div>
            <div className="text-sm font-bold leading-none">SnapServe</div>
            <div className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-slate-400">Voice Infrastructure</div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 pb-4">
          {nav.map((g) => (
            <div key={g.group} className="mt-1">
              {g.group && (
                <div className="mb-1 mt-4 px-2 text-[10px] font-semibold tracking-wider text-slate-400">{g.group}</div>
              )}
              {g.items.map((it) => (
                <a
                  key={it.label}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] ${
                    (it as any).active
                      ? "bg-indigo-50 font-semibold text-indigo-700"
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  }`}
                >
                  <it.icon className="h-4 w-4" />
                  <span className="flex-1">{it.label}</span>
                  {(it as any).badge && (
                    <span className="rounded-full bg-slate-100 px-1.5 text-[10px] font-semibold text-slate-500">{(it as any).badge}</span>
                  )}
                </a>
              ))}
            </div>
          ))}
        </nav>
        <div className="border-t border-slate-100 px-4 py-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500">Wallet</span>
            <span className="font-semibold text-slate-900">₹4,280.50</span>
          </div>
          <div className="mt-1.5 h-1 overflow-hidden rounded bg-slate-100">
            <div className="h-full w-2/3 rounded bg-emerald-500" />
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1">
        {/* Topbar */}
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-8 py-3">
          <div className="flex w-80 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-400">
            <Search className="h-3.5 w-3.5" /> Search agents, numbers, calls…
            <span className="ml-auto rounded border border-slate-200 bg-white px-1 text-[10px]">⌘K</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700">
              <CircleDot className="h-3 w-3" /> All systems operational
            </span>
            <Bell className="h-4 w-4 text-slate-400" />
            <div className="h-7 w-7 rounded-full bg-gradient-to-br from-indigo-500 to-violet-600" />
          </div>
        </header>

        <div className="mx-auto max-w-6xl px-8 py-7">
          {/* Heading + primary action */}
          <div className="mb-6 flex items-end justify-between">
            <div>
              <h1 className="text-xl font-bold">Good morning, Surendar</h1>
              <p className="mt-1 text-sm text-slate-500">Your voice infrastructure at a glance — 3 agents live, 128 calls today.</p>
            </div>
            <button className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700">
              <Plus className="h-4 w-4" /> Create agent
            </button>
          </div>

          {/* Alert */}
          <div className="mb-6 flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
            <span className="text-amber-800">
              <b>WhatsApp channel</b> for “Fortune Expo Agent” is pending verification — brochures won’t send until it’s approved.
            </span>
            <button className="ml-auto shrink-0 text-xs font-semibold text-amber-700 hover:underline">Fix now</button>
          </div>

          {/* Live stats strip */}
          <div className="mb-8 grid grid-cols-4 gap-4">
            {[
              ["Calls today", "128", "+18% vs yesterday"],
              ["Live right now", "3", "2 outbound · 1 inbound"],
              ["Avg. answer quality", "94%", "STT confidence, 7 days"],
              ["Spend today", "₹312.40", "₹2.44 avg / call"],
            ].map(([k, v, s]) => (
              <div key={k} className="rounded-xl border border-slate-200 bg-white px-5 py-4">
                <div className="text-xs text-slate-500">{k}</div>
                <div className="mt-1 text-2xl font-bold tracking-tight">{v}</div>
                <div className="mt-0.5 text-[11px] text-slate-400">{s}</div>
              </div>
            ))}
          </div>

          {/* Building blocks */}
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">Your building blocks</h2>
            <span className="text-xs text-slate-400">Everything an agent is assembled from</span>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Block icon={Bot} title="Agents" status="3 live · 1 draft" ok
              lines={[["Fortune Expo Agent", "Live · Ta/En"], ["Clinic Reception", "Live · Ta"], ["Policy Renewals", "Live · En"]]}
              cta="Open agents" />
            <Block icon={Phone} title="Phone Numbers" status="2 active" ok
              lines={[["+91 44 6142 0198", "→ Fortune Expo"], ["+91 80 4712 5566", "→ Clinic Reception"], ["BYO carrier", "VoBiz connected"]]}
              cta="Manage numbers" />
            <Block icon={BrainCircuit} title="Intelligence" status="LLM + memory healthy" ok
              lines={[["LLM", "Gemini 3.6 Flash"], ["Caller memory", "On · 1,204 callers"], ["Fallback", "Groq Llama"]]}
              cta="Configure" />
            <Block icon={Mic} title="Voices & Languages" status="4 voices in use" ok
              lines={[["TTS", "Cartesia · Sarvam"], ["STT", "Sarvam Saaras v3"], ["Languages", "Tamil · English"]]}
              cta="Browse voices" />
            <Block icon={BookOpen} title="Knowledge" status="1 source needs re-sync" ok={false}
              lines={[["Expo brochure", "Synced · 42 entries"], ["Pricing sheet", "Re-sync needed"], ["FAQ", "Synced · 18 entries"]]}
              cta="Open knowledge" />
            <Block icon={Megaphone} title="Campaigns" status="1 running" ok
              lines={[["Expo invites — batch 3", "412 / 900 dialed"], ["Connect rate", "38%"], ["Retries queued", "57"]]}
              cta="View campaigns" />
          </div>

          {/* Recent activity */}
          <div className="mt-8 rounded-xl border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <h3 className="text-sm font-semibold">Recent calls</h3>
              <button className="flex items-center text-xs font-medium text-indigo-600">View all <ChevronRight className="h-3.5 w-3.5" /></button>
            </div>
            {[
              ["+91 63836 …279", "Fortune Expo Agent", "Outbound · 2m 41s", "Booked a stall visit", "2 min ago", true],
              ["+91 98407 …114", "Clinic Reception", "Inbound · 1m 05s", "Appointment rescheduled", "11 min ago", true],
              ["+91 90032 …887", "Fortune Expo Agent", "Outbound · 0m 12s", "No answer — retry queued", "24 min ago", false],
            ].map(([num, agent, meta, outcome, when, ok]) => (
              <div key={num as string} className="flex items-center gap-4 border-b border-slate-50 px-5 py-3 text-[13px] last:border-0">
                <StatusDot ok={ok as boolean} />
                <span className="w-32 font-medium">{num}</span>
                <span className="w-40 text-slate-600">{agent}</span>
                <span className="w-36 text-slate-400">{meta}</span>
                <span className="flex-1 text-slate-600">{outcome}</span>
                <span className="text-xs text-slate-400">{when}</span>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
