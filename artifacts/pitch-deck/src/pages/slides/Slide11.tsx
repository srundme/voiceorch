export default function Slide11() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-bg flex">
      {/* Amber bar motif + slide counter */}
      <div className="absolute top-[6vh] left-[7vw] h-[0.3vh] w-[8vw] bg-primary" />
      <p className="absolute top-[5.5vh] right-[7vw] font-body text-[2.2vw] text-muted opacity-40">11 / 12</p>

      {/* Left column */}
      <div className="flex flex-col pl-[7vw] pr-[3vw] w-[54%] overflow-hidden" style={{ paddingTop: '11vh', paddingBottom: '8vh', gap: '2.5vh' }}>
        <p className="font-body font-medium text-[2.2vw] uppercase tracking-[0.35em] text-primary">The Ask</p>
        <h2 className="font-display font-black text-[4.5vw] leading-none tracking-tighter text-text">Live today.</h2>
        <p className="font-body text-[2.6vw] text-muted leading-snug">Seeking investment for 24-month runway to scale.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.8vh' }}>
          <div className="flex items-center gap-[1.2vw]">
            <div className="w-[0.45vw] h-[0.45vw] rounded-full bg-primary shrink-0" />
            <p className="font-body text-[2.6vw] text-text">Real-time pipeline — ASR · LLM · TTS · Telephony</p>
          </div>
          <div className="flex items-center gap-[1.2vw]">
            <div className="w-[0.45vw] h-[0.45vw] rounded-full bg-primary shrink-0" />
            <p className="font-body text-[2.6vw] text-text">Gender AI + Caller Memory + Fingerprinting</p>
          </div>
          <div className="flex items-center gap-[1.2vw]">
            <div className="w-[0.45vw] h-[0.45vw] rounded-full bg-primary shrink-0" />
            <p className="font-body text-[2.6vw] text-text">Campaigns · Scheduling · Analytics</p>
          </div>
          <div className="flex items-center gap-[1.2vw]">
            <div className="w-[0.45vw] h-[0.45vw] rounded-full bg-primary shrink-0" />
            <p className="font-body text-[2.6vw] text-text">BFSI, healthcare, D2C in pipeline</p>
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="absolute left-[54%] top-[11vh] bottom-[8vh] w-[0.15vw] bg-border-line" />

      {/* Right column */}
      <div className="flex flex-col pl-[5vw] pr-[7vw] w-[46%] overflow-hidden" style={{ paddingTop: '12vh', paddingBottom: '8vh', gap: '1.8vh' }}>
        <p className="font-display font-bold text-[2.8vw] text-text tracking-tight">24-month targets</p>

        <div className="flex justify-between items-baseline py-[1.6vh]" style={{ borderBottom: '1px solid #22223A' }}>
          <p className="font-body text-[2.5vw] text-muted">ARR</p>
          <p className="font-display font-bold text-[2.8vw] text-text">₹2 Cr</p>
        </div>
        <div className="flex justify-between items-baseline py-[1.6vh]" style={{ borderBottom: '1px solid #22223A' }}>
          <p className="font-body text-[2.5vw] text-muted">Enterprise accounts</p>
          <p className="font-display font-bold text-[2.8vw] text-text">50</p>
        </div>
        <div className="flex justify-between items-baseline py-[1.6vh]" style={{ borderBottom: '1px solid #22223A' }}>
          <p className="font-body text-[2.5vw] text-muted">Monthly minutes</p>
          <p className="font-display font-bold text-[2.8vw] text-text">5M</p>
        </div>

        <div className="rounded-[1vw] px-[2.5vw] py-[2vh]" style={{ background: '#F0A500', marginTop: '0.5vh' }}>
          <p className="font-body text-[2.3vw] text-bg opacity-70 mb-[0.8vh]">Investment use</p>
          <p className="font-display font-black text-[3vw] text-bg leading-tight">Infra · GTM · Compliance</p>
        </div>
      </div>
    </div>
  );
}
