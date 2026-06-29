export default function Slide3() {
  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", backgroundColor: "#FFFFFF", fontFamily: "'Inter', sans-serif", color: "#1C1C1C", position: "relative", display: "flex", flexDirection: "column", padding: "7vh 8vw 5vh 8vw", boxSizing: "border-box" }}>
      <div style={{ width: "84vw", height: "0.2vh", backgroundColor: "#1C1C1C", position: "absolute", top: "7vh", left: "8vw" }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: "2vh", zIndex: 1 }}>
        <div style={{ fontSize: "0.95vw", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "'DM Mono', monospace" }}>snapserve.ai</div>
        <div style={{ fontSize: "0.9vw", fontWeight: 400, color: "#888888", fontFamily: "'DM Mono', monospace" }}>02 — What is SnapServe</div>
      </div>
      <div style={{ position: "absolute", top: "28vh", right: "4vw", fontSize: "22vw", fontWeight: 700, color: "#F5F5F5", lineHeight: 1, zIndex: 0, userSelect: "none", letterSpacing: "-0.06em" }}>03</div>
      <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", justifyContent: "flex-start", zIndex: 1, position: "relative", marginTop: "5vh" }}>
        <div style={{ fontSize: "0.85vw", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", letterSpacing: "0.12em", color: "#888888", marginBottom: "1.5vh" }}>Infrastructure · Not a product</div>
        <h2 style={{ fontSize: "3.4vw", fontWeight: 700, margin: "0 0 1.5vh 0", lineHeight: 1.1, letterSpacing: "-0.025em", maxWidth: "70vw" }}>The orchestration engine for voice AI — like Stripe is to payments.</h2>
        <p style={{ fontSize: "1.2vw", color: "#4A4A4A", maxWidth: "60vw", lineHeight: 1.6, marginBottom: "4vh" }}>Any business connects their telephony numbers, configures an AI agent with their choice of ASR, LLM, and TTS providers, and SnapServe handles everything in between: real-time audio streaming, turn management, barge-in detection, memory, and handoff logic.</p>
        <div style={{ display: "flex", gap: "3vw", marginBottom: "3vh" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "0.75vw", color: "#999999", textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "'DM Mono', monospace", marginBottom: "1.5vh", paddingBottom: "1vh", borderBottom: "0.1vh solid #E0E0E0" }}>Without SnapServe</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "1.2vh", fontSize: "1.05vw", color: "#666666", lineHeight: 1.5 }}>
              <div>↳ Build WebSocket audio pipelines from scratch</div>
              <div>↳ Manage LLM prompt engineering + memory</div>
              <div>↳ Handle STT/TTS streaming latency</div>
              <div>↳ Wire every telephony provider separately</div>
              <div style={{ fontWeight: 600, color: "#888888" }}>6–9 months engineering. $200K+ cost.</div>
            </div>
          </div>
          <div style={{ width: "0.1vw", backgroundColor: "#E0E0E0" }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "0.75vw", color: "#1C1C1C", textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "'DM Mono', monospace", marginBottom: "1.5vh", paddingBottom: "1vh", borderBottom: "0.15vh solid #1C1C1C" }}>With SnapServe</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "1.2vh", fontSize: "1.05vw", color: "#1C1C1C", lineHeight: 1.5 }}>
              <div>↳ Connect telephony number → dashboard or API</div>
              <div>↳ Choose providers or use managed keys</div>
              <div>↳ Write a system prompt. Set tools. Go live.</div>
              <div>↳ SnapServe orchestrates the full real-time loop</div>
              <div style={{ fontWeight: 600, color: "#1C1C1C" }}>48 hours to production. Pay per minute.</div>
            </div>
          </div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", borderTop: "0.1vh solid #E0E0E0", paddingTop: "2.5vh", marginTop: "auto", fontFamily: "'DM Mono', monospace", fontSize: "0.85vw", color: "#4A4A4A", zIndex: 1 }}>
        <div style={{ display: "flex", gap: "5vw" }}>
          <div>
            <div style={{ color: "#999999", marginBottom: "0.4vh", textTransform: "uppercase", fontSize: "0.65vw" }}>Date</div>
            <div>June 2026</div>
          </div>
          <div>
            <div style={{ color: "#999999", marginBottom: "0.4vh", textTransform: "uppercase", fontSize: "0.65vw" }}>Prepared By</div>
            <div>SnapServe</div>
          </div>
          <div>
            <div style={{ color: "#999999", marginBottom: "0.4vh", textTransform: "uppercase", fontSize: "0.65vw" }}>Stage</div>
            <div>Pre-Seed</div>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: "#999999", marginBottom: "0.4vh", textTransform: "uppercase", fontSize: "0.65vw" }}>Page</div>
          <div style={{ fontWeight: 600, color: "#1C1C1C" }}>03 / 14</div>
        </div>
      </div>
    </div>
  );
}
