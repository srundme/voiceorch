export default function Slide9() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-bg">
      {/* Amber bar motif */}
      <div className="absolute top-[6.5vh] left-[7vw] h-[0.3vh] w-[8vw] bg-primary" />
      <p className="absolute top-[6vh] right-[7vw] font-body text-[2.2vw] text-muted opacity-40">09 / 12</p>

      {/* Headline */}
      <div className="absolute top-[11vh] left-[7vw]">
        <p className="font-body font-medium text-[2.2vw] uppercase tracking-[0.35em] text-primary mb-[1.5vh]">
          Competitive Landscape
        </p>
        <h2 className="font-display font-black text-[5.5vw] leading-tight tracking-tight text-text">
          What sets us apart
        </h2>
      </div>

      {/* Comparison table */}
      <div className="absolute top-[30vh] left-[7vw] right-[7vw]">

        {/* Header row */}
        <div className="grid grid-cols-[2fr_1fr_1fr_1fr] mb-[2vh]">
          <p className="font-body font-medium text-[2.5vw] text-muted uppercase tracking-wider">Capability</p>
          <p className="font-display font-bold text-[3vw] text-primary">SnapServe</p>
          <p className="font-display font-bold text-[3vw] text-muted">Bolna</p>
          <p className="font-display font-bold text-[3vw] text-muted">Vapi</p>
        </div>

        <div className="h-[0.15vh] w-full bg-border-line mb-[2vh]" />

        {/* Row 1 */}
        <div className="grid grid-cols-[2fr_1fr_1fr_1fr] py-[1.8vh]" style={{ borderBottom: '1px solid #22223A' }}>
          <p className="font-body text-[3vw] text-text">Voice Gender Detection</p>
          <p className="font-display font-bold text-[3vw] text-primary">Yes</p>
          <p className="font-body text-[3vw] text-muted">No</p>
          <p className="font-body text-[3vw] text-muted">No</p>
        </div>

        {/* Row 2 */}
        <div className="grid grid-cols-[2fr_1fr_1fr_1fr] py-[1.8vh]" style={{ borderBottom: '1px solid #22223A' }}>
          <p className="font-body text-[3vw] text-text">Persistent Caller Memory</p>
          <p className="font-display font-bold text-[3vw] text-primary">Yes</p>
          <p className="font-body text-[3vw] text-muted">No</p>
          <p className="font-body text-[3vw] text-muted">No</p>
        </div>

        {/* Row 3 */}
        <div className="grid grid-cols-[2fr_1fr_1fr_1fr] py-[1.8vh]" style={{ borderBottom: '1px solid #22223A' }}>
          <p className="font-body text-[3vw] text-text">Voice Fingerprinting</p>
          <p className="font-display font-bold text-[3vw] text-primary">Yes</p>
          <p className="font-body text-[3vw] text-muted">No</p>
          <p className="font-body text-[3vw] text-muted">No</p>
        </div>

        {/* Row 4 */}
        <div className="grid grid-cols-[2fr_1fr_1fr_1fr] py-[1.8vh]" style={{ borderBottom: '1px solid #22223A' }}>
          <p className="font-body text-[3vw] text-text">Bring Your Own Keys (BYOK)</p>
          <p className="font-display font-bold text-[3vw] text-primary">Yes</p>
          <p className="font-body text-[3vw] text-muted">Yes</p>
          <p className="font-body text-[3vw] text-muted">No</p>
        </div>

        {/* Row 5 */}
        <div className="grid grid-cols-[2fr_1fr_1fr_1fr] py-[1.8vh]">
          <p className="font-body text-[3vw] text-text">India Language Optimisation</p>
          <p className="font-display font-bold text-[3vw] text-primary">Yes</p>
          <p className="font-body text-[3vw] text-muted">Partial</p>
          <p className="font-body text-[3vw] text-muted">No</p>
        </div>

      </div>
    </div>
  );
}
