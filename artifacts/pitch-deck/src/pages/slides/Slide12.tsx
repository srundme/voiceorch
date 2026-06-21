export default function Slide12() {
  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", backgroundColor: "#FFFFFF", fontFamily: "'Inter', sans-serif", color: "#1C1C1C", position: "relative", display: "flex", flexDirection: "column", padding: "8vh 8vw", boxSizing: "border-box" }}>
      <div style={{ width: "84vw", height: "0.2vh", backgroundColor: "#1C1C1C", position: "absolute", top: "8vh", left: "8vw" }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: "2vh" }}>
        <div style={{ fontSize: "1vw", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>snapserve.ai</div>
        <div style={{ fontSize: "1vw", fontWeight: 400, color: "#666666" }}>The Ask</div>
      </div>
      <div style={{ position: "absolute", top: "32vh", left: "8vw", fontSize: "26vw", fontWeight: 700, color: "#F5F5F5", lineHeight: 0.8, zIndex: 0, userSelect: "none", letterSpacing: "-0.05em" }}>12</div>
      <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", justifyContent: "center", zIndex: 1, position: "relative", marginTop: "4vh" }}>
        <h2 style={{ fontSize: "4vw", fontWeight: 700, margin: "0 0 2vh 0", lineHeight: 1.0, letterSpacing: "-0.03em" }}>Raising ₹1.3 Cr seed.</h2>
        <p style={{ fontSize: "1.5vw", color: "#4A4A4A", maxWidth: "55vw", lineHeight: 1.5, marginBottom: "5vh" }}>18 months runway. 50 paying customers. ₹50L ARR by Q2 2027.</p>
        <div style={{ display: "flex", gap: "4vw", marginBottom: "4vh" }}>
          <div style={{ flex: 1, borderLeft: "0.3vh solid #1C1C1C", paddingLeft: "1.5vw" }}>
            <div style={{ fontSize: "0.8vw", color: "#888888", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "1vh" }}>Use of Funds</div>
            <div style={{ fontSize: "1.2vw", lineHeight: 2, color: "#1C1C1C" }}>
              <div style={{ display: "flex", justifyContent: "space-between", maxWidth: "20vw" }}>
                <span>Engineering &amp; product</span>
                <span style={{ fontWeight: 600, fontFamily: "'DM Mono', monospace" }}>40%</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", maxWidth: "20vw" }}>
                <span>GTM &amp; sales</span>
                <span style={{ fontWeight: 600, fontFamily: "'DM Mono', monospace" }}>35%</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", maxWidth: "20vw" }}>
                <span>Infrastructure</span>
                <span style={{ fontWeight: 600, fontFamily: "'DM Mono', monospace" }}>25%</span>
              </div>
            </div>
          </div>
          <div style={{ flex: 1, borderLeft: "0.3vh solid #1C1C1C", paddingLeft: "1.5vw" }}>
            <div style={{ fontSize: "0.8vw", color: "#888888", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "1vh" }}>18-Month Milestones</div>
            <div style={{ fontSize: "1.2vw", lineHeight: 2, color: "#1C1C1C" }}>
              <div>50 paying customers</div>
              <div>₹50L ARR (Q2 2027)</div>
              <div>Series A ready</div>
            </div>
          </div>
          <div style={{ flex: 1, borderLeft: "0.3vh solid #1C1C1C", paddingLeft: "1.5vw" }}>
            <div style={{ fontSize: "0.8vw", color: "#888888", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "1vh" }}>Contact</div>
            <div style={{ fontSize: "1.2vw", lineHeight: 2, color: "#1C1C1C" }}>
              <div style={{ fontWeight: 600 }}>Karthikeyan</div>
              <div style={{ color: "#4A4A4A" }}>app.snapserve.ai</div>
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
          <div style={{ color: "#1C1C1C", fontWeight: 600 }}>12</div>
        </div>
      </div>
    </div>
  );
}
