export default function Slide4() {
  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", backgroundColor: "#FFFFFF", fontFamily: "'Inter', sans-serif", color: "#1C1C1C", position: "relative", display: "flex", flexDirection: "column", padding: "8vh 8vw", boxSizing: "border-box" }}>
      <div style={{ width: "84vw", height: "0.2vh", backgroundColor: "#1C1C1C", position: "absolute", top: "8vh", left: "8vw" }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: "2vh" }}>
        <div style={{ fontSize: "1vw", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>snapserve.ai</div>
        <div style={{ fontSize: "1vw", fontWeight: 400, color: "#666666" }}>What — The Solution</div>
      </div>
      <div style={{ position: "absolute", top: "32vh", left: "8vw", fontSize: "26vw", fontWeight: 700, color: "#F5F5F5", lineHeight: 0.8, zIndex: 0, userSelect: "none", letterSpacing: "-0.05em" }}>04</div>
      <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", justifyContent: "flex-start", zIndex: 1, position: "relative", marginTop: "7vh" }}>
        <div style={{ fontSize: "0.85vw", fontWeight: 500, letterSpacing: "0.14em", textTransform: "uppercase", color: "#888888", fontFamily: "'DM Mono', monospace", marginBottom: "1.5vh" }}>Powered by Aitel — AI Telecommunication</div>
        <h2 style={{ fontSize: "3.5vw", fontWeight: 700, margin: "0 0 5.5vh 0", lineHeight: 1.1, letterSpacing: "-0.02em" }}>SnapServe deploys autonomous voice agents for every customer call.</h2>
        <div style={{ display: "flex", gap: "3vw" }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "2.5vh" }}>
              <div style={{ display: "flex", gap: "2vw", alignItems: "flex-start" }}>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.85vw", color: "#888888", marginTop: "0.3vh", minWidth: "2vw" }}>01</div>
                <div>
                  <div style={{ fontSize: "1.3vw", fontWeight: 600, marginBottom: "0.5vh" }}>Inbound Call Handling</div>
                  <div style={{ fontSize: "1.1vw", color: "#4A4A4A", lineHeight: 1.5 }}>Answers every call, resolves queries, books appointments, checks balances — without a human agent in the loop.</div>
                </div>
              </div>
              <div style={{ width: "100%", height: "0.1vh", backgroundColor: "#E0E0E0" }} />
              <div style={{ display: "flex", gap: "2vw", alignItems: "flex-start" }}>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.85vw", color: "#888888", marginTop: "0.3vh", minWidth: "2vw" }}>02</div>
                <div>
                  <div style={{ fontSize: "1.3vw", fontWeight: 600, marginBottom: "0.5vh" }}>Outbound Campaigns</div>
                  <div style={{ fontSize: "1.1vw", color: "#4A4A4A", lineHeight: 1.5 }}>Runs payment reminders, surveys, lead qualification, and follow-up campaigns at unlimited scale.</div>
                </div>
              </div>
              <div style={{ width: "100%", height: "0.1vh", backgroundColor: "#E0E0E0" }} />
              <div style={{ display: "flex", gap: "2vw", alignItems: "flex-start" }}>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.85vw", color: "#888888", marginTop: "0.3vh", minWidth: "2vw" }}>03</div>
                <div>
                  <div style={{ fontSize: "1.3vw", fontWeight: 600, marginBottom: "0.5vh" }}>12+ Languages</div>
                  <div style={{ fontSize: "1.1vw", color: "#4A4A4A", lineHeight: 1.5 }}>Hindi, Tamil, Telugu, Kannada, Bengali, Hinglish, and English. Indic-language-first by design.</div>
                </div>
              </div>
              <div style={{ width: "100%", height: "0.1vh", backgroundColor: "#E0E0E0" }} />
              <div style={{ display: "flex", gap: "2vw", alignItems: "flex-start" }}>
                <div style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.85vw", color: "#888888", marginTop: "0.3vh", minWidth: "2vw" }}>04</div>
                <div>
                  <div style={{ fontSize: "1.3vw", fontWeight: 600, marginBottom: "0.5vh" }}>Plug-in to Any Stack</div>
                  <div style={{ fontSize: "1.1vw", color: "#4A4A4A", lineHeight: 1.5 }}>Integrates with existing CRM, telephony (VoBiz, Twilio, Plivo), and business workflows. Live in 48 hours.</div>
                </div>
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
          <div style={{ color: "#1C1C1C", fontWeight: 600 }}>04</div>
        </div>
      </div>
    </div>
  );
}
