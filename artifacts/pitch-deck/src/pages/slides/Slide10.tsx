export default function Slide10() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-bg">
      {/* Amber bar motif */}
      <div className="absolute top-[6.5vh] left-[7vw] h-[0.3vh] w-[8vw] bg-primary" />
      <p className="absolute top-[6vh] right-[7vw] font-body text-[2.2vw] text-muted opacity-40">10 / 12</p>

      {/* Headline */}
      <div className="absolute top-[11vh] left-[7vw]">
        <p className="font-body font-medium text-[2.2vw] uppercase tracking-[0.35em] text-primary mb-[1.5vh]">
          Business Model
        </p>
        <h2 className="font-display font-black text-[5.5vw] leading-tight tracking-tight text-text">
          BYOK Orchestration
        </h2>
      </div>

      {/* Left column — how it works */}
      <div className="absolute left-[7vw] top-[33vh]" style={{ width: '43vw' }}>
        <p className="font-body text-[3vw] text-muted leading-relaxed mb-[4vh]">
          Businesses plug in their own API keys for every AI provider. We charge only for orchestration — not per-minute AI costs.
        </p>

        <div className="space-y-[3vh]">
          <div className="flex items-start gap-[1.5vw]">
            <div className="w-[0.5vw] h-[0.5vw] rounded-full bg-primary mt-[1.5vh] shrink-0" />
            <p className="font-body text-[3vw] text-text leading-relaxed">Flat monthly orchestration fee per active agent</p>
          </div>
          <div className="flex items-start gap-[1.5vw]">
            <div className="w-[0.5vw] h-[0.5vw] rounded-full bg-primary mt-[1.5vh] shrink-0" />
            <p className="font-body text-[3vw] text-text leading-relaxed">No markup on AI provider costs — no lock-in</p>
          </div>
          <div className="flex items-start gap-[1.5vw]">
            <div className="w-[0.5vw] h-[0.5vw] rounded-full bg-primary mt-[1.5vh] shrink-0" />
            <p className="font-body text-[3vw] text-text leading-relaxed">Enterprise: custom pricing per million minutes</p>
          </div>
        </div>
      </div>

      {/* Right column — pricing comparison */}
      <div className="absolute right-[7vw] top-[30vh]" style={{ width: '34vw' }}>

        <p className="font-body font-medium text-[2.5vw] uppercase tracking-wider text-muted mb-[2.5vh]">vs. per-minute platforms</p>

        <div className="bg-surface rounded-[1vw] p-[3vw] mb-[2.5vh]" style={{ border: '1px solid #22223A' }}>
          <p className="font-body text-[2.5vw] text-muted mb-[1vh]">Vapi equivalent usage</p>
          <p className="font-display font-black text-[6vw] text-muted leading-none tracking-tighter line-through opacity-60">$$$</p>
          <p className="font-body text-[2.5vw] text-muted mt-[1vh]">AI cost markups on every minute</p>
        </div>

        <div className="rounded-[1vw] p-[3vw]" style={{ background: '#F0A500' }}>
          <p className="font-body text-[2.5vw] text-bg mb-[1vh] opacity-70">SnapServe equivalent usage</p>
          <p className="font-display font-black text-[6vw] text-bg leading-none tracking-tighter">60–80%</p>
          <p className="font-body text-[2.5vw] text-bg mt-[1vh] opacity-70">lower total cost of operation</p>
        </div>

      </div>
    </div>
  );
}
