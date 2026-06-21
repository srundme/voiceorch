export default function Slide10() {
  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", backgroundColor: "#FFFFFF", fontFamily: "'Inter', sans-serif", color: "#1C1C1C", position: "relative", display: "flex", flexDirection: "column", padding: "8vh 8vw", boxSizing: "border-box" }}>
      <div style={{ width: "84vw", height: "0.2vh", backgroundColor: "#1C1C1C", position: "absolute", top: "8vh", left: "8vw" }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: "2vh" }}>
        <div style={{ fontSize: "1vw", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>snapserve.ai</div>
        <div style={{ fontSize: "1vw", fontWeight: 400, color: "#666666" }}>Business Model</div>
      </div>
      <div style={{ position: "absolute", top: "32vh", left: "8vw", fontSize: "26vw", fontWeight: 700, color: "#F5F5F5", lineHeight: 0.8, zIndex: 0, userSelect: "none", letterSpacing: "-0.05em" }}>10</div>
      <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", justifyContent: "flex-start", zIndex: 1, position: "relative", marginTop: "7vh" }}>
        <h2 style={{ fontSize: "3.5vw", fontWeight: 700, margin: "0 0 5.5vh 0", lineHeight: 1.1, letterSpacing: "-0.02em" }}>Usage-based. No seat fees. No contracts.</h2>
        <div style={{ display: "flex", gap: "4vw", marginBottom: "4vh" }}>
          <div style={{ flex: 1, border: "0.15vh solid #1C1C1C", padding: "3vh 2.5vw" }}>
            <div style={{ fontSize: "0.8vw", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", letterSpacing: "0.1em", color: "#888888", marginBottom: "2vh" }}>Managed Plan</div>
            <div style={{ fontSize: "3.5vw", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1, marginBottom: "1vh" }}>$0.05<span style={{ fontSize: "1.5vw", fontWeight: 400, color: "#666666" }}>/min</span></div>
            <div style={{ fontSize: "1vw", color: "#4A4A4A", lineHeight: 1.5, marginBottom: "2vh" }}>We supply all AI keys — ASR, LLM, TTS. Customer pays per minute. Simple, predictable billing.</div>
            <div style={{ fontSize: "0.9vw", color: "#666666", fontFamily: "'DM Mono', monospace" }}>Best for: early-stage, SMBs, test deployments</div>
          </div>
          <div style={{ flex: 1, border: "0.15vh solid #1C1C1C", padding: "3vh 2.5vw", backgroundColor: "#FAFAFA" }}>
            <div style={{ fontSize: "0.8vw", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", letterSpacing: "0.1em", color: "#888888", marginBottom: "2vh" }}>BYOK Plan</div>
            <div style={{ fontSize: "3.5vw", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1, marginBottom: "1vh" }}>$0.035<span style={{ fontSize: "1.5vw", fontWeight: 400, color: "#666666" }}>/min</span></div>
            <div style={{ fontSize: "1vw", color: "#4A4A4A", lineHeight: 1.5, marginBottom: "2vh" }}>Customer brings their own provider keys. We charge orchestration only. 60% cheaper than competition.</div>
            <div style={{ fontSize: "0.9vw", color: "#666666", fontFamily: "'DM Mono', monospace" }}>Best for: enterprises, high-volume, cost-sensitive</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: "6vw", backgroundColor: "#FAFAFA", padding: "2.5vh 2.5vw", border: "0.1vh solid #E0E0E0" }}>
          <div>
            <div style={{ fontSize: "0.8vw", color: "#888888", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", marginBottom: "0.5vh" }}>Path to $70K MRR</div>
            <div style={{ fontSize: "1.2vw", fontWeight: 600 }}>2,000 agents × 1,000 min/month</div>
          </div>
          <div style={{ width: "0.1vw", backgroundColor: "#E0E0E0" }} />
          <div>
            <div style={{ fontSize: "0.8vw", color: "#888888", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", marginBottom: "0.5vh" }}>Unit Economics</div>
            <div style={{ fontSize: "1.2vw", fontWeight: 600 }}>~70% gross margin at scale</div>
          </div>
          <div style={{ width: "0.1vw", backgroundColor: "#E0E0E0" }} />
          <div>
            <div style={{ fontSize: "0.8vw", color: "#888888", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", marginBottom: "0.5vh" }}>NRR Expectation</div>
            <div style={{ fontSize: "1.2vw", fontWeight: 600 }}>120%+ (usage grows with call volume)</div>
          </div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "row", gap: "8vw", borderTop: "0.1vh solid #E0E0E0", paddingTop: "3vh", marginTop: "auto", fontFamily: "'DM Mono', monospace", fontSize: "0.9vw", color: "#4A4A4A", zIndex: 1 }}>
        <div>
          <div style={{ color: "#888888", marginBottom: "0.5vh", textTransform: "uppercase", fontSize: "0.7vw" }}>Date</div>
          <div>June 2026</div>
        </div>
        <div>
          <div style={{ color: "#888888", marginBottom: "0.5vh", textTransform: "uppercase", fontSize: "0.7vw" }}>Prepared By</div>
          <div>SnapServe Team</div>
        </div>
        <div style={{ marginLeft: "auto", textAlign: "right" }}>
          <div style={{ color: "#888888", marginBottom: "0.5vh", textTransform: "uppercase", fontSize: "0.7vw" }}>Page</div>
          <div style={{ color: "#1C1C1C", fontWeight: 600 }}>10</div>
        </div>
      </div>
    </div>
  );
}
