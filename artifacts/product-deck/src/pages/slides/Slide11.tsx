export default function Slide11() {
  return (
    <div className="w-screen h-screen overflow-hidden relative" style={{ width: "100vw", height: "100vh", overflow: "hidden", backgroundColor: "#FFFFFF", fontFamily: "'Inter', sans-serif", color: "#1C1C1C", position: "relative", display: "flex", flexDirection: "column", padding: "7vh 8vw 5vh 8vw", boxSizing: "border-box" }}>
      <div style={{ width: "84vw", height: "0.2vh", backgroundColor: "#1C1C1C", position: "absolute", top: "7vh", left: "8vw" }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: "2vh", zIndex: 1 }}>
        <div style={{ fontSize: "0.95vw", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "'DM Mono', monospace" }}>snapserve.ai</div>
        <div style={{ fontSize: "0.9vw", fontWeight: 400, color: "#888888", fontFamily: "'DM Mono', monospace" }}>11 — Roadmap</div>
      </div>
      <div style={{ position: "absolute", top: "28vh", right: "4vw", fontSize: "22vw", fontWeight: 700, color: "#F5F5F5", lineHeight: 1, zIndex: 0, userSelect: "none", letterSpacing: "-0.06em" }}>12</div>
      <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", justifyContent: "flex-start", zIndex: 1, position: "relative", marginTop: "5vh" }}>
        <h2 style={{ fontSize: "3.4vw", fontWeight: 700, margin: "0 0 1.5vh 0", lineHeight: 1.1, letterSpacing: "-0.025em" }}>From orchestration engine to India's default voice layer.</h2>
        <p style={{ fontSize: "1.2vw", color: "#4A4A4A", maxWidth: "62vw", lineHeight: 1.6, marginBottom: "4vh" }}>SnapServe is live and serving calls today. The next 18 months turn a working platform into a self-serve, enterprise-grade standard across every high-volume vertical.</p>
        <div style={{ display: "flex", gap: "3vw", marginBottom: "3.5vh" }}>
          <div style={{ flex: 1 }}>
            <div style={{ borderTop: "0.3vh solid #1C1C1C", paddingTop: "1.5vh" }}>
              <div style={{ fontSize: "0.75vw", color: "#999999", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.6vh" }}>Shipped — Live today</div>
              <div style={{ fontSize: "1.2vw", fontWeight: 600, marginBottom: "1.5vh" }}>The platform exists</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "1vh", fontSize: "1vw", color: "#1C1C1C", lineHeight: 1.45 }}>
                <div>✓ Orchestration engine — sub-2s, unlimited concurrency</div>
                <div>✓ 12+ ASR / LLM / TTS providers</div>
                <div>✓ Cross-call caller memory</div>
                <div>✓ Scheduling + booking engine</div>
                <div>✓ Web call, dashboard, admin + managed keys</div>
                <div>✓ VoBiz telephony + 12 Indic languages</div>
              </div>
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ borderTop: "0.3vh solid #999999", paddingTop: "1.5vh" }}>
              <div style={{ fontSize: "0.75vw", color: "#999999", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.6vh" }}>Next — H2 2026</div>
              <div style={{ fontSize: "1.2vw", fontWeight: 600, marginBottom: "1.5vh" }}>Self-serve &amp; scale</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "1vh", fontSize: "1vw", color: "#4A4A4A", lineHeight: 1.45 }}>
                <div>↳ Outbound campaign automation at scale</div>
                <div>↳ Self-serve onboarding + wallet billing</div>
                <div>↳ Call analytics &amp; automated QA scoring</div>
                <div>↳ CRM integrations — Zoho, HubSpot, Salesforce</div>
                <div>↳ Agent template library per vertical</div>
                <div>↳ DPDP-grade data controls &amp; audit logs</div>
              </div>
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ borderTop: "0.3vh solid #D0D0D0", paddingTop: "1.5vh" }}>
              <div style={{ fontSize: "0.75vw", color: "#999999", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "0.6vh" }}>Later — 2027</div>
              <div style={{ fontSize: "1.2vw", fontWeight: 600, marginBottom: "1.5vh" }}>Enterprise &amp; moat</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "1vh", fontSize: "1vw", color: "#4A4A4A", lineHeight: 1.45 }}>
                <div>↳ Custom brand voices (voice cloning)</div>
                <div>↳ Real-time assist for human handoff</div>
                <div>↳ Domain-tuned models per vertical</div>
                <div>↳ SOC 2 + enterprise SSO, multi-region</div>
                <div>↳ Partner / reseller marketplace</div>
              </div>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: "2vw", alignItems: "center", backgroundColor: "#FAFAFA", padding: "2.2vh 2.5vw", border: "0.1vh solid #E0E0E0" }}>
          <div style={{ fontSize: "0.75vw", color: "#999999", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", letterSpacing: "0.08em", minWidth: "8vw" }}>North Star</div>
          <div style={{ width: "0.1vw", height: "4vh", backgroundColor: "#E0E0E0" }} />
          <div style={{ fontSize: "1.2vw", color: "#4A4A4A", lineHeight: 1.5 }}>Become the layer every Indian business deploys voice AI on — the way Stripe became the default for payments.</div>
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
          <div style={{ fontWeight: 600, color: "#1C1C1C" }}>12 / 12</div>
        </div>
      </div>
    </div>
  );
}
