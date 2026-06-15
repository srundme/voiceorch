export default function Slide9() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-bg flex flex-col" style={{ paddingTop: '6vh', paddingBottom: '6vh', paddingLeft: '7vw', paddingRight: '7vw' }}>
      {/* Amber bar motif + slide counter */}
      <div className="absolute top-[6vh] left-[7vw] h-[0.3vh] w-[8vw] bg-primary" />
      <p className="absolute top-[5.5vh] right-[7vw] font-body text-[2.2vw] text-muted opacity-40">09 / 12</p>

      {/* Headline */}
      <div style={{ paddingTop: '4vh', marginBottom: '4vh' }}>
        <p className="font-body font-medium text-[2.2vw] uppercase tracking-[0.35em] text-primary mb-[1.5vh]">Competitive Landscape</p>
        <h2 className="font-display font-black text-[4.5vw] leading-tight tracking-tight text-text">What sets us apart</h2>
      </div>

      {/* Table */}
      <div className="flex-1 flex flex-col justify-center">

        {/* Header */}
        <div className="grid gap-[2vw] mb-[2vh]" style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr' }}>
          <p className="font-body font-medium text-[2.3vw] text-muted uppercase tracking-wider">Capability</p>
          <p className="font-display font-bold text-[3vw] text-primary">SnapServe</p>
          <p className="font-display font-bold text-[3vw] text-muted">Bolna</p>
          <p className="font-display font-bold text-[3vw] text-muted">Vapi</p>
        </div>
        <div className="h-[0.15vh] w-full bg-border-line mb-[1vh]" />

        <div className="grid gap-[2vw] py-[2vh]" style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr', borderBottom: '1px solid #22223A' }}>
          <p className="font-body text-[2.8vw] text-text">Voice Gender Detection</p>
          <p className="font-display font-bold text-[2.8vw] text-primary">Yes</p>
          <p className="font-body text-[2.8vw] text-muted">No</p>
          <p className="font-body text-[2.8vw] text-muted">No</p>
        </div>

        <div className="grid gap-[2vw] py-[2vh]" style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr', borderBottom: '1px solid #22223A' }}>
          <p className="font-body text-[2.8vw] text-text">Persistent Caller Memory</p>
          <p className="font-display font-bold text-[2.8vw] text-primary">Yes</p>
          <p className="font-body text-[2.8vw] text-muted">No</p>
          <p className="font-body text-[2.8vw] text-muted">No</p>
        </div>

        <div className="grid gap-[2vw] py-[2vh]" style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr', borderBottom: '1px solid #22223A' }}>
          <p className="font-body text-[2.8vw] text-text">Voice Fingerprinting</p>
          <p className="font-display font-bold text-[2.8vw] text-primary">Yes</p>
          <p className="font-body text-[2.8vw] text-muted">No</p>
          <p className="font-body text-[2.8vw] text-muted">No</p>
        </div>

        <div className="grid gap-[2vw] py-[2vh]" style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr', borderBottom: '1px solid #22223A' }}>
          <p className="font-body text-[2.8vw] text-text">Bring Your Own Keys (BYOK)</p>
          <p className="font-display font-bold text-[2.8vw] text-primary">Yes</p>
          <p className="font-body text-[2.8vw] text-muted">Yes</p>
          <p className="font-body text-[2.8vw] text-muted">No</p>
        </div>

        <div className="grid gap-[2vw] py-[2vh]" style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr' }}>
          <p className="font-body text-[2.8vw] text-text">India Language Optimisation</p>
          <p className="font-display font-bold text-[2.8vw] text-primary">Yes</p>
          <p className="font-body text-[2.8vw] text-muted">Partial</p>
          <p className="font-body text-[2.8vw] text-muted">No</p>
        </div>

      </div>
    </div>
  );
}
