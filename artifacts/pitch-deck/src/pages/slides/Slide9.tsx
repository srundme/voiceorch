export default function Slide9() {
  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", backgroundColor: "#FFFFFF", fontFamily: "'Inter', sans-serif", color: "#1C1C1C", position: "relative", display: "flex", flexDirection: "column", padding: "8vh 8vw", boxSizing: "border-box" }}>
      <div style={{ width: "84vw", height: "0.2vh", backgroundColor: "#1C1C1C", position: "absolute", top: "8vh", left: "8vw" }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: "2vh" }}>
        <div style={{ fontSize: "1vw", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>snapserve.ai</div>
        <div style={{ fontSize: "1vw", fontWeight: 400, color: "#666666" }}>Why SnapServe</div>
      </div>
      <div style={{ position: "absolute", top: "32vh", left: "8vw", fontSize: "26vw", fontWeight: 700, color: "#F5F5F5", lineHeight: 0.8, zIndex: 0, userSelect: "none", letterSpacing: "-0.05em" }}>09</div>
      <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", justifyContent: "flex-start", zIndex: 1, position: "relative", marginTop: "7vh" }}>
        <h2 style={{ fontSize: "3.5vw", fontWeight: 700, margin: "0 0 5.5vh 0", lineHeight: 1.1, letterSpacing: "-0.02em" }}>Built for India. Moated by memory.</h2>
        <div style={{ display: "flex", gap: "5vw" }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "2.5vh" }}>
            <div style={{ display: "flex", gap: "2.5vw", alignItems: "flex-start" }}>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.85vw", color: "#888888", minWidth: "2vw", marginTop: "0.3vh" }}>01</div>
              <div>
                <div style={{ fontSize: "1.3vw", fontWeight: 600, marginBottom: "0.4vh" }}>India-first telephony stack</div>
                <div style={{ fontSize: "1.05vw", color: "#4A4A4A", lineHeight: 1.5 }}>Native VoBiz, Plivo, and Twilio support. Built for Indian dial patterns, STD codes, and local SIP trunks. Competitors are US-first and don't understand the Indian telecom layer.</div>
              </div>
            </div>
            <div style={{ width: "100%", height: "0.1vh", backgroundColor: "#E0E0E0" }} />
            <div style={{ display: "flex", gap: "2.5vw", alignItems: "flex-start" }}>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.85vw", color: "#888888", minWidth: "2vw", marginTop: "0.3vh" }}>02</div>
              <div>
                <div style={{ fontSize: "1.3vw", fontWeight: 600, marginBottom: "0.4vh" }}>Caller memory across calls</div>
                <div style={{ fontSize: "1.05vw", color: "#4A4A4A", lineHeight: 1.5 }}>Three-layer graph memory — facts, episodes, semantic graph. The agent remembers every caller across every conversation. No competitor offers this. This is our moat.</div>
              </div>
            </div>
            <div style={{ width: "100%", height: "0.1vh", backgroundColor: "#E0E0E0" }} />
            <div style={{ display: "flex", gap: "2.5vw", alignItems: "flex-start" }}>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.85vw", color: "#888888", minWidth: "2vw", marginTop: "0.3vh" }}>03</div>
              <div>
                <div style={{ fontSize: "1.3vw", fontWeight: 600, marginBottom: "0.4vh" }}>BYOK — 60% lower cost</div>
                <div style={{ fontSize: "1.05vw", color: "#4A4A4A", lineHeight: 1.5 }}>Businesses bring their own provider keys. We charge only orchestration fees. vs. Vapi ($0.05/min) and Amazon Connect ($0.08/min) — SnapServe BYOK: $0.035/min.</div>
              </div>
            </div>
            <div style={{ width: "100%", height: "0.1vh", backgroundColor: "#E0E0E0" }} />
            <div style={{ display: "flex", gap: "2.5vw", alignItems: "flex-start" }}>
              <div style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.85vw", color: "#888888", minWidth: "2vw", marginTop: "0.3vh" }}>04</div>
              <div>
                <div style={{ fontSize: "1.3vw", fontWeight: 600, marginBottom: "0.4vh" }}>Production-ready today</div>
                <div style={{ fontSize: "1.05vw", color: "#4A4A4A", lineHeight: 1.5 }}>Deployed on Railway, handling live calls. Not a prototype. Not a waitlist. Customers can be onboarded this week.</div>
              </div>
            </div>
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
          <div style={{ color: "#1C1C1C", fontWeight: 600 }}>09</div>
        </div>
      </div>
    </div>
  );
}
