export default function Slide10() {
  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", backgroundColor: "#FFFFFF", fontFamily: "'Inter', sans-serif", color: "#1C1C1C", position: "relative", display: "flex", flexDirection: "column", padding: "7vh 8vw 5vh 8vw", boxSizing: "border-box" }}>
      <div style={{ width: "84vw", height: "0.2vh", backgroundColor: "#1C1C1C", position: "absolute", top: "7vh", left: "8vw" }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: "2vh", zIndex: 1 }}>
        <div style={{ fontSize: "0.95vw", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "'DM Mono', monospace" }}>snapserve.ai</div>
        <div style={{ fontSize: "0.9vw", fontWeight: 400, color: "#888888", fontFamily: "'DM Mono', monospace" }}>10 — Business Model</div>
      </div>
      <div style={{ position: "absolute", top: "28vh", right: "4vw", fontSize: "22vw", fontWeight: 700, color: "#F5F5F5", lineHeight: 1, zIndex: 0, userSelect: "none", letterSpacing: "-0.06em" }}>11</div>
      <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", justifyContent: "flex-start", zIndex: 1, position: "relative", marginTop: "5vh" }}>
        <h2 style={{ fontSize: "3.4vw", fontWeight: 700, margin: "0 0 1.5vh 0", lineHeight: 1.1, letterSpacing: "-0.025em" }}>Usage-based. No seats. No lock-in. 70% gross margin.</h2>
        <p style={{ fontSize: "1.2vw", color: "#4A4A4A", maxWidth: "62vw", lineHeight: 1.6, marginBottom: "3.5vh" }}>Revenue scales directly with customer call volumes — which grow naturally as businesses automate more workflows. NRR expands without any sales effort.</p>
        <div style={{ display: "flex", gap: "3vw", marginBottom: "3.5vh" }}>
          <div style={{ flex: 1, border: "0.1vh solid #E0E0E0", padding: "2.5vh 2vw" }}>
            <div style={{ fontSize: "0.75vw", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", letterSpacing: "0.1em", color: "#888888", marginBottom: "2vh" }}>Managed Plan</div>
            <div style={{ fontSize: "3.8vw", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1, marginBottom: "1.5vh" }}>$0.05<span style={{ fontSize: "1.3vw", fontWeight: 400, color: "#888888" }}>/min</span></div>
            <div style={{ fontSize: "1vw", color: "#4A4A4A", lineHeight: 1.6 }}>We supply all AI provider keys. Customer pays one rate. Best for businesses that want zero operational complexity — just a phone number and a system prompt.</div>
            <div style={{ fontSize: "0.85vw", color: "#888888", fontFamily: "'DM Mono', monospace", marginTop: "2vh", paddingTop: "1.5vh", borderTop: "0.08vh solid #E0E0E0" }}>Target: SMBs, startups, first deployments</div>
          </div>
          <div style={{ flex: 1, border: "0.15vh solid #1C1C1C", padding: "2.5vh 2vw", backgroundColor: "#FAFAFA" }}>
            <div style={{ fontSize: "0.75vw", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", letterSpacing: "0.1em", color: "#1C1C1C", fontWeight: 600, marginBottom: "2vh" }}>BYOP Plan</div>
            <div style={{ fontSize: "3.8vw", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1, marginBottom: "1.5vh" }}>$0.035<span style={{ fontSize: "1.3vw", fontWeight: 400, color: "#888888" }}>/min</span></div>
            <div style={{ fontSize: "1vw", color: "#4A4A4A", lineHeight: 1.6 }}>Customer brings their own provider keys. We earn a pure orchestration margin. 30% cheaper than Vapi managed. Best for enterprises with existing provider contracts.</div>
            <div style={{ fontSize: "0.85vw", color: "#888888", fontFamily: "'DM Mono', monospace", marginTop: "2vh", paddingTop: "1.5vh", borderTop: "0.08vh solid #E0E0E0" }}>Target: Enterprises, high volume, BFSI</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: "5vw", backgroundColor: "#FAFAFA", padding: "2.2vh 2.5vw", border: "0.1vh solid #E0E0E0" }}>
          <div>
            <div style={{ fontSize: "0.75vw", color: "#999999", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", marginBottom: "0.5vh" }}>Path to $70K MRR</div>
            <div style={{ fontSize: "1.15vw", fontWeight: 600 }}>2,000 agents × 1,000 min/mo</div>
          </div>
          <div style={{ width: "0.08vw", backgroundColor: "#E0E0E0" }} />
          <div>
            <div style={{ fontSize: "0.75vw", color: "#999999", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", marginBottom: "0.5vh" }}>Gross Margin at Scale</div>
            <div style={{ fontSize: "1.15vw", fontWeight: 600 }}>~70% (BYOP near 100%)</div>
          </div>
          <div style={{ width: "0.08vw", backgroundColor: "#E0E0E0" }} />
          <div>
            <div style={{ fontSize: "0.75vw", color: "#999999", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", marginBottom: "0.5vh" }}>Expected NRR</div>
            <div style={{ fontSize: "1.15vw", fontWeight: 600 }}>120%+ (usage expands naturally)</div>
          </div>
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
            <div style={{ color: "#999999", marginBottom: "0.4vh", textTransform: "uppercase", fontSize: "0.65vw" }}>Stage</div>
            <div>Pre-Seed</div>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: "#999999", marginBottom: "0.4vh", textTransform: "uppercase", fontSize: "0.65vw" }}>Page</div>
          <div style={{ fontWeight: 600, color: "#1C1C1C" }}>11 / 14</div>
        </div>
      </div>
    </div>
  );
}
