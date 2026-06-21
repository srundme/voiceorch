export default function Slide3() {
  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", backgroundColor: "#FFFFFF", fontFamily: "'Inter', sans-serif", color: "#1C1C1C", position: "relative", display: "flex", flexDirection: "column", padding: "8vh 8vw", boxSizing: "border-box" }}>
      <div style={{ width: "84vw", height: "0.2vh", backgroundColor: "#1C1C1C", position: "absolute", top: "8vh", left: "8vw" }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: "2vh" }}>
        <div style={{ fontSize: "1vw", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>snapserve.ai</div>
        <div style={{ fontSize: "1vw", fontWeight: 400, color: "#666666" }}>Why — The Hidden Cost</div>
      </div>
      <div style={{ position: "absolute", top: "32vh", left: "8vw", fontSize: "26vw", fontWeight: 700, color: "#F5F5F5", lineHeight: 0.8, zIndex: 0, userSelect: "none", letterSpacing: "-0.05em" }}>03</div>
      <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", justifyContent: "flex-start", zIndex: 1, position: "relative", marginTop: "7vh" }}>
        <h2 style={{ fontSize: "3.5vw", fontWeight: 700, margin: "0 0 6vh 0", lineHeight: 1.1, letterSpacing: "-0.02em" }}>Human agents are expensive at scale.</h2>
        <div style={{ display: "flex", gap: "5vw", marginBottom: "5vh" }}>
          <div style={{ flex: 1, borderLeft: "0.3vh solid #1C1C1C", paddingLeft: "1.5vw" }}>
            <div style={{ fontSize: "0.85vw", color: "#888888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "1vh", fontFamily: "'DM Mono', monospace" }}>Monthly Cost / Agent</div>
            <div style={{ fontSize: "4.5vw", fontWeight: 700, lineHeight: 1, letterSpacing: "-0.03em" }}>₹25K</div>
            <div style={{ fontSize: "1.1vw", color: "#4A4A4A", marginTop: "1vh" }}>Fully loaded. Before benefits.</div>
          </div>
          <div style={{ flex: 1, borderLeft: "0.3vh solid #1C1C1C", paddingLeft: "1.5vw" }}>
            <div style={{ fontSize: "0.85vw", color: "#888888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "1vh", fontFamily: "'DM Mono', monospace" }}>Coverage</div>
            <div style={{ fontSize: "4.5vw", fontWeight: 700, lineHeight: 1, letterSpacing: "-0.03em" }}>8 hrs</div>
            <div style={{ fontSize: "1.1vw", color: "#4A4A4A", marginTop: "1vh" }}>5 days/week. Nights cost extra.</div>
          </div>
          <div style={{ flex: 1, borderLeft: "0.3vh solid #1C1C1C", paddingLeft: "1.5vw" }}>
            <div style={{ fontSize: "0.85vw", color: "#888888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "1vh", fontFamily: "'DM Mono', monospace" }}>India Market Spend</div>
            <div style={{ fontSize: "4.5vw", fontWeight: 700, lineHeight: 1, letterSpacing: "-0.03em" }}>$11B</div>
            <div style={{ fontSize: "1.1vw", color: "#4A4A4A", marginTop: "1vh" }}>Annual call center industry.</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: "2vw", alignItems: "center", backgroundColor: "#FAFAFA", padding: "3vh 2.5vw", border: "0.1vh solid #E0E0E0" }}>
          <div style={{ fontSize: "3vw", fontWeight: 700, letterSpacing: "-0.02em", color: "#1C1C1C", whiteSpace: "nowrap" }}>SnapServe: ₹3/min</div>
          <div style={{ width: "0.15vw", height: "5vh", backgroundColor: "#E0E0E0" }} />
          <div style={{ fontSize: "1.3vw", color: "#4A4A4A", lineHeight: 1.5 }}>Unlimited concurrent calls. 24/7/365. No hiring. No training. No attrition. Deployed in 48 hours.</div>
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
          <div style={{ color: "#1C1C1C", fontWeight: 600 }}>03</div>
        </div>
      </div>
    </div>
  );
}
