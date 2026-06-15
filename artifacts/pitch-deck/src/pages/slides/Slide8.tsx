export default function Slide8() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-bg">
      {/* Decorative large circle — top right */}
      <div className="absolute top-[-8vh] right-[-4vw] w-[38vw] h-[38vw] rounded-full border border-primary opacity-[0.07]" />

      {/* Amber bar motif */}
      <div className="absolute top-[6.5vh] left-[7vw] h-[0.3vh] w-[8vw] bg-primary" />
      <p className="absolute top-[6vh] right-[7vw] font-body text-[2.2vw] text-muted opacity-40">08 / 12</p>

      {/* Section label + headline */}
      <div className="absolute top-[11vh] left-[7vw]">
        <p className="font-body font-medium text-[2.2vw] uppercase tracking-[0.35em] text-primary mb-[1.5vh]">
          Market Opportunity
        </p>
        <h2 className="font-display font-black text-[5.5vw] leading-tight tracking-tight text-text">
          India's Voice AI Gap
        </h2>
      </div>

      {/* Three stats in a row */}
      <div className="absolute bottom-[8vh] left-[7vw] right-[7vw] flex gap-[3vw]">

        <div className="flex-1 bg-surface rounded-[1vw] p-[3vw]" style={{ borderTop: '0.3vh solid #F0A500' }}>
          <p className="font-display font-black text-[7vw] text-primary leading-none tracking-tighter">22</p>
          <p className="font-display font-bold text-[3vw] text-text mt-[1.5vh] leading-tight">official languages</p>
          <p className="font-body text-[2.8vw] text-muted mt-[1.5vh] leading-relaxed">
            Each with its own gender grammar. English-first AI handles none of them correctly.
          </p>
        </div>

        <div className="flex-1 bg-surface rounded-[1vw] p-[3vw]" style={{ borderTop: '0.3vh solid #F0A500' }}>
          <p className="font-display font-black text-[7vw] text-primary leading-none tracking-tighter">1.4B</p>
          <p className="font-display font-bold text-[3vw] text-text mt-[1.5vh] leading-tight">phone users</p>
          <p className="font-body text-[2.8vw] text-muted mt-[1.5vh] leading-relaxed">
            The world's largest voice-first market, still running on human call centre agents.
          </p>
        </div>

        <div className="flex-1 bg-surface rounded-[1vw] p-[3vw]" style={{ borderTop: '0.3vh solid #F0A500' }}>
          <p className="font-display font-black text-[7vw] text-primary leading-none tracking-tighter">0</p>
          <p className="font-display font-bold text-[3vw] text-text mt-[1.5vh] leading-tight">India-native voice AI platforms</p>
          <p className="font-body text-[2.8vw] text-muted mt-[1.5vh] leading-relaxed">
            No product in market with gender detection, persistent caller memory, and voice fingerprinting.
          </p>
        </div>

      </div>
    </div>
  );
}
