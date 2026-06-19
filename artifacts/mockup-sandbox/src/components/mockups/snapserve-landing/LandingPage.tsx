import React from 'react';
import './_group.css';

export function LandingPage() {
  return (
    <div className="snapserve-theme">
      {/* 1. Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-8 py-4 border-b border-white/5 bg-[#050508]/80 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-600 to-blue-600 flex items-center justify-center">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 12h4l3-9 5 18 3-9h5"/>
            </svg>
          </div>
          <span className="text-xl font-bold tracking-tight">SnapServe</span>
        </div>
        <div className="hidden md:flex items-center gap-8 text-sm font-medium text-gray-400">
          <a href="#" className="hover:text-white transition-colors">Product</a>
          <a href="#" className="hover:text-white transition-colors">Pricing</a>
          <a href="#" className="hover:text-white transition-colors">Docs</a>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <a href="#" className="font-medium text-gray-400 hover:text-white transition-colors hidden sm:block">Sign in</a>
          <button className="btn-primary px-4 py-2 rounded-full font-medium">Get started free</button>
        </div>
      </nav>

      {/* 2. Hero */}
      <section className="relative pt-40 pb-24 px-8 overflow-hidden min-h-[90vh] flex flex-col items-center justify-center">
        <div className="absolute inset-0 bg-grid pointer-events-none opacity-40"></div>
        
        {/* Decorative Orb */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-violet-600/20 rounded-full blur-[120px] animate-pulse-orb pointer-events-none"></div>

        <div className="relative z-10 flex flex-col items-center text-center max-w-4xl mx-auto">
          {/* Animated Provider Pills (Orbiting) */}
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 orbit-1">
              <span className="pill deepgram"><span className="dot"></span>Deepgram</span>
            </div>
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 orbit-2">
              <span className="pill openai"><span className="dot"></span>OpenAI</span>
            </div>
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 orbit-3">
              <span className="pill elevenlabs"><span className="dot"></span>ElevenLabs</span>
            </div>
          </div>

          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-violet-500/30 bg-violet-500/10 text-violet-300 text-sm font-medium mb-8 animate-reveal">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500"></span>
            </span>
            SnapServe 2.0 is live
          </div>

          <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight mb-6 animate-reveal delay-100 text-gradient">
            Orchestrate AI Voice<br />Agents at Scale
          </h1>
          
          <p className="text-lg md:text-xl text-gray-400 mb-10 max-w-2xl animate-reveal delay-200">
            The voice AI platform that speaks your stack. Connect your own providers or use our managed infrastructure to deploy conversational agents in minutes.
          </p>

          <div className="flex flex-col sm:flex-row items-center gap-4 animate-reveal delay-300">
            <button className="btn-primary px-8 py-3.5 rounded-full text-base font-semibold shadow-lg shadow-violet-500/20">
              Get started free
            </button>
            <button className="px-8 py-3.5 rounded-full text-base font-semibold border border-gray-600 hover:border-gray-400 bg-white/5 hover:bg-white/10 transition-all flex items-center gap-2 backdrop-blur-sm">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z"/>
              </svg>
              Watch demo
            </button>
          </div>

          {/* Waveform Visual */}
          <div className="mt-16 flex items-end justify-center gap-1.5 h-16 opacity-80 animate-reveal delay-400">
            <div className="w-2 rounded-full bg-violet-500 waveform-bar"></div>
            <div className="w-2 rounded-full bg-blue-500 waveform-bar"></div>
            <div className="w-2 rounded-full bg-indigo-500 waveform-bar"></div>
            <div className="w-2 rounded-full bg-violet-400 waveform-bar"></div>
            <div className="w-2 rounded-full bg-blue-400 waveform-bar"></div>
            <div className="w-2 rounded-full bg-indigo-400 waveform-bar"></div>
          </div>
        </div>
      </section>

      {/* 3. Logos Strip */}
      <section className="py-12 border-y border-white/5 bg-white/[0.02]">
        <div className="max-w-7xl mx-auto px-8 text-center">
          <p className="text-sm font-medium text-gray-500 uppercase tracking-widest mb-8">Works with every major provider</p>
          <div className="flex flex-wrap justify-center gap-x-12 gap-y-6 opacity-60 hover:opacity-100 transition-opacity duration-500 grayscale hover:grayscale-0">
            <div className="text-xl font-bold text-gray-300">Deepgram</div>
            <div className="text-xl font-bold text-gray-300">OpenAI</div>
            <div className="text-xl font-bold text-gray-300">ElevenLabs</div>
            <div className="text-xl font-bold text-gray-300">Cartesia</div>
            <div className="text-xl font-bold text-gray-300">Twilio</div>
            <div className="text-xl font-bold text-gray-300">Azure</div>
          </div>
        </div>
      </section>

      {/* 4. How it works */}
      <section className="py-32 px-8 relative">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-20 animate-reveal">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">From idea to live agent in minutes</h2>
            <p className="text-gray-400 max-w-2xl mx-auto">No complex integration code required. SnapServe handles the hard parts of real-time audio streaming, endpointing, and interruption handling.</p>
          </div>

          <div className="relative grid md:grid-cols-3 gap-8">
            <div className="hidden md:block timeline-connector"></div>
            
            {[
              { step: 1, title: "Build Agent", desc: "Define your agent's persona, system prompt, and tools using our visual builder or API." },
              { step: 2, title: "Connect Providers", desc: "Bring your own keys for ASR, LLM, and TTS, or use our optimized default stack." },
              { step: 3, title: "Go Live", desc: "Deploy via web widget, connect a Twilio number, or use our inbound/outbound campaign tools." }
            ].map((item, i) => (
              <div key={i} className="relative z-10 glass-card p-8 rounded-2xl animate-reveal" style={{ animationDelay: `${(i+1)*100}ms` }}>
                <div className="w-12 h-12 rounded-full bg-violet-600/20 border border-violet-500/30 flex items-center justify-center text-violet-400 font-bold text-xl mb-6 backdrop-blur-md">
                  {item.step}
                </div>
                <h3 className="text-xl font-semibold mb-3">{item.title}</h3>
                <p className="text-gray-400 leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 5. Features Grid */}
      <section className="py-24 px-8 bg-[#08080c]">
        <div className="max-w-6xl mx-auto">
          <div className="mb-16 animate-reveal">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Everything you need to scale</h2>
            <p className="text-gray-400">Enterprise-grade capabilities built into the core orchestration engine.</p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { title: "Bring Your Own Providers", desc: "Mix and match Deepgram, OpenAI, Cartesia, and others. Zero lock-in.", icon: "M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" },
              { title: "Real-time Transcription", desc: "Sub-200ms latency streaming transcription with word-level timestamps.", icon: "M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" },
              { title: "Multi-language Support", desc: "Native support for 30+ languages with automatic detection.", icon: "M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 15h4.615M11 21l5-10 5 10M12.751 15h4.615" },
              { title: "Call Recording & Logs", desc: "Stereo recordings, detailed transcripts, and interaction logs stored securely.", icon: "M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" },
              { title: "Scheduling & Bookings", desc: "Native Google Calendar integration for agents to book appointments mid-call.", icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
              { title: "Enterprise Compliance", desc: "Built for scale with IRDAI, DPDP, TRAI, and HIPAA compliance readiness.", icon: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" }
            ].map((feature, i) => (
              <div key={i} className="gradient-border-card p-8 animate-reveal" style={{ animationDelay: `${i*50}ms` }}>
                <div className="w-10 h-10 mb-4 rounded-lg bg-gray-800 flex items-center justify-center text-violet-400">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d={feature.icon}/>
                  </svg>
                </div>
                <h3 className="text-lg font-semibold mb-2 text-gray-100">{feature.title}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 6. Pricing */}
      <section className="py-24 px-8">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16 animate-reveal">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Simple, transparent pricing</h2>
            <p className="text-gray-400">Pay only for what you use. No minimums, no hidden fees.</p>
          </div>

          <div className="grid md:grid-cols-2 gap-8 items-center max-w-4xl mx-auto">
            {/* BYOP Plan */}
            <div className="glass-card rounded-3xl p-8 relative animate-reveal delay-100">
              <h3 className="text-2xl font-bold mb-2 text-gray-200">Bring Your Own</h3>
              <p className="text-gray-400 mb-6 h-12">Connect your own API keys. We handle the orchestration.</p>
              <div className="mb-6">
                <span className="text-5xl font-extrabold">$0.035</span>
                <span className="text-gray-400">/min</span>
              </div>
              <ul className="space-y-4 mb-8">
                {['Orchestration engine access', 'Web widget & Telephony', 'Full analytics & logs', 'Unlimited concurrent calls'].map((item, i) => (
                  <li key={i} className="flex items-center gap-3 text-gray-300">
                    <svg className="text-blue-400" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 13l4 4L19 7"/></svg>
                    {item}
                  </li>
                ))}
              </ul>
              <button className="w-full py-3 rounded-xl border border-gray-600 hover:bg-white/5 font-semibold transition-colors">Select BYOP</button>
            </div>

            {/* Managed Plan */}
            <div className="bg-gradient-to-b from-[#13111C] to-[#0A0A0F] border border-violet-500/30 rounded-3xl p-8 relative shadow-2xl shadow-violet-900/20 transform md:-translate-y-4 animate-reveal delay-200">
              <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-violet-600 text-white text-xs font-bold uppercase tracking-widest py-1 px-4 rounded-full">
                Most Popular
              </div>
              <h3 className="text-2xl font-bold mb-2 text-white">Managed</h3>
              <p className="text-gray-400 mb-6 h-12">Zero setup. We provide top-tier models and voices out of the box.</p>
              <div className="mb-6">
                <span className="text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-violet-300 to-violet-100">$0.05</span>
                <span className="text-gray-400">/min</span>
              </div>
              <ul className="space-y-4 mb-8">
                {['Everything in BYOP', 'Premium ASR included', 'Premium LLM included', 'Premium TTS included', 'Priority support'].map((item, i) => (
                  <li key={i} className="flex items-center gap-3 text-gray-200">
                    <svg className="text-violet-400" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 13l4 4L19 7"/></svg>
                    {item}
                  </li>
                ))}
              </ul>
              <button className="w-full btn-primary py-3 rounded-xl font-semibold">Start with Managed</button>
            </div>
          </div>
        </div>
      </section>

      {/* 7. CTA Banner */}
      <section className="py-24 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-violet-900/20 to-blue-900/20 pointer-events-none"></div>
        <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-violet-500/50 to-transparent"></div>
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-blue-500/50 to-transparent"></div>
        
        <div className="max-w-4xl mx-auto px-8 text-center relative z-10 animate-reveal">
          <h2 className="text-4xl md:text-5xl font-bold mb-6">Start building in minutes</h2>
          <p className="text-xl text-gray-400 mb-10 max-w-2xl mx-auto">Join forward-thinking teams using SnapServe to deploy production-ready voice AI agents.</p>
          
          <form className="flex flex-col sm:flex-row gap-3 justify-center max-w-lg mx-auto" onSubmit={e => e.preventDefault()}>
            <input 
              type="email" 
              placeholder="Enter your email" 
              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-5 py-3.5 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500/50 focus:border-transparent transition-all backdrop-blur-sm"
              required
            />
            <button type="submit" className="btn-primary px-8 py-3.5 rounded-xl font-semibold whitespace-nowrap shadow-lg shadow-violet-500/20">
              Get Started
            </button>
          </form>
        </div>
      </section>

      {/* 8. Footer */}
      <footer className="pt-20 pb-10 px-8 border-t border-white/5 bg-[#050508]">
        <div className="max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-5 gap-10 mb-16">
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-2 mb-6">
              <div className="w-6 h-6 rounded flex items-center justify-center bg-violet-600 text-white">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2 12h4l3-9 5 18 3-9h5"/></svg>
              </div>
              <span className="font-bold">SnapServe</span>
            </div>
            <p className="text-sm text-gray-500">The voice AI platform that speaks your stack.</p>
          </div>
          
          <div>
            <h4 className="font-semibold mb-4 text-gray-200">Product</h4>
            <ul className="space-y-3 text-sm text-gray-500">
              <li><a href="#" className="hover:text-violet-400 transition-colors">Features</a></li>
              <li><a href="#" className="hover:text-violet-400 transition-colors">Providers</a></li>
              <li><a href="#" className="hover:text-violet-400 transition-colors">Pricing</a></li>
              <li><a href="#" className="hover:text-violet-400 transition-colors">Changelog</a></li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold mb-4 text-gray-200">Docs</h4>
            <ul className="space-y-3 text-sm text-gray-500">
              <li><a href="#" className="hover:text-violet-400 transition-colors">Quickstart</a></li>
              <li><a href="#" className="hover:text-violet-400 transition-colors">API Reference</a></li>
              <li><a href="#" className="hover:text-violet-400 transition-colors">SDKs</a></li>
              <li><a href="#" className="hover:text-violet-400 transition-colors">Examples</a></li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold mb-4 text-gray-200">Company</h4>
            <ul className="space-y-3 text-sm text-gray-500">
              <li><a href="#" className="hover:text-violet-400 transition-colors">About</a></li>
              <li><a href="#" className="hover:text-violet-400 transition-colors">Blog</a></li>
              <li><a href="#" className="hover:text-violet-400 transition-colors">Careers</a></li>
              <li><a href="#" className="hover:text-violet-400 transition-colors">Contact</a></li>
            </ul>
          </div>

          <div>
            <h4 className="font-semibold mb-4 text-gray-200">Legal</h4>
            <ul className="space-y-3 text-sm text-gray-500">
              <li><a href="#" className="hover:text-violet-400 transition-colors">Privacy Policy</a></li>
              <li><a href="#" className="hover:text-violet-400 transition-colors">Terms of Service</a></li>
              <li><a href="#" className="hover:text-violet-400 transition-colors">Cookie Policy</a></li>
              <li><a href="#" className="hover:text-violet-400 transition-colors">Security</a></li>
            </ul>
          </div>
        </div>
        
        <div className="max-w-7xl mx-auto pt-8 border-t border-white/5 flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-gray-600">
          <p>© {new Date().getFullYear()} SnapServe, Inc. All rights reserved.</p>
          <div className="flex gap-6">
            <a href="#" className="hover:text-gray-300">Twitter</a>
            <a href="#" className="hover:text-gray-300">GitHub</a>
            <a href="#" className="hover:text-gray-300">Discord</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
