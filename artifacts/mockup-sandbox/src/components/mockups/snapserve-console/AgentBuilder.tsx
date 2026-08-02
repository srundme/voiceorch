import {
  Bot, BrainCircuit, Mic, Phone, GitBranch, Rocket, Check, ChevronDown,
  Play, Sparkles, BookOpen, MessageCircle, Info, Volume2,
} from "lucide-react";

const steps = [
  { icon: Bot, label: "Identity", done: true },
  { icon: BrainCircuit, label: "Brain", done: true },
  { icon: Mic, label: "Voice & Ears", active: true },
  { icon: Phone, label: "Phone" },
  { icon: GitBranch, label: "Behavior" },
  { icon: Rocket, label: "Test & Launch" },
];

const voices = [
  { name: "Meera", lang: "Tamil · Chennai", provider: "Cartesia Sonic", tone: "Warm, friendly", selected: true },
  { name: "Anushka", lang: "Tamil · Neutral", provider: "Sarvam Bulbul v3", tone: "Crisp, professional" },
  { name: "Arjun", lang: "Tamil · Madurai", provider: "Sarvam Bulbul v3", tone: "Deep, calm" },
  { name: "Sophia", lang: "English · Indian", provider: "Cartesia Sonic", tone: "Bright, energetic" },
];

export function AgentBuilder() {
  return (
    <div className="flex min-h-screen bg-slate-50 font-['Inter',sans-serif] text-slate-900">
      {/* Left: step rail */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-slate-200 bg-white px-5 py-6">
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">New Agent</div>
        <div className="mb-6 text-base font-bold">Fortune Expo Agent</div>
        <ol className="relative space-y-1">
          {steps.map((s, i) => (
            <li key={s.label} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 ${s.active ? "bg-indigo-50" : ""}`}>
              <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                s.done ? "bg-emerald-500 text-white" : s.active ? "bg-indigo-600 text-white" : "border border-slate-200 bg-white text-slate-400"
              }`}>
                {s.done ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </div>
              <div>
                <div className={`text-[13px] font-medium ${s.active ? "text-indigo-700" : s.done ? "text-slate-700" : "text-slate-400"}`}>{s.label}</div>
                {s.active && <div className="text-[11px] text-indigo-400">Pick how it sounds & listens</div>}
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-500">
          <Sparkles className="mb-1 h-3.5 w-3.5 text-indigo-500" />
          Each step pulls from your building blocks — voices, numbers and knowledge you set up once and reuse across agents.
        </div>
      </aside>

      {/* Main step content */}
      <main className="flex-1 px-10 py-8">
        <div className="mx-auto max-w-3xl">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-indigo-500">Step 3 of 6</div>
          <h1 className="text-xl font-bold">Voice & Ears</h1>
          <p className="mt-1 text-sm text-slate-500">Choose the voice callers will hear, and how the agent understands speech.</p>

          {/* Voice picker */}
          <div className="mt-6 mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">Voice</h2>
            <span className="text-xs text-slate-400">Tap ▶ to hear a sample</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {voices.map((v) => (
              <div key={v.name} className={`flex items-center gap-3 rounded-xl border bg-white p-4 ${
                v.selected ? "border-indigo-500 ring-2 ring-indigo-100" : "border-slate-200 hover:border-slate-300"
              }`}>
                <button className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${v.selected ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600"}`}>
                  <Play className="h-4 w-4" />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-semibold">{v.name}
                    {v.selected && <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">Selected</span>}
                  </div>
                  <div className="truncate text-xs text-slate-500">{v.lang} · {v.tone}</div>
                  <div className="text-[10px] text-slate-400">{v.provider}</div>
                </div>
                <Volume2 className="h-4 w-4 shrink-0 text-slate-300" />
              </div>
            ))}
          </div>

          {/* Language + STT */}
          <div className="mt-6 grid grid-cols-2 gap-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-semibold text-slate-500">LANGUAGE</div>
              <button className="mt-2 flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm">
                Tamil (Chennai spoken) + English mix <ChevronDown className="h-4 w-4 text-slate-400" />
              </button>
              <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-400">
                <Info className="mt-0.5 h-3 w-3 shrink-0" /> The agent replies in the caller's language and switches mid-call if they do.
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-semibold text-slate-500">SPEECH RECOGNITION</div>
              <button className="mt-2 flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm">
                Sarvam Saaras v3 <span className="rounded bg-emerald-50 px-1.5 text-[10px] font-semibold text-emerald-600">Recommended</span>
              </button>
              <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-slate-400">
                <Info className="mt-0.5 h-3 w-3 shrink-0" /> Best accuracy for Tamil & code-mixed speech on phone lines.
              </p>
            </div>
          </div>

          {/* Advanced collapsed */}
          <button className="mt-4 flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-slate-600">
            <ChevronDown className="h-3.5 w-3.5" /> Advanced settings — speed, barge-in, noise handling, endpointing
          </button>

          {/* Footer nav */}
          <div className="mt-10 flex items-center justify-between border-t border-slate-100 pt-5">
            <button className="text-sm font-medium text-slate-500 hover:text-slate-700">← Back: Brain</button>
            <div className="flex items-center gap-3">
              <span className="text-xs text-slate-400">Draft saves automatically</span>
              <button className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700">
                Continue: Phone →
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* Right: live summary of assembled blocks */}
      <aside className="w-72 shrink-0 border-l border-slate-200 bg-white px-5 py-6">
        <div className="mb-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Agent so far</div>
        {[
          { icon: Bot, k: "Identity", v: "Fortune Expo Agent — expo stall bookings", done: true },
          { icon: BrainCircuit, k: "Brain", v: "Gemini 3.6 Flash · Memory on", done: true },
          { icon: BookOpen, k: "Knowledge", v: "Expo brochure + FAQ attached", done: true },
          { icon: Mic, k: "Voice", v: "Meera · Tamil (Chennai)", active: true },
          { icon: Phone, k: "Phone", v: "Not chosen yet" },
          { icon: MessageCircle, k: "WhatsApp", v: "Not connected" },
        ].map((r) => (
          <div key={r.k} className="mb-3 flex items-start gap-3">
            <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
              r.done ? "bg-emerald-50 text-emerald-600" : r.active ? "bg-indigo-50 text-indigo-600" : "bg-slate-50 text-slate-300"
            }`}>
              <r.icon className="h-3.5 w-3.5" />
            </div>
            <div>
              <div className="text-xs font-semibold text-slate-700">{r.k}</div>
              <div className={`text-[11px] ${r.done || r.active ? "text-slate-500" : "text-slate-300"}`}>{r.v}</div>
            </div>
          </div>
        ))}
        <div className="mt-6 rounded-xl border border-dashed border-slate-200 p-4 text-center">
          <Play className="mx-auto h-5 w-5 text-slate-300" />
          <div className="mt-1.5 text-xs font-medium text-slate-400">Test call unlocks at step 6</div>
        </div>
      </aside>
    </div>
  );
}
