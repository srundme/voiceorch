export default function Slide10() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-bg flex">
      {/* Amber bar motif + slide counter */}
      <div className="absolute top-[6vh] left-[7vw] h-[0.3vh] w-[8vw] bg-primary" />
      <p className="absolute top-[5.5vh] right-[7vw] font-body text-[2.2vw] text-muted opacity-40">10 / 12</p>

      {/* Left column */}
      <div className="flex flex-col pl-[7vw] pr-[3vw] w-[52%] overflow-hidden" style={{ paddingTop: '10vh', paddingBottom: '7vh', gap: '2vh' }}>
        <p className="font-body font-medium text-[2.2vw] uppercase tracking-[0.35em] text-primary">Business Model</p>
        <h2 className="font-display font-black text-[3.8vw] leading-none tracking-tighter text-text">BYOK Orchestration</h2>
        <p className="font-body text-[2.3vw] text-muted leading-snug">Businesses bring their own ASR / LLM / TTS keys and pay providers at cost. We charge a flat orchestration fee per active agent — never per minute.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.4vh', marginTop: '0.5vh' }}>
          <div className="flex items-center gap-[1.2vw]">
            <div className="w-[0.45vw] h-[0.45vw] rounded-full bg-primary shrink-0" />
            <p className="font-body text-[2.3vw] text-text">Recurring SaaS revenue per active agent</p>
          </div>
          <div className="flex items-center gap-[1.2vw]">
            <div className="w-[0.45vw] h-[0.45vw] rounded-full bg-primary shrink-0" />
            <p className="font-body text-[2.3vw] text-text">Zero markup on AI provider costs</p>
          </div>
          <div className="flex items-center gap-[1.2vw]">
            <div className="w-[0.45vw] h-[0.45vw] rounded-full bg-primary shrink-0" />
            <p className="font-body text-[2.3vw] text-text">Margin scales with agents, not call volume</p>
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="absolute left-[52%] top-[10vh] bottom-[7vh] w-[0.15vw] bg-border-line" />

      {/* Right column */}
      <div className="flex flex-col pl-[4vw] pr-[7vw] w-[48%] overflow-hidden" style={{ paddingTop: '11vh', paddingBottom: '7vh', gap: '1.6vh' }}>
        <p className="font-body font-medium text-[2.1vw] uppercase tracking-wider text-muted">Pricing · per agent / month</p>

        <div className="flex justify-between items-baseline py-[1.4vh]" style={{ borderBottom: '1px solid #22223A' }}>
          <p className="font-body text-[2.4vw] text-text">Starter</p>
          <p className="font-display font-bold text-[2.8vw] text-text">₹4,999</p>
        </div>
        <div className="flex justify-between items-baseline py-[1.4vh]" style={{ borderBottom: '1px solid #22223A' }}>
          <p className="font-body text-[2.4vw] text-text">Growth <span className="text-muted text-[1.9vw]">(5+ agents)</span></p>
          <p className="font-display font-bold text-[2.8vw] text-text">₹3,999</p>
        </div>
        <div className="flex justify-between items-baseline py-[1.4vh]" style={{ borderBottom: '1px solid #22223A' }}>
          <p className="font-body text-[2.4vw] text-text">Enterprise</p>
          <p className="font-display font-bold text-[2.8vw] text-text">Custom</p>
        </div>

        <div className="rounded-[1vw] px-[2.5vw] py-[2vh]" style={{ background: '#F0A500', marginTop: '0.8vh' }}>
          <p className="font-display font-black leading-none text-bg" style={{ fontSize: '4.5vw' }}>
            <span style={{ whiteSpace: 'nowrap' }}>60–80%</span>
          </p>
          <p className="font-body text-[2.2vw] text-bg mt-[1vh] opacity-80 leading-snug">lower total cost than per-minute platforms — clients pay providers directly, no AI markup.</p>
        </div>
      </div>
    </div>
  );
}
