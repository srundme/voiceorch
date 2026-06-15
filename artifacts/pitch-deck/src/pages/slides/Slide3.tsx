export default function Slide3() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-bg flex flex-col" style={{ padding: '6vh 7vw' }}>
      {/* Amber bar motif + slide counter */}
      <div className="absolute top-[6vh] left-[7vw] h-[0.3vh] w-[8vw] bg-primary" />
      <p className="absolute top-[5.5vh] right-[7vw] font-body text-[2.2vw] text-muted opacity-40">03 / 12</p>

      {/* Headline */}
      <div style={{ paddingTop: '3.5vh', marginBottom: '4vh' }}>
        <p className="font-body font-medium text-[2.2vw] uppercase tracking-[0.35em] text-primary mb-[1.5vh]">Three Blind Spots</p>
        <h2 className="font-display font-black text-[4vw] leading-tight tracking-tight text-text">What platforms get wrong</h2>
      </div>

      {/* Three columns */}
      <div className="flex gap-[2.5vw] flex-1 overflow-hidden">

        <div className="flex-1 bg-surface rounded-[1vw] overflow-hidden" style={{ borderTop: '0.35vh solid #F0A500', padding: '2.5vw 2.5vw' }}>
          <p className="font-display font-black text-[4vw] text-primary leading-none mb-[1.5vh]">01</p>
          <p className="font-display font-bold text-[2.8vw] text-text leading-tight tracking-tight mb-[1.5vh]">Gender-blind</p>
          <p className="font-body text-[2.4vw] text-muted leading-relaxed">Agents greet every caller the same. In Tamil and Hindi, that breaks trust from word one.</p>
        </div>

        <div className="flex-1 bg-surface rounded-[1vw] overflow-hidden" style={{ borderTop: '0.35vh solid #F0A500', padding: '2.5vw 2.5vw' }}>
          <p className="font-display font-black text-[4vw] text-primary leading-none mb-[1.5vh]">02</p>
          <p className="font-display font-bold text-[2.8vw] text-text leading-tight tracking-tight mb-[1.5vh]">Memory-less</p>
          <p className="font-body text-[2.4vw] text-muted leading-relaxed">Call ends, context disappears. Callers explain themselves from scratch on every call.</p>
        </div>

        <div className="flex-1 bg-surface rounded-[1vw] overflow-hidden" style={{ borderTop: '0.35vh solid #F0A500', padding: '2.5vw 2.5vw' }}>
          <p className="font-display font-black text-[4vw] text-primary leading-none mb-[1.5vh]">03</p>
          <p className="font-display font-bold text-[2.8vw] text-text leading-tight tracking-tight mb-[1.5vh]">Identity-less</p>
          <p className="font-body text-[2.4vw] text-muted leading-relaxed">Different number, new stranger. No platform tracks a caller across their phone numbers.</p>
        </div>

      </div>
    </div>
  );
}
