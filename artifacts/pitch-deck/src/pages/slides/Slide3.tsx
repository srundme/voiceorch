export default function Slide3() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-bg">
      {/* Amber bar motif */}
      <div className="absolute top-[6.5vh] left-[7vw] h-[0.3vh] w-[8vw] bg-primary" />
      <p className="absolute top-[6vh] right-[7vw] font-body text-[2.2vw] text-muted opacity-40">03 / 12</p>

      {/* Headline */}
      <div className="absolute top-[11vh] left-[7vw]">
        <p className="font-body font-medium text-[2.2vw] uppercase tracking-[0.35em] text-primary mb-[1.5vh]">
          Three Blind Spots
        </p>
        <h2 className="font-display font-black text-[5vw] leading-tight tracking-tight text-text">
          What every voice platform gets wrong
        </h2>
      </div>

      {/* Three columns */}
      <div className="absolute bottom-[7vh] left-[7vw] right-[7vw] flex gap-[3vw]">

        {/* Column 1 */}
        <div className="flex-1 bg-surface rounded-[1vw] p-[3vw]" style={{ borderTop: '0.3vh solid #F0A500' }}>
          <p className="font-display font-black text-[5.5vw] text-primary leading-none mb-[2vh]">01</p>
          <p className="font-display font-bold text-[3.2vw] text-text leading-tight tracking-tight mb-[1.5vh]">
            Gender-blind
          </p>
          <p className="font-body text-[2.8vw] text-muted leading-relaxed">
            Agents greet every caller the same way. In Tamil, that's immediately wrong.
          </p>
        </div>

        {/* Column 2 */}
        <div className="flex-1 bg-surface rounded-[1vw] p-[3vw]" style={{ borderTop: '0.3vh solid #F0A500' }}>
          <p className="font-display font-black text-[5.5vw] text-primary leading-none mb-[2vh]">02</p>
          <p className="font-display font-bold text-[3.2vw] text-text leading-tight tracking-tight mb-[1.5vh]">
            Memory-less
          </p>
          <p className="font-body text-[2.8vw] text-muted leading-relaxed">
            Call ends, context disappears. Callers re-explain their situation every single time.
          </p>
        </div>

        {/* Column 3 */}
        <div className="flex-1 bg-surface rounded-[1vw] p-[3vw]" style={{ borderTop: '0.3vh solid #F0A500' }}>
          <p className="font-display font-black text-[5.5vw] text-primary leading-none mb-[2vh]">03</p>
          <p className="font-display font-bold text-[3.2vw] text-text leading-tight tracking-tight mb-[1.5vh]">
            Identity-less
          </p>
          <p className="font-body text-[2.8vw] text-muted leading-relaxed">
            No platform can recognise a known caller from a different number. Every call is a stranger.
          </p>
        </div>

      </div>
    </div>
  );
}
