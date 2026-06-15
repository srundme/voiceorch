export default function Slide5() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-bg flex">
      {/* Amber bar motif + slide counter */}
      <div className="absolute top-[6vh] left-[7vw] h-[0.3vh] w-[8vw] bg-primary" />
      <p className="absolute top-[5.5vh] right-[7vw] font-body text-[2.2vw] text-muted opacity-40">05 / 12</p>

      {/* Left column */}
      <div className="flex flex-col pl-[7vw] pr-[3vw] w-[50%] overflow-hidden" style={{ paddingTop: '11vh', paddingBottom: '8vh', gap: '2vh' }}>
        <p className="font-body font-medium text-[2.2vw] uppercase tracking-[0.35em] text-primary">Intelligence Layer 01</p>
        <h2 className="font-display font-black text-[4vw] leading-none tracking-tighter text-text">Voice Gender AI</h2>
        <p className="font-display font-black leading-none tracking-tighter text-primary" style={{ fontSize: '11vw', marginTop: '2vh' }}>5s</p>
        <p className="font-body text-[2.7vw] text-muted leading-snug">to detect caller gender from voice acoustics alone.</p>
      </div>

      {/* Divider */}
      <div className="absolute left-[50%] top-[11vh] bottom-[8vh] w-[0.15vw] bg-border-line" />

      {/* Right column — 2 flex-1 cards */}
      <div className="flex flex-col pl-[4vw] pr-[7vw] w-[50%] overflow-hidden" style={{ paddingTop: '12vh', paddingBottom: '8vh', gap: '4vh' }}>
        <div className="bg-surface rounded-[1vw] px-[2.5vw] py-[3vh] flex-1 overflow-hidden" style={{ borderLeft: '0.4vw solid #F0A500' }}>
          <p className="font-display font-bold text-[3vw] text-text leading-tight mb-[2vh]">Adapts language in real time</p>
          <p className="font-body text-[2.5vw] text-muted leading-snug">Correct gender form, auto-applied, from word one.</p>
        </div>
        <div className="bg-surface rounded-[1vw] px-[2.5vw] py-[3vh] flex-1 overflow-hidden" style={{ borderLeft: '0.4vw solid #F0A500' }}>
          <p className="font-display font-bold text-[3vw] text-text leading-tight mb-[2vh]">No competitor does this</p>
          <p className="font-body text-[2.5vw] text-muted leading-snug">Bolna and Vapi ignore gender. In India it breaks caller trust.</p>
        </div>
      </div>
    </div>
  );
}
