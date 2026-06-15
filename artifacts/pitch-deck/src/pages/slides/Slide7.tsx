export default function Slide7() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-bg flex">
      {/* Amber bar motif + slide counter */}
      <div className="absolute top-[6vh] left-[7vw] h-[0.3vh] w-[8vw] bg-primary" />
      <p className="absolute top-[5.5vh] right-[7vw] font-body text-[2.2vw] text-muted opacity-40">07 / 12</p>

      {/* Left column */}
      <div className="flex flex-col pl-[7vw] pr-[3vw] w-[54%] overflow-hidden" style={{ paddingTop: '11vh', paddingBottom: '8vh', gap: '2.5vh' }}>
        <p className="font-body font-medium text-[2.2vw] uppercase tracking-[0.35em] text-primary">Intelligence Layer 03</p>
        <h2 className="font-display font-black text-[4vw] leading-none tracking-tighter text-text">Voice Fingerprinting</h2>
        <p className="font-body text-[2.7vw] text-muted leading-snug">Azure Speaker Recognition identifies callers by voice — even from a different number.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.8vh' }}>
          <div className="flex items-center gap-[1.2vw]">
            <div className="w-[0.45vw] h-[0.45vw] rounded-full bg-primary shrink-0" />
            <p className="font-body text-[2.7vw] text-text">Enrollment builds across calls (60 s target)</p>
          </div>
          <div className="flex items-center gap-[1.2vw]">
            <div className="w-[0.45vw] h-[0.45vw] rounded-full bg-primary shrink-0" />
            <p className="font-body text-[2.7vw] text-text">Memory loads automatically on voice match</p>
          </div>
          <div className="flex items-center gap-[1.2vw]">
            <div className="w-[0.45vw] h-[0.45vw] rounded-full bg-primary shrink-0" />
            <p className="font-body text-[2.7vw] text-text">Fraud detection and BFSI KYC acceleration</p>
          </div>
        </div>
      </div>

      {/* Right column — identity visual */}
      <div className="flex flex-col items-stretch pr-[7vw] pl-[3vw] w-[46%] overflow-hidden" style={{ paddingTop: '14vh', paddingBottom: '10vh', gap: '0' }}>

        <div className="bg-surface rounded-[1vw] px-[3vw] py-[2.5vh] text-center" style={{ border: '1px solid #22223A' }}>
          <p className="font-body text-[2.5vw] text-muted">+91-98765-XXXXX</p>
          <p className="font-body text-[2.2vw] text-muted opacity-40 mt-[0.5vh]">First call</p>
        </div>

        <div className="flex justify-center gap-[8vw] py-[1.5vh]">
          <div className="w-[0.2vw] bg-primary opacity-30" style={{ height: '5vh' }} />
          <div className="w-[0.2vw] bg-primary opacity-30" style={{ height: '5vh' }} />
        </div>

        <div className="bg-surface rounded-[1vw] px-[3vw] py-[2.5vh] text-center" style={{ border: '1px solid #22223A' }}>
          <p className="font-body text-[2.5vw] text-muted">+91-77890-YYYYY</p>
          <p className="font-body text-[2.2vw] text-muted opacity-40 mt-[0.5vh]">Different number, same caller</p>
        </div>

        <div className="flex justify-center py-[1.5vh]">
          <div className="w-[0.2vw] bg-primary opacity-60" style={{ height: '5vh' }} />
        </div>

        <div className="rounded-[1vw] px-[3vw] py-[2.5vh] text-center" style={{ background: '#F0A500' }}>
          <p className="font-display font-bold text-[3vw] text-bg">Voice Identified</p>
          <p className="font-body text-[2.5vw] text-bg opacity-70 mt-[0.8vh]">Memory loaded — 94% confidence</p>
        </div>

      </div>
    </div>
  );
}
