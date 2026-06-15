export default function Slide11() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-bg">
      {/* Amber bar motif */}
      <div className="absolute top-[6.5vh] left-[7vw] h-[0.3vh] w-[8vw] bg-primary" />
      <p className="absolute top-[6vh] right-[7vw] font-body text-[2.2vw] text-muted opacity-40">11 / 12</p>

      {/* Headline */}
      <div className="absolute top-[11vh] left-[7vw]">
        <p className="font-body font-medium text-[2.2vw] uppercase tracking-[0.35em] text-primary mb-[1.5vh]">
          The Ask
        </p>
        <h2 className="font-display font-black text-[5.5vw] leading-tight tracking-tight text-text">
          What We're Building Toward
        </h2>
      </div>

      {/* Left — live today */}
      <div className="absolute left-[7vw] top-[33vh]" style={{ width: '40vw' }}>
        <p className="font-display font-bold text-[3.5vw] text-text mb-[2.5vh] tracking-tight">Live in production today</p>

        <div className="space-y-[2.5vh]">
          <div className="flex items-start gap-[1.5vw]">
            <div className="w-[0.5vw] h-[0.5vw] rounded-full bg-primary mt-[1.5vh] shrink-0" />
            <p className="font-body text-[3vw] text-text leading-relaxed">Real-time telephony pipeline — ASR · LLM · TTS · Telephony</p>
          </div>
          <div className="flex items-start gap-[1.5vw]">
            <div className="w-[0.5vw] h-[0.5vw] rounded-full bg-primary mt-[1.5vh] shrink-0" />
            <p className="font-body text-[3vw] text-text leading-relaxed">Voice Gender AI, Caller Memory, Voice Fingerprinting</p>
          </div>
          <div className="flex items-start gap-[1.5vw]">
            <div className="w-[0.5vw] h-[0.5vw] rounded-full bg-primary mt-[1.5vh] shrink-0" />
            <p className="font-body text-[3vw] text-text leading-relaxed">Outbound campaign manager · Scheduling engine · Full analytics</p>
          </div>
          <div className="flex items-start gap-[1.5vw]">
            <div className="w-[0.5vw] h-[0.5vw] rounded-full bg-primary mt-[1.5vh] shrink-0" />
            <p className="font-body text-[3vw] text-text leading-relaxed">BFSI, healthcare, and D2C verticals in pipeline</p>
          </div>
        </div>
      </div>

      {/* Right — targets + ask */}
      <div className="absolute right-[7vw] top-[33vh]" style={{ width: '36vw' }}>
        <p className="font-display font-bold text-[3.5vw] text-text mb-[2.5vh] tracking-tight">24-month targets</p>

        <div className="space-y-[2vh] mb-[4vh]">
          <div className="flex justify-between items-baseline" style={{ borderBottom: '1px solid #22223A', paddingBottom: '1.5vh' }}>
            <p className="font-body text-[3vw] text-muted">ARR</p>
            <p className="font-display font-bold text-[3.5vw] text-text">₹2 Cr</p>
          </div>
          <div className="flex justify-between items-baseline" style={{ borderBottom: '1px solid #22223A', paddingBottom: '1.5vh' }}>
            <p className="font-body text-[3vw] text-muted">Enterprise accounts</p>
            <p className="font-display font-bold text-[3.5vw] text-text">50</p>
          </div>
          <div className="flex justify-between items-baseline">
            <p className="font-body text-[3vw] text-muted">Monthly minutes</p>
            <p className="font-display font-bold text-[3.5vw] text-text">5M</p>
          </div>
        </div>

        <div className="rounded-[1vw] p-[2.5vw]" style={{ background: '#F0A500' }}>
          <p className="font-body text-[2.5vw] text-bg opacity-70 mb-[0.5vh]">Seeking investment for 2-year runway</p>
          <p className="font-display font-black text-[4vw] text-bg leading-tight">Infra · GTM · Compliance</p>
        </div>
      </div>
    </div>
  );
}
