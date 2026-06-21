export default function Slide6() {
  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", backgroundColor: "#FFFFFF", fontFamily: "'Inter', sans-serif", color: "#1C1C1C", position: "relative", display: "flex", flexDirection: "column", padding: "8vh 8vw", boxSizing: "border-box" }}>
      <div style={{ width: "84vw", height: "0.2vh", backgroundColor: "#1C1C1C", position: "absolute", top: "8vh", left: "8vw" }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: "2vh" }}>
        <div style={{ fontSize: "1vw", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>snapserve.ai</div>
        <div style={{ fontSize: "1vw", fontWeight: 400, color: "#666666" }}>How — Reducing Human Effort</div>
      </div>
      <div style={{ position: "absolute", top: "32vh", left: "8vw", fontSize: "26vw", fontWeight: 700, color: "#F5F5F5", lineHeight: 0.8, zIndex: 0, userSelect: "none", letterSpacing: "-0.05em" }}>06</div>
      <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", justifyContent: "flex-start", zIndex: 1, position: "relative", marginTop: "7vh" }}>
        <h2 style={{ fontSize: "3.5vw", fontWeight: 700, margin: "0 0 5.5vh 0", lineHeight: 1.1, letterSpacing: "-0.02em" }}>80% of calls handled. No human required.</h2>
        <div style={{ display: "flex", gap: "5vw", marginBottom: "4.5vh" }}>
          <div style={{ flex: 1, borderLeft: "0.3vh solid #1C1C1C", paddingLeft: "1.5vw" }}>
            <div style={{ fontSize: "0.85vw", color: "#888888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "1vh", fontFamily: "'DM Mono', monospace" }}>Automation Rate</div>
            <div style={{ fontSize: "5vw", fontWeight: 700, lineHeight: 1, letterSpacing: "-0.03em" }}>80%</div>
            <div style={{ fontSize: "1.1vw", color: "#4A4A4A", marginTop: "1vh", lineHeight: 1.4 }}>Routine calls resolved end-to-end without any human intervention.</div>
          </div>
          <div style={{ flex: 1, borderLeft: "0.3vh solid #1C1C1C", paddingLeft: "1.5vw" }}>
            <div style={{ fontSize: "0.85vw", color: "#888888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "1vh", fontFamily: "'DM Mono', monospace" }}>Throughput Multiplier</div>
            <div style={{ fontSize: "5vw", fontWeight: 700, lineHeight: 1, letterSpacing: "-0.03em" }}>40×</div>
            <div style={{ fontSize: "1.1vw", color: "#4A4A4A", marginTop: "1vh", lineHeight: 1.4 }}>One SnapServe agent runs 40 simultaneous conversations — 24 hours a day.</div>
          </div>
          <div style={{ flex: 1, borderLeft: "0.3vh solid #1C1C1C", paddingLeft: "1.5vw" }}>
            <div style={{ fontSize: "0.85vw", color: "#888888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "1vh", fontFamily: "'DM Mono', monospace" }}>Cost vs. Human Agent</div>
            <div style={{ fontSize: "5vw", fontWeight: 700, lineHeight: 1, letterSpacing: "-0.03em" }}>75%</div>
            <div style={{ fontSize: "1.1vw", color: "#4A4A4A", marginTop: "1vh", lineHeight: 1.4 }}>Lower fully-loaded cost per call vs. a human agent team at equivalent coverage.</div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "2vh", maxWidth: "72vw" }}>
          <div style={{ display: "flex", gap: "3vw" }}>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: "1vw", color: "#888888", minWidth: "16vw" }}>Human agent team</div>
            <div style={{ fontSize: "1.1vw", color: "#4A4A4A" }}>Hire 6–8 weeks · Train 4 weeks · ₹25K/mo each · Max 1 call at a time · 5 days/week, 8 hrs/day</div>
          </div>
          <div style={{ width: "100%", height: "0.1vh", backgroundColor: "#E0E0E0" }} />
          <div style={{ display: "flex", gap: "3vw" }}>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: "1vw", color: "#1C1C1C", minWidth: "16vw", fontWeight: 500 }}>SnapServe agent</div>
            <div style={{ fontSize: "1.1vw", color: "#1C1C1C" }}>Deploy in 48 hrs · No training · ₹3/min · Unlimited concurrent · 24/7/365 · Every language</div>
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
          <div style={{ color: "#1C1C1C", fontWeight: 600 }}>06</div>
        </div>
      </div>
    </div>
  );
}
