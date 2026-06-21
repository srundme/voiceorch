export default function Slide1() {
  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", backgroundColor: "#FFFFFF", fontFamily: "'Inter', sans-serif", color: "#1C1C1C", position: "relative", display: "flex", flexDirection: "column", padding: "7vh 8vw 5vh 8vw", boxSizing: "border-box" }}>
      <div style={{ width: "84vw", height: "0.2vh", backgroundColor: "#1C1C1C", position: "absolute", top: "7vh", left: "8vw" }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: "2vh", zIndex: 1 }}>
        <div style={{ fontSize: "0.95vw", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "'DM Mono', monospace" }}>snapserve.ai</div>
        <div style={{ fontSize: "0.9vw", color: "#888888", fontFamily: "'DM Mono', monospace" }}>Investor Memo — June 2026</div>
      </div>
      <div style={{ position: "absolute", top: "28vh", right: "4vw", fontSize: "22vw", fontWeight: 700, color: "#F5F5F5", lineHeight: 1, zIndex: 0, userSelect: "none", letterSpacing: "-0.06em" }}>01</div>
      <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", justifyContent: "center", zIndex: 1, position: "relative" }}>
        <div style={{ fontSize: "0.85vw", fontWeight: 500, letterSpacing: "0.16em", textTransform: "uppercase", color: "#888888", fontFamily: "'DM Mono', monospace", marginBottom: "2.5vh" }}>Voice AI Orchestration Infrastructure</div>
        <h1 style={{ fontSize: "7.5vw", fontWeight: 700, margin: "0 0 2.5vh 0", lineHeight: 1.0, letterSpacing: "-0.04em" }}>SnapServe</h1>
        <p style={{ fontSize: "1.65vw", fontWeight: 400, color: "#4A4A4A", maxWidth: "58vw", lineHeight: 1.55, margin: 0 }}>The engine businesses use to build, deploy, and run voice AI agents — on any telephony, in any language, at any scale.</p>
        <div style={{ display: "flex", gap: "4vw", marginTop: "5vh" }}>
          <div style={{ borderLeft: "0.25vh solid #E0E0E0", paddingLeft: "1.5vw" }}>
            <div style={{ fontSize: "0.75vw", color: "#999999", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "'DM Mono', monospace", marginBottom: "0.5vh" }}>Raising</div>
            <div style={{ fontSize: "1.4vw", fontWeight: 600 }}>₹1 Crore Pre-Seed</div>
          </div>
          <div style={{ borderLeft: "0.25vh solid #E0E0E0", paddingLeft: "1.5vw" }}>
            <div style={{ fontSize: "0.75vw", color: "#999999", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "'DM Mono', monospace", marginBottom: "0.5vh" }}>Competing With</div>
            <div style={{ fontSize: "1.4vw", fontWeight: 600 }}>Vapi AI · Bolna AI</div>
          </div>
          <div style={{ borderLeft: "0.25vh solid #E0E0E0", paddingLeft: "1.5vw" }}>
            <div style={{ fontSize: "0.75vw", color: "#999999", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "'DM Mono', monospace", marginBottom: "0.5vh" }}>Stage</div>
            <div style={{ fontSize: "1.4vw", fontWeight: 600 }}>Live · Pre-Revenue</div>
          </div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "row", justifyContent: "space-between", borderTop: "0.1vh solid #E0E0E0", paddingTop: "2.5vh", fontFamily: "'DM Mono', monospace", fontSize: "0.85vw", color: "#4A4A4A", zIndex: 1 }}>
        <div style={{ display: "flex", gap: "5vw" }}>
          <div>
            <div style={{ color: "#999999", marginBottom: "0.4vh", textTransform: "uppercase", fontSize: "0.65vw" }}>Date</div>
            <div>June 2026</div>
          </div>
          <div>
            <div style={{ color: "#999999", marginBottom: "0.4vh", textTransform: "uppercase", fontSize: "0.65vw" }}>Status</div>
            <div style={{ fontWeight: 600, color: "#1C1C1C" }}>Confidential</div>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: "#999999", marginBottom: "0.4vh", textTransform: "uppercase", fontSize: "0.65vw" }}>Page</div>
          <div style={{ fontWeight: 600, color: "#1C1C1C" }}>01 / 12</div>
        </div>
      </div>
    </div>
  );
}
