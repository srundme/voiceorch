export default function Slide6() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-bg flex flex-col" style={{ padding: '0 7vw 6vh 7vw' }}>
      {/* Amber bar motif + slide counter */}
      <div className="absolute top-[6vh] left-[7vw] h-[0.3vh] w-[8vw] bg-primary" />
      <p className="absolute top-[5.5vh] right-[7vw] font-body text-[2.2vw] text-muted opacity-40">06 / 12</p>

      {/* Headline block */}
      <div style={{ paddingTop: '11vh', marginBottom: '2.5vh' }}>
        <p className="font-body font-medium text-[2.2vw] uppercase tracking-[0.35em] text-primary mb-[1.5vh]">Intelligence Layer 02</p>
        <h2 className="font-display font-black text-[3.8vw] leading-none tracking-tighter text-text mb-[1.5vh]">Three-Layer Caller Memory</h2>
        <p className="font-body text-[2.5vw] text-muted">A returning caller is never asked the same question twice.</p>
      </div>

      {/* Three cards row */}
      <div className="flex gap-[2vw] flex-1 overflow-hidden">

        <div className="flex-1 bg-surface rounded-[1vw] overflow-hidden" style={{ border: '1px solid #22223A', padding: '2vw 2vw 1.5vw 2vw' }}>
          <p className="font-display font-black text-[3.8vw] text-primary leading-none mb-[1vh]">L0</p>
          <p className="font-display font-bold text-[2.6vw] text-text leading-tight mb-[1vh]">Structured Facts</p>
          <div className="h-[0.2vh] w-[3vw] bg-primary mb-[1vh]" />
          <p className="font-body text-[2.3vw] text-muted leading-snug">Name, city, product, language — stored from every call.</p>
        </div>

        <div className="flex items-center shrink-0 pb-[10vh]">
          <p className="font-display font-bold text-[3vw] text-primary opacity-40">→</p>
        </div>

        <div className="flex-1 bg-surface rounded-[1vw] overflow-hidden" style={{ border: '1px solid #22223A', padding: '2vw 2vw 1.5vw 2vw' }}>
          <p className="font-display font-black text-[3.8vw] text-primary leading-none mb-[1vh]">L1</p>
          <p className="font-display font-bold text-[2.6vw] text-text leading-tight mb-[1vh]">Episodic Memory</p>
          <div className="h-[0.2vh] w-[3vw] bg-primary mb-[1vh]" />
          <p className="font-body text-[2.3vw] text-muted leading-snug">Summaries of past calls — what was discussed and left open.</p>
        </div>

        <div className="flex items-center shrink-0 pb-[10vh]">
          <p className="font-display font-bold text-[3vw] text-primary opacity-40">→</p>
        </div>

        <div className="flex-1 bg-surface rounded-[1vw] overflow-hidden" style={{ border: '1px solid #22223A', padding: '2vw 2vw 1.5vw 2vw' }}>
          <p className="font-display font-black text-[3.8vw] text-primary leading-none mb-[1vh]">L2</p>
          <p className="font-display font-bold text-[2.6vw] text-text leading-tight mb-[1vh]">Semantic Graph</p>
          <div className="h-[0.2vh] w-[3vw] bg-primary mb-[1vh]" />
          <p className="font-body text-[2.3vw] text-muted leading-snug">Verbatim moments linked across calls — agent can quote last month's conversation.</p>
        </div>

      </div>
    </div>
  );
}
