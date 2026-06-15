export default function Slide6() {
  return (
    <div className="w-screen h-screen overflow-hidden relative bg-bg">
      {/* Amber bar motif */}
      <div className="absolute top-[6.5vh] left-[7vw] h-[0.3vh] w-[8vw] bg-primary" />
      <p className="absolute top-[6vh] right-[7vw] font-body text-[2.2vw] text-muted opacity-40">06 / 12</p>

      {/* Section label + headline */}
      <div className="absolute top-[11vh] left-[7vw]">
        <p className="font-body font-medium text-[2.2vw] uppercase tracking-[0.35em] text-primary mb-[1.5vh]">
          Intelligence Layer 02
        </p>
        <h2 className="font-display font-black text-[5.5vw] leading-tight tracking-tight text-text">
          Three-Layer Caller Memory
        </h2>
        <p className="font-body text-[3vw] text-muted mt-[1.5vh]">
          A returning caller is never asked the same question twice.
        </p>
      </div>

      {/* Memory layers — horizontal */}
      <div className="absolute bottom-[8vh] left-[7vw] right-[7vw] flex gap-[2.5vw]">

        {/* L0 */}
        <div className="flex-1 bg-surface rounded-[1vw] p-[3vw]" style={{ border: '1px solid #22223A' }}>
          <p className="font-display font-black text-[4.5vw] text-primary leading-none mb-[1.5vh]">L0</p>
          <p className="font-display font-bold text-[3vw] text-text leading-tight mb-[1.5vh]">Structured Facts</p>
          <p className="font-body text-[2.8vw] text-muted leading-relaxed">
            Name, city, product, language preference — extracted and stored across every call.
          </p>
        </div>

        {/* Arrow */}
        <div className="flex items-center">
          <p className="font-body text-[4vw] text-primary opacity-40">→</p>
        </div>

        {/* L1 */}
        <div className="flex-1 bg-surface rounded-[1vw] p-[3vw]" style={{ border: '1px solid #22223A' }}>
          <p className="font-display font-black text-[4.5vw] text-primary leading-none mb-[1.5vh]">L1</p>
          <p className="font-display font-bold text-[3vw] text-text leading-tight mb-[1.5vh]">Episodic Memory</p>
          <p className="font-body text-[2.8vw] text-muted leading-relaxed">
            Summaries of past interactions — what was discussed, resolved, and left open.
          </p>
        </div>

        {/* Arrow */}
        <div className="flex items-center">
          <p className="font-body text-[4vw] text-primary opacity-40">→</p>
        </div>

        {/* L2 */}
        <div className="flex-1 bg-surface rounded-[1vw] p-[3vw]" style={{ border: '1px solid #22223A' }}>
          <p className="font-display font-black text-[4.5vw] text-primary leading-none mb-[1.5vh]">L2</p>
          <p className="font-display font-bold text-[3vw] text-text leading-tight mb-[1.5vh]">Semantic Graph</p>
          <p className="font-body text-[2.8vw] text-muted leading-relaxed">
            Verbatim key moments, linked across calls. The agent can quote what the caller said last month.
          </p>
        </div>

      </div>
    </div>
  );
}
