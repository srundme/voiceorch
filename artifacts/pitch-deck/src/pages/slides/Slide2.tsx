export default function Slide2() {
  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", backgroundColor: "#FFFFFF", fontFamily: "'Inter', sans-serif", color: "#1C1C1C", position: "relative", display: "flex", flexDirection: "column", padding: "8vh 8vw", boxSizing: "border-box" }}>
      <div style={{ width: "84vw", height: "0.2vh", backgroundColor: "#1C1C1C", position: "absolute", top: "8vh", left: "8vw" }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: "2vh" }}>
        <div style={{ fontSize: "1vw", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>snapserve.ai</div>
        <div style={{ fontSize: "1vw", fontWeight: 400, color: "#666666" }}>Why — The Problem</div>
      </div>
      <div style={{ position: "absolute", top: "32vh", left: "8vw", fontSize: "26vw", fontWeight: 700, color: "#F5F5F5", lineHeight: 0.8, zIndex: 0, userSelect: "none", letterSpacing: "-0.05em" }}>02</div>
      <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", justifyContent: "flex-start", zIndex: 1, position: "relative", marginTop: "7vh" }}>
        <h2 style={{ fontSize: "3.5vw", fontWeight: 700, margin: "0 0 5vh 0", lineHeight: 1.1, letterSpacing: "-0.02em" }}>Voice operations are broken.</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "2.8vh", maxWidth: "78vw" }}>
          <div style={{ display: "flex", gap: "3vw", alignItems: "flex-start" }}>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: "1.1vw", fontWeight: 500, color: "#1C1C1C", minWidth: "18vw" }}>600M+ callers</div>
            <div style={{ fontSize: "1.2vw", lineHeight: 1.5, color: "#4A4A4A" }}>India has over 600 million active voice callers. Customer service calls number in the billions per day — banking, insurance, healthcare, logistics.</div>
          </div>
          <div style={{ width: "100%", height: "0.1vh", backgroundColor: "#E0E0E0" }} />
          <div style={{ display: "flex", gap: "3vw", alignItems: "flex-start" }}>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: "1.1vw", fontWeight: 500, color: "#1C1C1C", minWidth: "18vw" }}>8-min hold time</div>
            <div style={{ fontSize: "1.2vw", lineHeight: 1.5, color: "#4A4A4A" }}>78% of customers abandon a call after 2 minutes on hold. Average Indian call center hold time: 8 minutes. That is revenue walking out the door.</div>
          </div>
          <div style={{ width: "100%", height: "0.1vh", backgroundColor: "#E0E0E0" }} />
          <div style={{ display: "flex", gap: "3vw", alignItems: "flex-start" }}>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: "1.1vw", fontWeight: 500, color: "#1C1C1C", minWidth: "18vw" }}>45% annual attrition</div>
            <div style={{ fontSize: "1.2vw", lineHeight: 1.5, color: "#4A4A4A" }}>Call center agents churn at 45%/year. Businesses spend ₹30,000–₹50,000 to hire and train each replacement. The human model does not scale.</div>
          </div>
          <div style={{ width: "100%", height: "0.1vh", backgroundColor: "#E0E0E0" }} />
          <div style={{ display: "flex", gap: "3vw", alignItems: "flex-start" }}>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: "1.1vw", fontWeight: 500, color: "#1C1C1C", minWidth: "18vw" }}>40% is repetitive</div>
            <div style={{ fontSize: "1.2vw", lineHeight: 1.5, color: "#4A4A4A" }}>4 in 10 calls are balance checks, order status, appointment booking — tasks a trained AI handles in under 90 seconds with zero wait time.</div>
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
          <div style={{ color: "#1C1C1C", fontWeight: 600 }}>02</div>
        </div>
      </div>
    </div>
  );
}
