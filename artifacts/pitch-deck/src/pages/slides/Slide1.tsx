export default function Slide1() {
  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", backgroundColor: "#FFFFFF", fontFamily: "'Inter', sans-serif", color: "#1C1C1C", position: "relative", display: "flex", flexDirection: "column", padding: "8vh 8vw", boxSizing: "border-box" }}>
      <div style={{ width: "84vw", height: "0.2vh", backgroundColor: "#1C1C1C", position: "absolute", top: "8vh", left: "8vw" }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: "2vh" }}>
        <div style={{ fontSize: "1vw", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>snapserve.ai</div>
        <div style={{ fontSize: "1vw", fontWeight: 400, color: "#666666" }}>Investor Memo — June 2026</div>
      </div>
      <div style={{ position: "absolute", top: "32vh", left: "8vw", fontSize: "26vw", fontWeight: 700, color: "#F5F5F5", lineHeight: 0.8, zIndex: 0, userSelect: "none", letterSpacing: "-0.05em" }}>01</div>
      <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", justifyContent: "center", zIndex: 1, position: "relative", marginTop: "8vh" }}>
        <div style={{ fontSize: "0.9vw", fontWeight: 500, letterSpacing: "0.14em", textTransform: "uppercase", color: "#888888", fontFamily: "'DM Mono', monospace", marginBottom: "2vh" }}>Aitel — AI Telecommunication</div>
        <h1 style={{ fontSize: "7.5vw", fontWeight: 700, margin: 0, lineHeight: 1.0, letterSpacing: "-0.03em" }}>SnapServe</h1>
        <p style={{ fontSize: "1.9vw", fontWeight: 400, color: "#4A4A4A", marginTop: "3vh", maxWidth: "54vw", lineHeight: 1.5 }}>Your business phone that never sleeps, never misses, and never forgets a caller.</p>
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
        <div>
          <div style={{ color: "#888888", marginBottom: "0.5vh", textTransform: "uppercase", fontSize: "0.7vw" }}>Status</div>
          <div style={{ fontWeight: 600, color: "#1C1C1C" }}>Confidential</div>
        </div>
      </div>
    </div>
  );
}
