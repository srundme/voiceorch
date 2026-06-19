import './_group.css';

const WAVE_BARS = 20;

const PROVIDERS = [
  { name: 'Deepgram', color: '#10b981', cat: 'ASR' },
  { name: 'OpenAI', color: '#14b8a6', cat: 'LLM' },
  { name: 'ElevenLabs', color: '#f43f5e', cat: 'TTS' },
  { name: 'Cartesia', color: '#a78bfa', cat: 'TTS' },
  { name: 'Twilio', color: '#ef4444', cat: 'TEL' },
  { name: 'Azure', color: '#3b82f6', cat: 'ASR' },
  { name: 'Anthropic', color: '#f97316', cat: 'LLM' },
  { name: 'Plivo', color: '#06b6d4', cat: 'TEL' },
  { name: 'Whisper', color: '#8b5cf6', cat: 'ASR' },
  { name: 'DeepSeek', color: '#6366f1', cat: 'LLM' },
];

const FEATURES = [
  {
    title: 'Bring Your Own Providers',
    desc: 'Mix any ASR, LLM, TTS, or telephony provider. Zero lock-in — swap keys without changing your agent config.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
      </svg>
    ),
  },
  {
    title: 'Real-time Transcription',
    desc: 'Sub-200ms streaming transcription with word-level timestamps and automatic language detection.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
      </svg>
    ),
  },
  {
    title: 'Multi-language Support',
    desc: 'Native support for 30+ languages including Indian languages — Tamil, Hindi, Telugu, and Hinglish.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
      </svg>
    ),
  },
  {
    title: 'Call Recording & Logs',
    desc: 'Full stereo recordings, detailed transcripts, and structured interaction logs. Stored securely, searchable instantly.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M15 10l4.553-2.276A1 1 0 0 1 21 8.618v6.764a1 1 0 0 1-1.447.894L15 14M5 18h8a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2z"/>
      </svg>
    ),
  },
  {
    title: 'Scheduling & Bookings',
    desc: 'Native Google Calendar integration. Agents book appointments mid-call, with slot locking to prevent double-booking.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
      </svg>
    ),
  },
  {
    title: 'Enterprise Compliance',
    desc: 'Built-in DPDP PII scanning, call disclosure, data retention controls, and IRDAI/TRAI readiness.',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
      </svg>
    ),
  },
];

export function LandingPage() {
  const providerTrack = [...PROVIDERS, ...PROVIDERS];

  return (
    <div className="ss">

      {/* ── Nav ── */}
      <nav className="ss-nav">
        <div className="ss-logo">
          <div className="ss-logo-icon">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 12h4l3-9 5 18 3-9h5"/>
            </svg>
          </div>
          SnapServe
        </div>

        <ul className="ss-nav-links">
          <li><a href="#">Product</a></li>
          <li><a href="#">Pricing</a></li>
          <li><a href="#">Docs</a></li>
          <li><a href="#">Blog</a></li>
        </ul>

        <div className="ss-nav-actions">
          <a href="#" className="ss-link">Sign in</a>
          <button className="ss-btn-primary">Get started free</button>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="ss-hero">
        <div className="ss-hero-bg">
          <div className="ss-grid-bg" />
          <div className="ss-hero-glow" />
        </div>

        <div className="ss-badge ss-reveal">
          <span className="ss-badge-dot" />
          SnapServe 2.0 — now with BYOP billing
        </div>

        <h1 className="ss-reveal ss-d1">
          Orchestrate AI Voice<br />Agents at Scale
        </h1>

        <p className="ss-reveal ss-d2">
          The voice AI platform that speaks your stack. Connect your own providers or use our managed infrastructure — deploy production-ready agents in minutes.
        </p>

        <div className="ss-hero-actions ss-reveal ss-d3">
          <button className="ss-btn-hero">Get started free →</button>
          <button className="ss-btn-ghost">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            Watch demo
          </button>
        </div>

        {/* Waveform visual */}
        <div className="ss-reveal ss-d4" style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div className="ss-wave-wrap">
            {Array.from({ length: WAVE_BARS }).map((_, i) => (
              <div key={i} className="ss-wave-bar" />
            ))}
          </div>
          <p className="ss-wave-label">Live voice stream · 38ms latency</p>
        </div>

        {/* Agent conversation card */}
        <div className="ss-agent-card ss-reveal ss-d5">
          <div className="ss-agent-meta">
            <span className="ss-dot-live" />
            <span>Agent "Support-01" · Deepgram ASR · GPT-4o · Cartesia TTS</span>
          </div>
          <div className="ss-bubble-agent">
            Hi! I'm calling from SnapServe support. I see your subscription renews in 3 days — would you like to review your current plan?
          </div>
          <div className="ss-bubble-user">
            Yes, actually I wanted to ask about the BYOP pricing option.
          </div>
          <div className="ss-bubble-agent">
            Great question. With BYOP, you pay just $0.035 per minute and bring your own API keys. We handle all the orchestration, endpointing, and failover automatically.
          </div>
        </div>
      </section>

      {/* ── Provider logos ── */}
      <div className="ss-logos">
        <p className="ss-logos-label">Works with every major provider</p>
        <div style={{ overflow: 'hidden', padding: '0 2rem' }}>
          <div className="ss-logos-track">
            {providerTrack.map((p, i) => (
              <div key={i} className="ss-logo-item">
                <span className="ss-logo-dot" style={{ background: p.color }} />
                {p.name}
                <span style={{ fontSize: '0.65rem', color: '#2a2a44', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', marginLeft: '0.1rem' }}>{p.cat}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── How it works ── */}
      <div className="ss-section">
        <p className="ss-eyebrow">How it works</p>
        <h2 className="ss-section-h">From idea to live agent in three steps</h2>
        <p className="ss-section-sub" style={{ color: '#555572' }}>
          No complex integration code. SnapServe handles real-time audio streaming, endpointing, barge-in, and interruption handling out of the box.
        </p>

        <div className="ss-steps">
          {[
            { n: '01', title: 'Build your agent', desc: 'Define persona, system prompt, and tools using our visual builder or REST API. Set greetings, memory, and call-end conditions.' },
            { n: '02', title: 'Connect providers', desc: 'Add your own Deepgram, OpenAI, Cartesia, or Twilio keys — or use our managed defaults. Switch any provider without touching agent config.' },
            { n: '03', title: 'Go live', desc: 'Deploy via embeddable web widget, connect a phone number, or trigger outbound campaigns with scheduling. Monitor every call in real time.' },
          ].map((s, i) => (
            <div key={i} className="ss-step">
              <div className="ss-step-num">{s.n}</div>
              <h3>{s.title}</h3>
              <p>{s.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Features ── */}
      <div className="ss-features-wrap">
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '4rem 2.5rem 2rem' }}>
          <p className="ss-eyebrow">Capabilities</p>
          <h2 className="ss-section-h">Everything your voice AI needs</h2>
        </div>
        <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 2.5rem 4rem' }}>
          <div className="ss-features" style={{ borderTop: '1px solid rgba(255,255,255,0.05)', borderLeft: '1px solid rgba(255,255,255,0.05)' }}>
            {FEATURES.map((f, i) => (
              <div key={i} className="ss-feat" style={{ borderRight: '1px solid rgba(255,255,255,0.05)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <div className="ss-feat-icon">{f.icon}</div>
                <h3>{f.title}</h3>
                <p>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Pricing ── */}
      <div className="ss-section">
        <p className="ss-eyebrow">Pricing</p>
        <h2 className="ss-section-h">Simple, transparent pricing</h2>
        <p className="ss-section-sub" style={{ color: '#555572' }}>Pay only for what you use. No seat fees, no minimums, no hidden costs.</p>

        <div className="ss-pricing-grid">
          {/* BYOP */}
          <div className="ss-plan">
            <p className="ss-plan-name">BYOP</p>
            <p className="ss-plan-price">$0.035<span>/min</span></p>
            <p className="ss-plan-desc">You bring your own API keys. We orchestrate everything else.</p>
            <ul className="ss-plan-features">
              {['Orchestration engine', 'Web widget & telephony', 'Full analytics & call logs', 'Unlimited concurrent calls', 'Any provider combination'].map((item, i) => (
                <li key={i}>
                  <svg className="ss-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 13l4 4L19 7"/></svg>
                  {item}
                </li>
              ))}
            </ul>
            <button className="ss-plan-btn">Get started with BYOP</button>
          </div>

          {/* Managed */}
          <div className="ss-plan ss-plan-featured">
            <div className="ss-plan-badge">Most Popular</div>
            <p className="ss-plan-name" style={{ color: '#9d8fff' }}>Managed</p>
            <p className="ss-plan-price" style={{ background: 'linear-gradient(135deg, #c4b5fd, #e0d9ff)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              $0.05<span style={{ WebkitTextFillColor: '#555572' }}>/min</span>
            </p>
            <p className="ss-plan-desc">Zero setup. Premium models and voices included — just add your system prompt.</p>
            <ul className="ss-plan-features">
              {['Everything in BYOP', 'Premium ASR included', 'State-of-the-art LLM', 'High-quality TTS voices', 'Priority support & SLA'].map((item, i) => (
                <li key={i}>
                  <svg className="ss-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2.5"><path d="M5 13l4 4L19 7"/></svg>
                  {item}
                </li>
              ))}
            </ul>
            <button className="ss-plan-btn-featured">Start with Managed →</button>
          </div>
        </div>
      </div>

      {/* ── CTA ── */}
      <div className="ss-cta-wrap">
        <div className="ss-cta">
          <p className="ss-eyebrow" style={{ textAlign: 'center' }}>Get started</p>
          <h2>Start building<br />in minutes</h2>
          <p>Join teams using SnapServe to deploy production-ready voice AI agents — no infrastructure required.</p>
          <div className="ss-input-row">
            <input className="ss-input" type="email" placeholder="your@email.com" />
            <button className="ss-btn-hero" style={{ whiteSpace: 'nowrap' }}>Get access →</button>
          </div>
        </div>
      </div>

      {/* ── Footer ── */}
      <footer className="ss-footer">
        <div className="ss-footer-inner">
          <div className="ss-footer-top">
            <div className="ss-footer-brand">
              <div className="ss-logo" style={{ marginBottom: 0 }}>
                <div className="ss-logo-icon" style={{ width: 22, height: 22, borderRadius: 6 }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 12h4l3-9 5 18 3-9h5"/>
                  </svg>
                </div>
                SnapServe
              </div>
              <p>The voice AI platform that speaks your stack.</p>
            </div>

            <div className="ss-footer-cols">
              {[
                { heading: 'Product', links: ['Features', 'Providers', 'Pricing', 'Changelog'] },
                { heading: 'Docs', links: ['Quickstart', 'API Reference', 'SDKs', 'Examples'] },
                { heading: 'Company', links: ['About', 'Blog', 'Careers', 'Contact'] },
                { heading: 'Legal', links: ['Privacy', 'Terms', 'Security', 'Cookies'] },
              ].map((col, i) => (
                <div key={i} className="ss-footer-col">
                  <h4>{col.heading}</h4>
                  <ul>
                    {col.links.map((l, j) => <li key={j}><a href="#">{l}</a></li>)}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          <div className="ss-footer-bottom">
            <span>© {new Date().getFullYear()} SnapServe, Inc.</span>
            <div className="ss-footer-socials">
              <a href="#">Twitter</a>
              <a href="#">GitHub</a>
              <a href="#">Discord</a>
            </div>
          </div>
        </div>
      </footer>

    </div>
  );
}
