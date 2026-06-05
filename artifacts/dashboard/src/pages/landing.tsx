import { Link } from "wouter";
import { useAuth } from "@/lib/auth";

export default function LandingPage() {
  const { signIn } = useAuth();
  return (
    <div className="min-h-screen bg-[#080808] text-white antialiased font-[var(--font-sans)] overflow-x-hidden">
      {/* Fonts */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=Space+Grotesk:wght@400;500;600;700;800&display=swap');
        :root {
          --bg: #080808;
          --bg-subtle: #111111;
          --border: rgba(255,255,255,0.10);
          --border-strong: rgba(255,255,255,0.18);
          --text-primary: #ffffff;
          --text-muted: #888888;
          --text-dimmed: #444444;
          --font-sans: 'Inter', sans-serif;
          --font-display: 'Space Grotesk', sans-serif;
        }
      `}</style>

      {/* NAV */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-10 h-[60px] border-b border-[var(--border)] bg-[rgba(8,8,8,0.85)] backdrop-blur-[16px]">
        <Link href="/" className="flex items-center gap-2.5 no-underline">
          <div className="flex flex-col gap-[3px] w-[22px]">
            <div className="h-[5px] rounded-[3px] w-[13px] bg-white" />
            <div className="h-[5px] rounded-[3px] w-[17px] bg-[#777]" />
            <div className="h-[5px] rounded-[3px] w-[13px] bg-[#444]" />
          </div>
          <span className="font-[var(--font-display)] text-[1.1rem] font-bold text-white tracking-[-0.3px]">
            SnapServe <span className="text-[var(--text-muted)] font-normal">AI</span>
          </span>
        </Link>

        <div className="hidden md:flex gap-10">
          <a href="#features" className="text-[0.875rem] font-normal text-[var(--text-muted)] no-underline transition-colors hover:text-white">Features</a>
          <a href="#how-it-works" className="text-[0.875rem] font-normal text-[var(--text-muted)] no-underline transition-colors hover:text-white">How it works</a>
          <a href="#pricing" className="text-[0.875rem] font-normal text-[var(--text-muted)] no-underline transition-colors hover:text-white">Pricing</a>
        </div>

        <div className="flex items-center gap-5">
          <button onClick={signIn} className="text-[0.875rem] font-medium text-[var(--text-muted)] bg-transparent border-none cursor-pointer transition-colors hover:text-white">Sign in</button>
          <button onClick={signIn} className="inline-flex items-center gap-1.5 bg-white text-black text-[0.875rem] font-semibold font-[var(--font-sans)] px-5 py-2 rounded-full border-none cursor-pointer transition-opacity hover:opacity-90 hover:shadow-[0_0_16px_rgba(255,255,255,0.15)]">Get started &rarr;</button>
        </div>
      </nav>

      {/* HERO */}
      <section className="min-h-screen flex flex-col justify-center px-10 pt-36 pb-20 max-w-[900px]">
        <div className="inline-flex items-center gap-2 bg-[rgba(255,255,255,0.05)] border border-[var(--border)] rounded-full px-4 py-1.5 text-[0.8rem] text-[var(--text-muted)] mb-9 w-fit">
          <span className="w-1.5 h-1.5 rounded-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.6)] animate-pulse" />
          Beta &middot; Now live
        </div>

        <h1 className="font-[var(--font-display)] text-[clamp(3.2rem,7.5vw,6.5rem)] font-extrabold leading-[1.05] tracking-[-2px] mb-7">
          SnapServe AI<br />
          <span className="text-[#3a3a3a]">Voice Agent</span><br />
          Orchestration
        </h1>

        <p className="text-[clamp(0.95rem,1.6vw,1.125rem)] text-[var(--text-muted)] leading-[1.65] max-w-[520px] font-normal mb-11">
          SnapServe AI is an AI Voice Agent Orchestration SaaS platform.
          Build AI-powered voice agents with persistent caller memory,
          real-time pipeline orchestration, and complete provider
          freedom. Ship in minutes, not months.
        </p>

        <div className="flex items-center gap-4 flex-wrap mb-5">
          <button onClick={signIn} className="inline-flex items-center gap-2 bg-white text-black text-[0.95rem] font-semibold font-[var(--font-sans)] px-7 py-4 rounded-full border-none cursor-pointer transition-opacity hover:opacity-90 hover:shadow-[0_0_24px_rgba(255,255,255,0.18)]">Start building free &rarr;</button>
          <a href="#features" className="inline-flex items-center gap-2 bg-transparent text-white text-[0.95rem] font-medium font-[var(--font-sans)] px-7 py-4 rounded-full border border-[var(--border-strong)] no-underline transition-all hover:border-[rgba(255,255,255,0.35)] hover:bg-[rgba(255,255,255,0.04)]">See features</a>
        </div>

        <p className="text-[0.8rem] text-[var(--text-dimmed)]">$5 free credit &middot; No card required</p>
      </section>

      {/* FEATURES */}
      <section id="features" className="px-10 py-24 max-w-[1100px] mx-auto">
        <p className="text-[0.75rem] font-semibold tracking-[2px] uppercase text-[var(--text-muted)] mb-12">Platform</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-px border border-[var(--border)] rounded-2xl overflow-hidden">
          <FeatureCard
            icon={
              <svg viewBox="0 0 24 24" className="w-5 h-5 stroke-white fill-none stroke-[1.5]"><path d="M12 2a10 10 0 1 0 0 20A10 10 0 0 0 12 2z"/><path d="M12 8v4l3 3"/></svg>
            }
            title="Persistent Memory"
            description="Agents remember every caller across sessions. Context carries forward automatically — no repeated intros, no forgotten preferences."
          />
          <FeatureCard
            icon={
              <svg viewBox="0 0 24 24" className="w-5 h-5 stroke-white fill-none stroke-[1.5]"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            }
            title="Real-Time Orchestration"
            description="Sub-100ms latency pipeline with hot-swap providers. Route ASR → LLM → TTS without dropped audio or context loss."
          />
          <FeatureCard
            icon={
              <svg viewBox="0 0 24 24" className="w-5 h-5 stroke-white fill-none stroke-[1.5]"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            }
            title="Bring Your Own Keys"
            description="Connect Deepgram, OpenAI, ElevenLabs, Twilio and more. Your API keys, your costs — we handle the orchestration layer only."
          />
          <FeatureCard
            icon={
              <svg viewBox="0 0 24 24" className="w-5 h-5 stroke-white fill-none stroke-[1.5]"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.13 11.8a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.04 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.09 8.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21 16.92z"/></svg>
            }
            title="Outbound Campaigns"
            description="Schedule and run bulk outbound call campaigns with smart retry logic, disposition tracking, and CRM webhook delivery."
          />
          <FeatureCard
            icon={
              <svg viewBox="0 0 24 24" className="w-5 h-5 stroke-white fill-none stroke-[1.5]"><path d="M3 3h18v18H3zM3 9h18M9 21V9"/></svg>
            }
            title="Live Call Monitoring"
            description="Watch active calls in real time. Inspect transcript, sentiment, and pipeline state from the dashboard without interrupting the agent."
          />
          <FeatureCard
            icon={
              <svg viewBox="0 0 24 24" className="w-5 h-5 stroke-white fill-none stroke-[1.5]"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/></svg>
            }
            title="Smart Scheduling"
            description="Built-in booking engine with availability windows, timezone awareness, and Google Calendar sync — no third-party scheduler needed."
          />
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how-it-works" className="px-10 py-24 max-w-[1100px] mx-auto">
        <p className="text-[0.75rem] font-semibold tracking-[2px] uppercase text-[var(--text-muted)] mb-12">How it works</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-16 items-center">
          <div>
            <h2 className="font-[var(--font-display)] text-[clamp(1.8rem,3.5vw,2.8rem)] font-bold tracking-[-1px] mb-5 leading-[1.15]">
              Your call pipeline,<br/>in three lines of code.
            </h2>
            <p className="text-[var(--text-muted)] text-base leading-[1.65] mb-8">
              Add your provider API keys, configure your agent's voice and prompt, then hit the API. SnapServe handles the WebSocket orchestration, fallback logic, and memory persistence automatically.
            </p>
            <button onClick={signIn} className="inline-flex items-center gap-2 bg-white text-black text-[0.95rem] font-semibold font-[var(--font-sans)] px-7 py-4 rounded-full border-none cursor-pointer transition-opacity hover:opacity-90 hover:shadow-[0_0_24px_rgba(255,255,255,0.18)]">View API docs &rarr;</button>
          </div>

          <div className="bg-[#0e0e0e] border border-[var(--border-strong)] rounded-[14px] overflow-hidden">
            <div className="bg-[#161616] px-4 py-3.5 flex items-center gap-2 border-b border-[var(--border)]">
              <div className="w-[11px] h-[11px] rounded-full bg-[#ff5f56]" />
              <div className="w-[11px] h-[11px] rounded-full bg-[#ffbd2e]" />
              <div className="w-[11px] h-[11px] rounded-full bg-[#27c93f]" />
              <span className="text-[0.75rem] text-[var(--text-muted)] ml-2 font-mono">POST /api/calls/outbound</span>
            </div>
            <div className="p-6 font-mono text-[0.82rem] leading-[1.8] text-[#bbb]">
              <span className="text-[#777]">const</span> response <span className="text-[#777]">=</span> <span className="text-[#777]">await</span> fetch(<span className="text-[#aaa]">'https://api.snapserve.ai/calls/outbound'</span>, {'{'}<br/>
              &nbsp;&nbsp;<span className="text-[#888]">method</span>: <span className="text-[#aaa]">'POST'</span>,<br/>
              &nbsp;&nbsp;<span className="text-[#888]">headers</span>: {'{'}<br/>
              &nbsp;&nbsp;&nbsp;&nbsp;<span className="text-[#aaa]">'Authorization'</span>: <span className="text-[#aaa]">{`\`Bearer \${API_KEY}\``}</span><br/>
              &nbsp;&nbsp;{'}'},<br/>
              &nbsp;&nbsp;<span className="text-[#888]">body</span>: JSON.stringify({'{'}<br/>
              &nbsp;&nbsp;&nbsp;&nbsp;<span className="text-[#888]">agent_id</span>: <span className="text-[#aaa]">'agt_8f2k9d'</span>,<br/>
              &nbsp;&nbsp;&nbsp;&nbsp;<span className="text-[#888]">to</span>: <span className="text-[#aaa]">'+14155550192'</span><br/>
              &nbsp;&nbsp;{'}'})<br/>
              {'}'});
            </div>
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="px-10 py-24 max-w-[1100px] mx-auto">
        <div className="mb-12">
          <p className="text-[0.75rem] font-semibold tracking-[2px] uppercase text-[var(--text-muted)] mb-12">Pricing</p>
          <h2 className="font-[var(--font-display)] text-[clamp(2rem,4vw,3rem)] font-bold tracking-[-1px] mb-3">Pay per minute.<br/>No surprises.</h2>
          <p className="text-[var(--text-muted)] text-base">Bring your own provider keys — you only pay SnapServe for orchestration.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-[var(--bg-subtle)] border border-[var(--border)] rounded-2xl p-8 flex flex-col gap-6 transition-colors hover:border-[var(--border-strong)]">
            <div>
              <div className="text-[0.8rem] font-semibold tracking-[1.5px] uppercase text-[var(--text-muted)]">Developer</div>
              <div className="font-[var(--font-display)] text-[2.5rem] font-bold tracking-[-1px]">$0.08 <sub className="text-base font-normal text-[var(--text-muted)]">/ min</sub></div>
            </div>
            <ul className="list-none flex flex-col gap-3">
              <li className="text-[0.875rem] text-[var(--text-muted)] flex items-center gap-2"><span className="w-[5px] h-[5px] rounded-full bg-[rgba(255,255,255,0.25)] shrink-0" />Standard LLM models</li>
              <li className="text-[0.875rem] text-[var(--text-muted)] flex items-center gap-2"><span className="w-[5px] h-[5px] rounded-full bg-[rgba(255,255,255,0.25)] shrink-0" />Basic voice clones</li>
              <li className="text-[0.875rem] text-[var(--text-muted)] flex items-center gap-2"><span className="w-[5px] h-[5px] rounded-full bg-[rgba(255,255,255,0.25)] shrink-0" />Up to 10 concurrent calls</li>
              <li className="text-[0.875rem] text-[var(--text-muted)] flex items-center gap-2"><span className="w-[5px] h-[5px] rounded-full bg-[rgba(255,255,255,0.25)] shrink-0" />Email support</li>
            </ul>
            <button onClick={signIn} className="block text-center w-full py-3 px-6 rounded-full text-[0.875rem] font-semibold border border-[var(--border-strong)] text-white bg-transparent cursor-pointer transition-all hover:bg-[rgba(255,255,255,0.06)] hover:border-[rgba(255,255,255,0.35)] mt-auto">Start free</button>
          </div>

          <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.3)] rounded-2xl p-8 flex flex-col gap-6">
            <div>
              <div className="text-[0.8rem] font-semibold tracking-[1.5px] uppercase text-[var(--text-muted)]">Production</div>
              <div className="font-[var(--font-display)] text-[2.5rem] font-bold tracking-[-1px]">$0.12 <sub className="text-base font-normal text-[var(--text-muted)]">/ min</sub></div>
            </div>
            <ul className="list-none flex flex-col gap-3">
              <li className="text-[0.875rem] text-[var(--text-muted)] flex items-center gap-2"><span className="w-[5px] h-[5px] rounded-full bg-[rgba(255,255,255,0.25)] shrink-0" />Zero-shot prompt engine</li>
              <li className="text-[0.875rem] text-[var(--text-muted)] flex items-center gap-2"><span className="w-[5px] h-[5px] rounded-full bg-[rgba(255,255,255,0.25)] shrink-0" />Ultra-low latency voices</li>
              <li className="text-[0.875rem] text-[var(--text-muted)] flex items-center gap-2"><span className="w-[5px] h-[5px] rounded-full bg-[rgba(255,255,255,0.25)] shrink-0" />Persistent memory store</li>
              <li className="text-[0.875rem] text-[var(--text-muted)] flex items-center gap-2"><span className="w-[5px] h-[5px] rounded-full bg-[rgba(255,255,255,0.25)] shrink-0" />Smart SIP escalation</li>
              <li className="text-[0.875rem] text-[var(--text-muted)] flex items-center gap-2"><span className="w-[5px] h-[5px] rounded-full bg-[rgba(255,255,255,0.25)] shrink-0" />Up to 500 concurrent calls</li>
            </ul>
            <button onClick={signIn} className="block text-center w-full py-3 px-6 rounded-full text-[0.875rem] font-semibold border border-white bg-white text-black cursor-pointer transition-all hover:bg-[rgba(255,255,255,0.9)] mt-auto">Get started</button>
          </div>

          <div className="bg-[var(--bg-subtle)] border border-[var(--border)] rounded-2xl p-8 flex flex-col gap-6 transition-colors hover:border-[var(--border-strong)]">
            <div>
              <div className="text-[0.8rem] font-semibold tracking-[1.5px] uppercase text-[var(--text-muted)]">Enterprise</div>
              <div className="font-[var(--font-display)] text-[2.5rem] font-bold tracking-[-1px]">Custom</div>
            </div>
            <ul className="list-none flex flex-col gap-3">
              <li className="text-[0.875rem] text-[var(--text-muted)] flex items-center gap-2"><span className="w-[5px] h-[5px] rounded-full bg-[rgba(255,255,255,0.25)] shrink-0" />Dedicated infrastructure</li>
              <li className="text-[0.875rem] text-[var(--text-muted)] flex items-center gap-2"><span className="w-[5px] h-[5px] rounded-full bg-[rgba(255,255,255,0.25)] shrink-0" />Custom model fine-tuning</li>
              <li className="text-[0.875rem] text-[var(--text-muted)] flex items-center gap-2"><span className="w-[5px] h-[5px] rounded-full bg-[rgba(255,255,255,0.25)] shrink-0" />HIPAA & SOC2 compliance</li>
              <li className="text-[0.875rem] text-[var(--text-muted)] flex items-center gap-2"><span className="w-[5px] h-[5px] rounded-full bg-[rgba(255,255,255,0.25)] shrink-0" />24/7 Slack Connect support</li>
              <li className="text-[0.875rem] text-[var(--text-muted)] flex items-center gap-2"><span className="w-[5px] h-[5px] rounded-full bg-[rgba(255,255,255,0.25)] shrink-0" />Unlimited concurrency</li>
            </ul>
            <a href="mailto:sales@snapserve.ai" className="block text-center py-3 px-6 rounded-full text-[0.875rem] font-semibold no-underline border border-[var(--border-strong)] text-white transition-all hover:bg-[rgba(255,255,255,0.06)] hover:border-[rgba(255,255,255,0.35)] mt-auto">Contact sales</a>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-[var(--border)] px-10 py-12 flex items-center justify-between flex-wrap gap-4">
        <p className="text-[0.825rem] text-[var(--text-dimmed)]">&copy; 2026 SnapServe Inc.</p>
        <div className="flex gap-8">
          <Link href="/privacy" className="text-[0.825rem] text-[var(--text-dimmed)] no-underline transition-colors hover:text-[var(--text-muted)]">Privacy</Link>
          <Link href="/terms" className="text-[0.825rem] text-[var(--text-dimmed)] no-underline transition-colors hover:text-[var(--text-muted)]">Terms</Link>
          <Link href="/" className="text-[0.825rem] text-[var(--text-dimmed)] no-underline transition-colors hover:text-[var(--text-muted)]">Docs</Link>
          <Link href="/" className="text-[0.825rem] text-[var(--text-dimmed)] no-underline transition-colors hover:text-[var(--text-muted)]">Status</Link>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="p-10 bg-[var(--bg-subtle)] border-r border-[var(--border)] transition-colors hover:bg-[rgba(255,255,255,0.03)]">
      <div className="w-10 h-10 border border-[var(--border-strong)] rounded-[10px] flex items-center justify-center mb-6">
        {icon}
      </div>
      <h3 className="font-[var(--font-display)] text-[1.05rem] font-semibold mb-2.5">{title}</h3>
      <p className="text-[0.875rem] text-[var(--text-muted)] leading-[1.6]">{description}</p>
    </div>
  );
}
