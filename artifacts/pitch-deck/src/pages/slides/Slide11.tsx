export default function Slide11() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-bg flex">
      {/* Amber bar motif + slide counter */}
      <div className="absolute top-[6vh] left-[7vw] h-[0.3vh] w-[8vw] bg-primary" />
      <p className="absolute top-[5.5vh] right-[7vw] font-body text-[2.2vw] text-muted opacity-40">11 / 12</p>

      {/* Left column */}
      <div className="flex flex-col pl-[7vw] pr-[3vw] w-[54%] overflow-hidden" style={{ paddingTop: '10vh', paddingBottom: '7vh', gap: '1.8vh' }}>
        <p className="font-body font-medium text-[2.2vw] uppercase tracking-[0.35em] text-primary">The Ask</p>
        <h2 className="font-display font-black text-[4.2vw] leading-none tracking-tighter text-text">Built &amp; live.</h2>
        <p className="font-body text-[2.3vw] text-muted leading-snug">First raise. The full platform is built and running — we're funding runway to land our first paying cohort.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.3vh', marginTop: '0.4vh' }}>
          <div className="flex items-center gap-[1.2vw]">
            <div className="w-[0.45vw] h-[0.45vw] rounded-full bg-primary shrink-0" />
            <p className="font-body text-[2.2vw] text-text">Real-time pipeline — ASR · LLM · TTS · Telephony</p>
          </div>
          <div className="flex items-center gap-[1.2vw]">
            <div className="w-[0.45vw] h-[0.45vw] rounded-full bg-primary shrink-0" />
            <p className="font-body text-[2.2vw] text-text">Gender AI + Caller Memory + Fingerprinting</p>
          </div>
          <div className="flex items-center gap-[1.2vw]">
            <div className="w-[0.45vw] h-[0.45vw] rounded-full bg-primary shrink-0" />
            <p className="font-body text-[2.2vw] text-text">Campaigns · Scheduling · Analytics shipped</p>
          </div>
          <div className="flex items-center gap-[1.2vw]">
            <div className="w-[0.45vw] h-[0.45vw] rounded-full bg-primary shrink-0" />
            <p className="font-body text-[2.2vw] text-text">Target sectors: BFSI, healthcare, D2C</p>
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="absolute left-[54%] top-[10vh] bottom-[7vh] w-[0.15vw] bg-border-line" />

      {/* Right column */}
      <div className="flex flex-col pl-[5vw] pr-[7vw] w-[46%] overflow-hidden" style={{ paddingTop: '9.5vh', paddingBottom: '6vh', gap: '0.9vh' }}>
        <p className="font-body font-medium text-[2.1vw] uppercase tracking-wider text-muted">Raising</p>
        <p className="font-display font-black text-[5.2vw] text-primary leading-none tracking-tighter">₹1.3 Cr</p>
        <p className="font-body text-[2.2vw] text-muted leading-snug">₹7L / month burn · ~18 months of runway.</p>

        <p className="font-body font-medium text-[1.9vw] uppercase tracking-wider text-muted mt-[1vh]">Use of funds</p>
        <div className="flex justify-between items-baseline py-[0.8vh]" style={{ borderBottom: '1px solid #22223A' }}>
          <p className="font-body text-[2.1vw] text-text">Product &amp; infra</p>
          <p className="font-display font-bold text-[2.3vw] text-text">45%</p>
        </div>
        <div className="flex justify-between items-baseline py-[0.8vh]" style={{ borderBottom: '1px solid #22223A' }}>
          <p className="font-body text-[2.1vw] text-text">GTM &amp; sales</p>
          <p className="font-display font-bold text-[2.3vw] text-text">35%</p>
        </div>
        <div className="flex justify-between items-baseline py-[0.8vh]" style={{ borderBottom: '1px solid #22223A' }}>
          <p className="font-body text-[2.1vw] text-text">Compliance &amp; ops</p>
          <p className="font-display font-bold text-[2.3vw] text-text">20%</p>
        </div>

        <div className="rounded-[1vw] px-[2.5vw] py-[1.3vh]" style={{ background: '#F0A500', marginTop: '0.6vh' }}>
          <p className="font-body text-[1.8vw] text-bg opacity-70 mb-[0.3vh]">18-month goal (target)</p>
          <p className="font-display font-black text-[2.2vw] text-bg leading-tight">First paying cohort · BFSI pilot live</p>
        </div>
      </div>
    </div>
  );
}
