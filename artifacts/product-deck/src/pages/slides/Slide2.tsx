export default function Slide2() {
  return (
    <div className="w-screen h-screen overflow-hidden relative" style={{ width: "100vw", height: "100vh", overflow: "hidden", backgroundColor: "#FFFFFF", fontFamily: "'Inter', sans-serif", color: "#1C1C1C", position: "relative", display: "flex", flexDirection: "column", padding: "7vh 8vw 5vh 8vw", boxSizing: "border-box" }}>
      <div style={{ width: "84vw", height: "0.2vh", backgroundColor: "#1C1C1C", position: "absolute", top: "7vh", left: "8vw" }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: "2vh", zIndex: 1 }}>
        <div style={{ fontSize: "0.95vw", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "'DM Mono', monospace" }}>snapserve.ai</div>
        <div style={{ fontSize: "0.9vw", fontWeight: 400, color: "#888888", fontFamily: "'DM Mono', monospace" }}>01 — The Market Shift</div>
      </div>
      <div style={{ position: "absolute", top: "28vh", right: "4vw", fontSize: "22vw", fontWeight: 700, color: "#F5F5F5", lineHeight: 1, zIndex: 0, userSelect: "none", letterSpacing: "-0.06em" }}>02</div>
      <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", justifyContent: "flex-start", zIndex: 1, position: "relative", marginTop: "5vh" }}>
        <h2 style={{ fontSize: "3.4vw", fontWeight: 700, margin: "0 0 1.5vh 0", lineHeight: 1.1, letterSpacing: "-0.025em", maxWidth: "65vw" }}>Every business phone call is being rebuilt on AI.</h2>
        <p style={{ fontSize: "1.3vw", color: "#4A4A4A", maxWidth: "58vw", lineHeight: 1.6, marginBottom: "4.5vh" }}>India's $11B call center industry — 4.5 million agents, billions of calls per year — is at the same inflection point banking was in 2012 when Stripe launched. The infrastructure layer is being built now.</p>
        <div style={{ display: "flex", gap: "4vw", marginBottom: "4vh" }}>
          <div style={{ flex: 1, borderLeft: "0.3vh solid #1C1C1C", paddingLeft: "1.5vw" }}>
            <div style={{ fontSize: "3.8vw", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1 }}>$11B</div>
            <div style={{ fontSize: "0.85vw", color: "#888888", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", marginTop: "0.8vh" }}>India call center industry</div>
            <div style={{ fontSize: "1vw", color: "#4A4A4A", marginTop: "0.8vh", lineHeight: 1.5 }}>4.5 million agents. 70% of budget is headcount. 45% annual attrition.</div>
          </div>
          <div style={{ flex: 1, borderLeft: "0.3vh solid #1C1C1C", paddingLeft: "1.5vw" }}>
            <div style={{ fontSize: "3.8vw", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1 }}>40%</div>
            <div style={{ fontSize: "0.85vw", color: "#888888", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", marginTop: "0.8vh" }}>Calls are purely repetitive</div>
            <div style={{ fontSize: "1vw", color: "#4A4A4A", marginTop: "0.8vh", lineHeight: 1.5 }}>Balance inquiries, order status, appointment booking — solved by AI in under 90 seconds.</div>
          </div>
          <div style={{ flex: 1, borderLeft: "0.3vh solid #1C1C1C", paddingLeft: "1.5vw" }}>
            <div style={{ fontSize: "3.8vw", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1 }}>8 min</div>
            <div style={{ fontSize: "0.85vw", color: "#888888", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", marginTop: "0.8vh" }}>Average hold time</div>
            <div style={{ fontSize: "1vw", color: "#4A4A4A", marginTop: "0.8vh", lineHeight: 1.5 }}>78% of callers abandon after 2 minutes. That abandonment is direct revenue loss.</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: "2vw", alignItems: "center", backgroundColor: "#FAFAFA", padding: "2.5vh 2.5vw", border: "0.1vh solid #E0E0E0" }}>
          <div style={{ fontSize: "1.2vw", fontWeight: 600, color: "#1C1C1C" }}>The opportunity isn't automating a call center.</div>
          <div style={{ width: "0.1vw", height: "4vh", backgroundColor: "#E0E0E0" }} />
          <div style={{ fontSize: "1.2vw", color: "#4A4A4A" }}>It's providing the orchestration layer every business uses to deploy AI that handles calls natively.</div>
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
            <div style={{ color: "#999999", marginBottom: "0.4vh", textTransform: "uppercase", fontSize: "0.65vw" }}>Status</div>
            <div>Live</div>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: "#999999", marginBottom: "0.4vh", textTransform: "uppercase", fontSize: "0.65vw" }}>Page</div>
          <div style={{ fontWeight: 600, color: "#1C1C1C" }}>02 / 12</div>
        </div>
      </div>
    </div>
  );
}
