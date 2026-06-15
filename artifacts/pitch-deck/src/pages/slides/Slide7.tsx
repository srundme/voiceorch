export default function Slide7() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-bg">
      {/* Amber bar motif */}
      <div className="absolute top-[6.5vh] left-[7vw] h-[0.3vh] w-[8vw] bg-primary" />
      <p className="absolute top-[6vh] right-[7vw] font-body text-[2.2vw] text-muted opacity-40">07 / 12</p>

      {/* Section label + headline */}
      <div className="absolute top-[11vh] left-[7vw]">
        <p className="font-body font-medium text-[2.2vw] uppercase tracking-[0.35em] text-primary mb-[1.5vh]">
          Intelligence Layer 03
        </p>
        <h2 className="font-display font-black text-[5.5vw] leading-tight tracking-tight text-text">
          Voice Fingerprinting
        </h2>
      </div>

      {/* Left content */}
      <div className="absolute left-[7vw] top-[34vh]" style={{ width: '44vw' }}>
        <p className="font-body text-[3vw] text-muted leading-relaxed mb-[4vh]" style={{ maxWidth: '40vw' }}>
          Azure Speaker Recognition identifies callers by their voice biometric — even when they call from a different number.
        </p>

        <div className="space-y-[3vh]">
          <div className="flex items-start gap-[1.5vw]">
            <div className="w-[0.5vw] h-[0.5vw] rounded-full bg-primary mt-[1.5vh] shrink-0" />
            <p className="font-body text-[3vw] text-text leading-relaxed">Enrollment builds progressively across calls — target 60 s of clean speech</p>
          </div>
          <div className="flex items-start gap-[1.5vw]">
            <div className="w-[0.5vw] h-[0.5vw] rounded-full bg-primary mt-[1.5vh] shrink-0" />
            <p className="font-body text-[3vw] text-text leading-relaxed">Fraud prevention and KYC acceleration for BFSI</p>
          </div>
          <div className="flex items-start gap-[1.5vw]">
            <div className="w-[0.5vw] h-[0.5vw] rounded-full bg-primary mt-[1.5vh] shrink-0" />
            <p className="font-body text-[3vw] text-text leading-relaxed">Caller memory loads automatically on voice match — no login required</p>
          </div>
        </div>
      </div>

      {/* Right visual — phone numbers linking to voice identity */}
      <div className="absolute right-[7vw] top-1/2 -translate-y-1/2 w-[30vw] flex flex-col items-center gap-[2.5vh]">

        <div className="w-full bg-surface rounded-[1vw] px-[3vw] py-[2vh] text-center" style={{ border: '1px solid #22223A' }}>
          <p className="font-body text-[2.5vw] text-muted">+91-98765-XXXXX</p>
          <p className="font-body text-[2.2vw] text-muted opacity-50 mt-[0.5vh]">First call</p>
        </div>

        <div className="flex gap-[6vw]">
          <div className="w-[0.2vw] h-[4vh] bg-primary opacity-30" />
          <div className="w-[0.2vw] h-[4vh] bg-primary opacity-30" />
        </div>

        <div className="w-full bg-surface rounded-[1vw] px-[3vw] py-[2vh] text-center" style={{ border: '1px solid #22223A' }}>
          <p className="font-body text-[2.5vw] text-muted">+91-77890-YYYYY</p>
          <p className="font-body text-[2.2vw] text-muted opacity-50 mt-[0.5vh]">Different number, same caller</p>
        </div>

        <div className="w-[0.2vw] h-[4vh] bg-primary opacity-60" />

        <div className="w-full rounded-[1vw] px-[3vw] py-[2.5vh] text-center" style={{ background: '#F0A500', border: '1px solid #F0A500' }}>
          <p className="font-display font-bold text-[3vw] text-bg">Voice Identified</p>
          <p className="font-body text-[2.5vw] text-bg opacity-70 mt-[0.5vh]">Memory loaded — 94% confidence</p>
        </div>

      </div>
    </div>
  );
}
