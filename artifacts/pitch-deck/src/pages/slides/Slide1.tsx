export default function Slide1() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-bg">
      {/* Decorative rings top-right */}
      <div className="absolute top-[-12vh] right-[-6vw] w-[42vw] h-[42vw] rounded-full border border-primary opacity-[0.08]" />
      <div className="absolute top-[-4vh] right-[4vw] w-[26vw] h-[26vw] rounded-full border border-primary opacity-[0.05]" />

      {/* Amber bar motif */}
      <div className="absolute top-[6.5vh] left-[7vw] h-[0.3vh] w-[8vw] bg-primary" />
      <p className="absolute top-[6vh] right-[7vw] font-body text-[2.2vw] text-muted opacity-40">01 / 12</p>

      {/* Main content */}
      <div className="absolute left-[7vw] top-1/2 -translate-y-1/2">
        <p className="font-body font-medium text-[2.2vw] tracking-[0.35em] uppercase text-primary mb-[2.5vh]">
          Voice Intelligence Platform
        </p>
        <h1 className="font-display font-black leading-none tracking-tighter text-text" style={{ fontSize: '9.5vw' }}>
          SnapServe<span className="text-primary"> AI</span>
        </h1>
        <div className="h-[0.3vh] w-[11vw] bg-primary mt-[3.5vh] mb-[4vh]" />
        <p className="font-body text-[3.2vw] text-muted leading-relaxed" style={{ maxWidth: '40vw', textWrap: 'pretty' }}>
          The AI brain for every phone call in India
        </p>
      </div>

      {/* Bottom label */}
      <p className="absolute bottom-[5.5vh] left-[7vw] font-body text-[2.2vw] text-muted opacity-30 tracking-widest uppercase">
        Investor Presentation · 2026
      </p>

      {/* Bottom-right amber accent */}
      <div className="absolute bottom-0 right-0 w-[18vw] h-[2vh] bg-primary opacity-60" />
    </div>
  );
}
