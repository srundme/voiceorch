export default function Slide2() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-bg">
      {/* Amber bar motif */}
      <div className="absolute top-[6.5vh] left-[7vw] h-[0.3vh] w-[8vw] bg-primary" />
      <p className="absolute top-[6vh] right-[7vw] font-body text-[2.2vw] text-muted opacity-40">02 / 12</p>

      {/* Section label */}
      <p className="absolute top-[9vh] left-[7vw] font-body font-medium text-[2.2vw] uppercase tracking-[0.35em] text-primary">
        The Problem
      </p>

      {/* Left — hero stat */}
      <div className="absolute left-[7vw] top-[20vh]">
        <p className="font-display font-black leading-none tracking-tighter text-primary" style={{ fontSize: '13vw' }}>500M</p>
        <p className="font-body text-[3.2vw] text-text mt-[2vh] leading-snug" style={{ maxWidth: '34vw' }}>
          vernacular voice users in India
        </p>
        <p className="font-body text-[2.8vw] text-muted mt-[2vh] leading-relaxed" style={{ maxWidth: '34vw' }}>
          Zero major voice AI platforms built for them.
        </p>
      </div>

      {/* Right — context */}
      <div className="absolute right-[7vw] top-1/2 -translate-y-1/2 w-[36vw]">
        <div className="border-l-[0.3vw] border-primary pl-[3vw]">
          <div className="mb-[5vh]">
            <p className="font-display font-bold text-[3.8vw] text-text leading-tight tracking-tight">Gender-inflected language</p>
            <p className="font-body text-[2.8vw] text-muted mt-[1.2vh] leading-relaxed">
              Tamil, Hindi, Telugu — gender shapes every greeting. Voice AI built for English ignores this entirely.
            </p>
          </div>
          <div>
            <p className="font-display font-bold text-[3.8vw] text-text leading-tight tracking-tight">Callers start from zero, every call</p>
            <p className="font-body text-[2.8vw] text-muted mt-[1.2vh] leading-relaxed">
              No platform remembers who called before, what they said, or who they are across numbers.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
