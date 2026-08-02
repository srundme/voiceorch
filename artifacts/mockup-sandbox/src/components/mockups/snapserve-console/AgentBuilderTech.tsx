import {
  Bot, BrainCircuit, Mic, Phone, GitBranch, Rocket, Check, ChevronDown,
  Play, Terminal, Braces, Copy, Volume2, Activity, Zap,
} from "lucide-react";

const steps = [
  { icon: Bot, label: "identity", done: true },
  { icon: BrainCircuit, label: "brain", done: true },
  { icon: Mic, label: "voice", active: true },
  { icon: Phone, label: "telephony" },
  { icon: GitBranch, label: "behavior" },
  { icon: Rocket, label: "deploy" },
];

const voices = [
  { name: "meera", lang: "ta-IN · chennai", provider: "cartesia/sonic-3", latency: "142ms", selected: true },
  { name: "anushka", lang: "ta-IN · neutral", provider: "sarvam/bulbul-v3", latency: "188ms" },
  { name: "arjun", lang: "ta-IN · madurai", provider: "sarvam/bulbul-v3", latency: "191ms" },
  { name: "sophia", lang: "en-IN", provider: "cartesia/sonic-3", latency: "138ms" },
];

export function AgentBuilderTech() {
  return (
    <div className="flex min-h-screen bg-[#0a0e17] font-['Inter',sans-serif] text-slate-200">
      {/* Left rail */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-white/[0.06] bg-[#0d1220] px-4 py-5">
        <div className="mb-1 flex items-center gap-2 font-mono text-[11px] text-slate-500">
          <Terminal className="h-3.5 w-3.5 text-emerald-400" /> agents / <span className="text-slate-300">new</span>
        </div>
        <div className="mb-6 font-mono text-sm font-semibold text-white">fortune-expo-agent</div>
        <ol className="space-y-0.5 font-mono text-[12px]">
          {steps.map((s, i) => (
            <li key={s.label} className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 ${s.active ? "bg-indigo-500/10 ring-1 ring-inset ring-indigo-500/30" : ""}`}>
              <span className={`flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold ${
                s.done ? "bg-emerald-500/15 text-emerald-400" : s.active ? "bg-indigo-500 text-white" : "bg-white/[0.04] text-slate-600"
              }`}>
                {s.done ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              <span className={s.active ? "text-indigo-300" : s.done ? "text-slate-300" : "text-slate-600"}>{s.label}</span>
              {s.done && <span className="ml-auto text-[9px] text-emerald-500">ok</span>}
            </li>
          ))}
        </ol>
        {/* live config */}
        <div className="mt-6 rounded-lg border border-white/[0.06] bg-black/40 p-3">
          <div className="mb-2 flex items-center justify-between font-mono text-[10px] text-slate-500">
            <span className="flex items-center gap-1"><Braces className="h-3 w-3" /> agent.config</span>
            <Copy className="h-3 w-3 cursor-pointer hover:text-slate-300" />
          </div>
          <pre className="font-mono text-[10px] leading-relaxed text-slate-400">
{`llm:   gemini-3.6-flash
mem:   `}<span className="text-emerald-400">enabled</span>{`
stt:   saaras-v3
tts:   `}<span className="text-indigo-300">cartesia/meera</span>{`
lang:  ta-IN+en
tel:   `}<span className="text-amber-400">unset</span></pre>
        </div>
        <div className="mt-auto flex items-center gap-2 rounded-md bg-emerald-500/[0.07] px-2.5 py-2 font-mono text-[10px] text-emerald-400">
          <Activity className="h-3 w-3" /> draft autosaved · 4s ago
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 px-8 py-7">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-center gap-2 font-mono text-[11px] text-indigo-400">
            <Zap className="h-3.5 w-3.5" /> STEP 3/6 — VOICE PIPELINE
          </div>
          <h1 className="mt-1 text-xl font-bold text-white">Voice & speech stack</h1>
          <p className="mt-1 text-sm text-slate-400">Select TTS voice and STT engine. Latency shown is p50 first-byte from Chennai POP.</p>

          <div className="mt-6 mb-2 flex items-center justify-between">
            <h2 className="font-mono text-[11px] font-semibold tracking-wider text-slate-400">TTS_VOICE</h2>
            <span className="font-mono text-[10px] text-slate-600">▶ preview sample</span>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            {voices.map((v) => (
              <div key={v.name} className={`flex items-center gap-3 rounded-lg border p-3.5 ${
                v.selected ? "border-indigo-500/60 bg-indigo-500/[0.07] shadow-[0_0_20px_rgba(99,102,241,0.15)]" : "border-white/[0.07] bg-white/[0.02] hover:border-white/[0.15]"
              }`}>
                <button className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${v.selected ? "bg-indigo-500 text-white" : "bg-white/[0.05] text-slate-400"}`}>
                  <Play className="h-3.5 w-3.5" />
                </button>
                <div className="min-w-0 flex-1 font-mono">
                  <div className="flex items-center gap-2 text-[13px] font-semibold text-white">{v.name}
                    {v.selected && <span className="rounded bg-indigo-500/20 px-1.5 py-0.5 text-[9px] text-indigo-300">SELECTED</span>}
                  </div>
                  <div className="truncate text-[10px] text-slate-500">{v.provider} · {v.lang}</div>
                </div>
                <div className="text-right font-mono">
                  <div className="text-[11px] text-emerald-400">{v.latency}</div>
                  <div className="text-[9px] text-slate-600">TTFB</div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2.5">
            <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-4">
              <div className="font-mono text-[10px] font-semibold tracking-wider text-slate-500">LANGUAGE</div>
              <button className="mt-2 flex w-full items-center justify-between rounded-md border border-white/[0.08] bg-black/30 px-3 py-2 font-mono text-[12px] text-slate-200">
                ta-IN + en (code-mix) <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
              </button>
              <p className="mt-2 font-mono text-[10px] leading-relaxed text-slate-600">continuous LID: switches mid-call on caller language change</p>
            </div>
            <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] p-4">
              <div className="font-mono text-[10px] font-semibold tracking-wider text-slate-500">STT_ENGINE</div>
              <button className="mt-2 flex w-full items-center justify-between rounded-md border border-white/[0.08] bg-black/30 px-3 py-2 font-mono text-[12px] text-slate-200">
                sarvam/saaras-v3 <span className="rounded bg-emerald-500/15 px-1.5 text-[9px] text-emerald-400">RECOMMENDED</span>
              </button>
              <p className="mt-2 font-mono text-[10px] leading-relaxed text-slate-600">WER 8.2% on ta-IN telephony · streaming ws</p>
            </div>
          </div>

          {/* advanced */}
          <div className="mt-4 rounded-lg border border-white/[0.06] bg-black/20">
            <button className="flex w-full items-center gap-2 px-4 py-2.5 font-mono text-[11px] text-slate-500 hover:text-slate-300">
              <ChevronDown className="h-3.5 w-3.5" /> advanced — barge_in · noise_gate · endpointing_ms · tts_speed
            </button>
          </div>

          <div className="mt-8 flex items-center justify-between border-t border-white/[0.06] pt-5">
            <button className="font-mono text-[12px] text-slate-500 hover:text-slate-300">← brain</button>
            <button className="rounded-md bg-indigo-500 px-5 py-2 font-mono text-[12px] font-semibold text-white shadow-[0_0_24px_rgba(99,102,241,0.35)] hover:bg-indigo-400">
              continue → telephony
            </button>
          </div>
        </div>
      </main>

      {/* Right: live pipeline monitor */}
      <aside className="w-80 shrink-0 border-l border-white/[0.06] bg-[#0d1220] px-5 py-6">
        <div className="mb-3 flex items-center gap-2 font-mono text-[10px] font-semibold tracking-wider text-slate-500">
          <Activity className="h-3.5 w-3.5 text-emerald-400" /> PIPELINE PREVIEW
        </div>
        {/* pipeline diagram */}
        <div className="space-y-1.5 font-mono text-[11px]">
          {[
            ["caller audio", "8kHz PCM · VoBiz WS", "ok"],
            ["stt", "saaras-v3 streaming", "ok"],
            ["llm", "gemini-3.6-flash · mem", "ok"],
            ["tts", "cartesia/meera", "sel"],
            ["telephony", "not attached", "warn"],
          ].map(([k, v, s]) => (
            <div key={k as string} className="flex items-center gap-2.5 rounded-md border border-white/[0.05] bg-black/30 px-3 py-2">
              <span className={`h-1.5 w-1.5 rounded-full ${s === "warn" ? "bg-amber-400" : s === "sel" ? "bg-indigo-400 shadow-[0_0_6px_rgba(129,140,248,0.8)]" : "bg-emerald-400"}`} />
              <span className="w-20 text-slate-300">{k}</span>
              <span className="flex-1 truncate text-[10px] text-slate-500">{v}</span>
            </div>
          ))}
        </div>
        {/* estimated latency budget */}
        <div className="mt-5 rounded-lg border border-white/[0.06] bg-black/30 p-3.5">
          <div className="mb-2 font-mono text-[10px] tracking-wider text-slate-500">EST. TURN LATENCY</div>
          <div className="font-mono text-2xl font-bold text-white">~810<span className="text-sm text-slate-500">ms</span></div>
          <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
            <div className="w-[30%] bg-sky-500" /><div className="w-[45%] bg-indigo-500" /><div className="w-[25%] bg-emerald-500" />
          </div>
          <div className="mt-1.5 flex justify-between font-mono text-[9px] text-slate-600">
            <span className="text-sky-400">stt 240</span><span className="text-indigo-400">llm 370</span><span className="text-emerald-400">tts 200</span>
          </div>
        </div>
        {/* terminal log */}
        <div className="mt-5 rounded-lg border border-white/[0.06] bg-black/50 p-3.5 font-mono text-[10px] leading-relaxed">
          <div className="mb-1.5 flex items-center gap-1.5 text-slate-600"><Terminal className="h-3 w-3" /> events</div>
          <div className="text-slate-500">[12:04:11] <span className="text-emerald-400">✓</span> knowledge attached: expo-brochure (42)</div>
          <div className="text-slate-500">[12:04:32] <span className="text-emerald-400">✓</span> memory store initialised</div>
          <div className="text-slate-500">[12:05:01] <span className="text-indigo-400">→</span> tts voice set: cartesia/meera</div>
          <div className="text-slate-500">[12:05:01] <span className="text-amber-400">!</span> telephony: no number attached</div>
          <div className="text-slate-400">▌</div>
        </div>
        <button className="mt-4 flex w-full items-center justify-center gap-2 rounded-md border border-white/[0.08] py-2 font-mono text-[11px] text-slate-400 hover:border-indigo-500/40 hover:text-indigo-300">
          <Volume2 className="h-3.5 w-3.5" /> test voice sample
        </button>
      </aside>
    </div>
  );
}
