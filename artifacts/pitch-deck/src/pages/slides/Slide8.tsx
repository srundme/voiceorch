export default function Slide8() {
  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", backgroundColor: "#FFFFFF", fontFamily: "'Inter', sans-serif", color: "#1C1C1C", position: "relative", display: "flex", flexDirection: "column", padding: "7vh 8vw 5vh 8vw", boxSizing: "border-box" }}>
      <div style={{ width: "84vw", height: "0.2vh", backgroundColor: "#1C1C1C", position: "absolute", top: "7vh", left: "8vw" }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: "2vh", zIndex: 1 }}>
        <div style={{ fontSize: "0.95vw", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "'DM Mono', monospace" }}>snapserve.ai</div>
        <div style={{ fontSize: "0.9vw", fontWeight: 400, color: "#888888", fontFamily: "'DM Mono', monospace" }}>08 — Competitive Landscape</div>
      </div>
      <div style={{ position: "absolute", top: "28vh", right: "4vw", fontSize: "22vw", fontWeight: 700, color: "#F5F5F5", lineHeight: 1, zIndex: 0, userSelect: "none", letterSpacing: "-0.06em" }}>09</div>
      <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", justifyContent: "flex-start", zIndex: 1, position: "relative", marginTop: "5vh" }}>
        <h2 style={{ fontSize: "3.4vw", fontWeight: 700, margin: "0 0 1.5vh 0", lineHeight: 1.1, letterSpacing: "-0.025em" }}>Vapi built for US developers. Bolna built for India developers. SnapServe built for India businesses.</h2>
        <p style={{ fontSize: "1.1vw", color: "#4A4A4A", maxWidth: "62vw", lineHeight: 1.6, marginBottom: "3.5vh" }}>Vapi and Bolna are both developer-tools companies — API-first, requiring engineering effort to deploy. SnapServe is the first platform that serves both developers (API) and non-technical businesses (dashboard, managed keys, 48-hour deploy).</p>
        <div style={{ flex: 1, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "1.05vw" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "1.2vh 1.5vw", fontSize: "0.75vw", color: "#999999", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", letterSpacing: "0.08em", borderBottom: "0.15vh solid #1C1C1C", fontWeight: 400 }}>Capability</th>
                <th style={{ textAlign: "center", padding: "1.2vh 1.5vw", fontSize: "0.75vw", color: "#999999", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", letterSpacing: "0.08em", borderBottom: "0.15vh solid #1C1C1C", fontWeight: 400 }}>Vapi AI</th>
                <th style={{ textAlign: "center", padding: "1.2vh 1.5vw", fontSize: "0.75vw", color: "#999999", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", letterSpacing: "0.08em", borderBottom: "0.15vh solid #1C1C1C", fontWeight: 400 }}>Bolna AI</th>
                <th style={{ textAlign: "center", padding: "1.2vh 1.5vw", fontSize: "0.75vw", color: "#1C1C1C", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", letterSpacing: "0.08em", borderBottom: "0.15vh solid #1C1C1C", fontWeight: 700 }}>SnapServe</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["India telephony (VoBiz, Plivo)", "✗", "Partial", "✓"],
                ["Indic language support (12 langs)", "✗", "Partial", "✓"],
                ["Cross-call caller memory", "✗", "✗", "✓"],
                ["Managed plan (no keys needed)", "✗", "✗", "✓"],
                ["BYOP pricing", "✓", "✓", "✓"],
                ["No-code dashboard (non-dev users)", "Partial", "✗", "✓"],
                ["Price / minute (managed)", "$0.05", "$0.04", "$0.05"],
                ["Price / minute (BYOP)", "$0.05", "$0.03", "$0.035"],
              ].map(([cap, vapi, bolna, snap], i) => (
                <tr key={i} style={{ backgroundColor: i % 2 === 0 ? "#FFFFFF" : "#FAFAFA" }}>
                  <td style={{ padding: "1.2vh 1.5vw", color: "#4A4A4A", borderBottom: "0.05vh solid #F0F0F0" }}>{cap}</td>
                  <td style={{ padding: "1.2vh 1.5vw", textAlign: "center", color: vapi === "✗" ? "#BBBBBB" : "#4A4A4A", borderBottom: "0.05vh solid #F0F0F0" }}>{vapi}</td>
                  <td style={{ padding: "1.2vh 1.5vw", textAlign: "center", color: bolna === "✗" ? "#BBBBBB" : "#4A4A4A", borderBottom: "0.05vh solid #F0F0F0" }}>{bolna}</td>
                  <td style={{ padding: "1.2vh 1.5vw", textAlign: "center", fontWeight: 600, color: "#1C1C1C", borderBottom: "0.05vh solid #F0F0F0" }}>{snap}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
          <div style={{ fontWeight: 600, color: "#1C1C1C" }}>09 / 14</div>
        </div>
      </div>
    </div>
  );
}
