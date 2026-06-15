export default function Slide10() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-bg flex">
      {/* Amber bar motif + slide counter */}
      <div className="absolute top-[6vh] left-[7vw] h-[0.3vh] w-[8vw] bg-primary" />
      <p className="absolute top-[5.5vh] right-[7vw] font-body text-[2.2vw] text-muted opacity-40">10 / 12</p>

      {/* Left column */}
      <div className="flex flex-col pl-[7vw] pr-[3vw] w-[54%] overflow-hidden" style={{ paddingTop: '11vh', paddingBottom: '8vh', gap: '2.5vh' }}>
        <p className="font-body font-medium text-[2.2vw] uppercase tracking-[0.35em] text-primary">Business Model</p>
        <h2 className="font-display font-black text-[4vw] leading-none tracking-tighter text-text">BYOK Orchestration</h2>
        <p className="font-body text-[2.7vw] text-muted leading-snug">Businesses use their own API keys. We charge for orchestration — not per-minute AI cost.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.8vh' }}>
          <div className="flex items-center gap-[1.2vw]">
            <div className="w-[0.45vw] h-[0.45vw] rounded-full bg-primary shrink-0" />
            <p className="font-body text-[2.7vw] text-text">Flat monthly fee per active agent</p>
          </div>
          <div className="flex items-center gap-[1.2vw]">
            <div className="w-[0.45vw] h-[0.45vw] rounded-full bg-primary shrink-0" />
            <p className="font-body text-[2.7vw] text-text">Zero markup on AI provider costs</p>
          </div>
          <div className="flex items-center gap-[1.2vw]">
            <div className="w-[0.45vw] h-[0.45vw] rounded-full bg-primary shrink-0" />
            <p className="font-body text-[2.7vw] text-text">Enterprise: custom per-million-minute pricing</p>
          </div>
        </div>
      </div>

      {/* Divider */}
      <div className="absolute left-[54%] top-[11vh] bottom-[8vh] w-[0.15vw] bg-border-line" />

      {/* Right column */}
      <div className="flex flex-col pl-[5vw] pr-[7vw] w-[46%] overflow-hidden" style={{ paddingTop: '12vh', paddingBottom: '8vh', gap: '2.5vh' }}>
        <p className="font-body font-medium text-[2.2vw] uppercase tracking-wider text-muted">vs. per-minute platforms</p>

        <div className="bg-surface rounded-[1vw] px-[2.5vw] py-[2vh]" style={{ border: '1px solid #22223A' }}>
          <p className="font-body text-[2.3vw] text-muted mb-[1vh]">Vapi equivalent usage</p>
          <p className="font-display font-black leading-none" style={{ fontSize: '4.5vw', color: '#6B6B80', textDecoration: 'line-through' }}>$$$</p>
          <p className="font-body text-[2.3vw] text-muted mt-[1vh]">AI cost markups on every minute</p>
        </div>

        <div className="rounded-[1vw] px-[2.5vw] py-[2vh]" style={{ background: '#F0A500' }}>
          <p className="font-body text-[2.3vw] text-bg opacity-70 mb-[1vh]">SnapServe equivalent usage</p>
          <p className="font-display font-black leading-none text-bg" style={{ fontSize: '5.5vw' }}>
            <span style={{ whiteSpace: 'nowrap' }}>60–80%</span>
          </p>
          <p className="font-body text-[2.3vw] text-bg mt-[1vh] opacity-70">lower total cost of operation</p>
        </div>
      </div>
    </div>
  );
}
