export default function Slide5() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-bg">
      {/* Amber bar motif */}
      <div className="absolute top-[6.5vh] left-[7vw] h-[0.3vh] w-[8vw] bg-primary" />
      <p className="absolute top-[6vh] right-[7vw] font-body text-[2.2vw] text-muted opacity-40">05 / 12</p>

      {/* Section label + headline */}
      <div className="absolute top-[11vh] left-[7vw]">
        <p className="font-body font-medium text-[2.2vw] uppercase tracking-[0.35em] text-primary mb-[1.5vh]">
          Intelligence Layer 01
        </p>
        <h2 className="font-display font-black text-[5.5vw] leading-tight tracking-tight text-text">
          Voice Gender AI
        </h2>
      </div>

      {/* Left — hero stat */}
      <div className="absolute left-[7vw] top-[36vh]">
        <p className="font-display font-black leading-none tracking-tighter text-primary" style={{ fontSize: '11vw' }}>5 sec</p>
        <p className="font-body text-[3vw] text-muted mt-[2vh] leading-snug" style={{ maxWidth: '32vw' }}>
          to detect caller gender from voice acoustics — before a word is spoken
        </p>
      </div>

      {/* Right — key points */}
      <div className="absolute right-[7vw] top-1/2 -translate-y-1/2 w-[38vw]">
        <div className="space-y-[4vh]">

          <div className="bg-surface rounded-[1vw] p-[2.5vw]" style={{ borderLeft: '0.4vw solid #F0A500' }}>
            <p className="font-display font-bold text-[3.2vw] text-text leading-tight">Adapts language in real time</p>
            <p className="font-body text-[2.8vw] text-muted mt-[1vh] leading-relaxed">
              Greeting, salutation, and tone shift automatically. Tamil agents use the right gender form from the first sentence.
            </p>
          </div>

          <div className="bg-surface rounded-[1vw] p-[2.5vw]" style={{ borderLeft: '0.4vw solid #F0A500' }}>
            <p className="font-display font-bold text-[3.2vw] text-text leading-tight">No other platform does this</p>
            <p className="font-body text-[2.8vw] text-muted mt-[1vh] leading-relaxed">
              Bolna, Vapi, and every English-first tool treats gender as irrelevant. In India, it is not.
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}
