export default function Slide8() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-bg flex flex-col" style={{ padding: '0 7vw 6vh 7vw' }}>
      {/* Decorative ring */}
      <div className="absolute top-[-8vh] right-[-4vw] w-[38vw] h-[38vw] rounded-full border border-primary opacity-[0.07]" />

      {/* Amber bar motif + slide counter */}
      <div className="absolute top-[6vh] left-[7vw] h-[0.3vh] w-[8vw] bg-primary" />
      <p className="absolute top-[5.5vh] right-[7vw] font-body text-[2.2vw] text-muted opacity-40">08 / 12</p>

      {/* Headline */}
      <div style={{ paddingTop: '11vh', marginBottom: '2.5vh' }}>
        <p className="font-body font-medium text-[2.2vw] uppercase tracking-[0.35em] text-primary mb-[1.5vh]">Market Opportunity</p>
        <h2 className="font-display font-black text-[4vw] leading-none tracking-tighter text-text">India's Voice AI Gap</h2>
      </div>

      {/* Three stat cards */}
      <div className="flex gap-[2vw] flex-1 overflow-hidden">

        <div className="flex-1 bg-surface rounded-[1vw] overflow-hidden flex flex-col" style={{ borderTop: '0.35vh solid #F0A500', padding: '2vw' }}>
          <p className="font-display font-black text-[6vw] text-primary leading-none tracking-tighter">22</p>
          <p className="font-display font-bold text-[2.6vw] text-text mt-[1.5vh] leading-tight">official languages</p>
          <p className="font-body text-[2.4vw] text-muted mt-[1.5vh] leading-snug">Each with its own gender grammar — English-first AI handles none.</p>
        </div>

        <div className="flex-1 bg-surface rounded-[1vw] overflow-hidden flex flex-col" style={{ borderTop: '0.35vh solid #F0A500', padding: '2vw' }}>
          <p className="font-display font-black text-[6vw] text-primary leading-none tracking-tighter">1.4B</p>
          <p className="font-display font-bold text-[2.6vw] text-text mt-[1.5vh] leading-tight">phone users</p>
          <p className="font-body text-[2.4vw] text-muted mt-[1.5vh] leading-snug">The world's largest voice-first market, still on human call agents.</p>
        </div>

        <div className="flex-1 bg-surface rounded-[1vw] overflow-hidden flex flex-col" style={{ borderTop: '0.35vh solid #F0A500', padding: '2vw' }}>
          <p className="font-display font-black text-[6vw] text-primary leading-none tracking-tighter">0</p>
          <p className="font-display font-bold text-[2.6vw] text-text mt-[1.5vh] leading-tight">India-native voice AI platforms</p>
          <p className="font-body text-[2.4vw] text-muted mt-[1.5vh] leading-snug">No product combining gender detection, caller memory, and fingerprinting.</p>
        </div>

      </div>
    </div>
  );
}
