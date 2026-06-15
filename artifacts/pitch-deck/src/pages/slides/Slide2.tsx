export default function Slide2() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-bg flex">
      {/* Amber bar motif + slide counter */}
      <div className="absolute top-[6vh] left-[7vw] h-[0.3vh] w-[8vw] bg-primary" />
      <p className="absolute top-[5.5vh] right-[7vw] font-body text-[2.2vw] text-muted opacity-40">02 / 12</p>

      {/* Left column */}
      <div className="flex flex-col justify-center pl-[7vw] pr-[2vw] w-[50%] overflow-hidden" style={{ paddingTop: '13vh', paddingBottom: '8vh' }}>
        <p className="font-body font-medium text-[2.2vw] uppercase tracking-[0.35em] text-primary mb-[2vh]">The Problem</p>
        <p className="font-display font-black leading-none tracking-tighter text-primary" style={{ fontSize: '7.5vw' }}>500M</p>
        <p className="font-body text-[3vw] text-text mt-[1.5vh]">vernacular voice users in India.</p>
        <div className="h-[0.25vh] w-[6vw] bg-primary mt-[2.5vh] mb-[2.5vh]" />
        <p className="font-body text-[2.8vw] text-muted">Zero platforms built for them.</p>
      </div>

      {/* Divider */}
      <div className="absolute left-[50%] top-[13vh] bottom-[8vh] w-[0.15vw] bg-border-line" />

      {/* Right column — 2 sections */}
      <div className="flex flex-col justify-center pl-[4vw] pr-[7vw] w-[50%] overflow-hidden" style={{ paddingTop: '13vh', paddingBottom: '8vh', gap: '4vh' }}>
        <div>
          <p className="font-display font-bold text-[3.2vw] text-text leading-tight tracking-tight mb-[1.5vh]">Gender-inflected languages</p>
          <p className="font-body text-[2.8vw] text-muted leading-relaxed">Tamil, Hindi, Telugu — gender shapes every greeting. English-first AI ignores this entirely.</p>
        </div>
        <div>
          <p className="font-display font-bold text-[3.2vw] text-text leading-tight tracking-tight mb-[1.5vh]">No memory, no identity</p>
          <p className="font-body text-[2.8vw] text-muted leading-relaxed">Every call starts from zero. No platform knows who called or recognises them across numbers.</p>
        </div>
      </div>
    </div>
  );
}
