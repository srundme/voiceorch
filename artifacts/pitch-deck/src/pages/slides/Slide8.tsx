export default function Slide8() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-bg flex flex-col" style={{ padding: '0 7vw 6vh 7vw' }}>
      {/* Decorative ring */}
      <div className="absolute top-[-8vh] right-[-4vw] w-[38vw] h-[38vw] rounded-full border border-primary opacity-[0.07]" />

      {/* Amber bar motif + slide counter */}
      <div className="absolute top-[6vh] left-[7vw] h-[0.3vh] w-[8vw] bg-primary" />
      <p className="absolute top-[5.5vh] right-[7vw] font-body text-[2.2vw] text-muted opacity-40">08 / 12</p>

      {/* Headline */}
      <div style={{ paddingTop: '10vh', marginBottom: '2.5vh' }}>
        <p className="font-body font-medium text-[2.2vw] uppercase tracking-[0.35em] text-primary mb-[1.5vh]">Market Opportunity</p>
        <h2 className="font-display font-black text-[4vw] leading-none tracking-tighter text-text">India Voice AI · TAM / SAM / SOM</h2>
      </div>

      {/* Three layered cards */}
      <div className="flex gap-[2vw] flex-1 overflow-hidden">

        <div className="flex-1 bg-surface rounded-[1vw] overflow-hidden flex flex-col" style={{ borderTop: '0.35vh solid #22223A', padding: '2vw' }}>
          <p className="font-body font-medium text-[2.1vw] uppercase tracking-[0.2em] text-muted">TAM</p>
          <p className="font-display font-black text-[3.6vw] text-text leading-none tracking-tighter mt-[1.5vh]">₹40,000 Cr</p>
          <p className="font-body text-[2.3vw] text-muted mt-[1.2vh] leading-snug">India conversational &amp; voice-AI plus contact-centre automation by 2030.</p>
        </div>

        <div className="flex-1 bg-surface rounded-[1vw] overflow-hidden flex flex-col" style={{ borderTop: '0.35vh solid #6B6B80', padding: '2vw' }}>
          <p className="font-body font-medium text-[2.1vw] uppercase tracking-[0.2em] text-muted">SAM</p>
          <p className="font-display font-black text-[3.6vw] text-text leading-none tracking-tighter mt-[1.5vh]">₹9,000 Cr</p>
          <p className="font-body text-[2.3vw] text-muted mt-[1.2vh] leading-snug">Vernacular, voice-first automation for BFSI, healthcare &amp; D2C in India.</p>
        </div>

        <div className="flex-1 rounded-[1vw] overflow-hidden flex flex-col" style={{ background: '#F0A500', padding: '2vw' }}>
          <p className="font-body font-medium text-[2.1vw] uppercase tracking-[0.2em] text-bg opacity-70">SOM · 3-yr wedge</p>
          <p className="font-display font-black text-[3.6vw] text-bg leading-none tracking-tighter mt-[1.5vh]">₹450 Cr</p>
          <p className="font-body text-[2.3vw] text-bg opacity-80 mt-[1.2vh] leading-snug">Mid-market businesses on BYOK orchestration — gender-aware, memory-driven agents.</p>
        </div>

      </div>

      {/* Source / framing footnote */}
      <p className="font-body text-[1.9vw] text-muted opacity-50 mt-[2.5vh]">Estimates from public market sizing; figures are forward projections, not booked revenue.</p>
    </div>
  );
}
