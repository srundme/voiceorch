export default function Slide12() {
  return (
    <div className="w-screen h-screen overflow-hidden relative" style={{ width: "100vw", height: "100vh", overflow: "hidden", backgroundColor: "#FFFFFF", fontFamily: "'Inter', sans-serif", color: "#1C1C1C", position: "relative", display: "flex", flexDirection: "column", padding: "7vh 8vw 5vh 8vw", boxSizing: "border-box" }}>
      <div style={{ width: "84vw", height: "0.2vh", backgroundColor: "#1C1C1C", position: "absolute", top: "7vh", left: "8vw" }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: "2vh", zIndex: 1 }}>
        <div style={{ fontSize: "0.95vw", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "'DM Mono', monospace" }}>snapserve.ai</div>
        <div style={{ fontSize: "0.9vw", fontWeight: 400, color: "#888888", fontFamily: "'DM Mono', monospace" }}>04 — System Architecture</div>
      </div>
      <div style={{ position: "absolute", top: "28vh", right: "4vw", fontSize: "22vw", fontWeight: 700, color: "#F5F5F5", lineHeight: 1, zIndex: 0, userSelect: "none", letterSpacing: "-0.06em" }}>05</div>
      <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", justifyContent: "flex-start", zIndex: 1, position: "relative", marginTop: "5vh" }}>
        <h2 style={{ fontSize: "3.4vw", fontWeight: 700, margin: "0 0 1.5vh 0", lineHeight: 1.1, letterSpacing: "-0.025em" }}>One engine connects every channel, model, and system.</h2>
        <p style={{ fontSize: "1.2vw", color: "#4A4A4A", maxWidth: "64vw", lineHeight: 1.6, marginBottom: "3.2vh" }}>Every call — inbound, outbound, or web — flows through one orchestration core that streams audio to best-in-class AI models and reads and writes every business system in real time.</p>
        <div style={{ display: "flex", alignItems: "stretch", gap: "0.9vw", marginBottom: "2.8vh" }}>
          <div style={{ flex: 1, border: "0.1vh solid #E0E0E0", padding: "1.6vh 1.1vw", display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: "0.75vw", color: "#999999", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "1vh" }}>01 · Channels</div>
            <div style={{ fontSize: "1.1vw", fontWeight: 600, marginBottom: "0.6vh" }}>Where calls begin</div>
            <div style={{ fontSize: "0.9vw", color: "#4A4A4A", lineHeight: 1.45 }}>Inbound · Outbound · Web &amp; in-app voice</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", fontSize: "1.6vw", color: "#BBBBBB", fontWeight: 300 }}>→</div>
          <div style={{ flex: 1, border: "0.1vh solid #E0E0E0", padding: "1.6vh 1.1vw", display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: "0.75vw", color: "#999999", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "1vh" }}>02 · Telephony</div>
            <div style={{ fontSize: "1.1vw", fontWeight: 600, marginBottom: "0.6vh" }}>Carrier layer</div>
            <div style={{ fontSize: "0.9vw", color: "#4A4A4A", lineHeight: 1.45 }}>VoBiz · Twilio · Plivo · Vonage</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", fontSize: "1.6vw", color: "#BBBBBB", fontWeight: 300 }}>→</div>
          <div style={{ flex: 1.5, backgroundColor: "#1C1C1C", color: "#FFFFFF", padding: "1.6vh 1.3vw", display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: "0.75vw", color: "#9A9A9A", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "1vh" }}>SnapServe</div>
            <div style={{ fontSize: "1.25vw", fontWeight: 700, marginBottom: "0.6vh" }}>Orchestration Engine</div>
            <div style={{ fontSize: "0.9vw", color: "#C8C8C8", lineHeight: 1.45 }}>Real-time pipeline — endpointing, barge-in, turn-taking, language switching, tool calls. Sub-2s, unlimited concurrency.</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", fontSize: "1.6vw", color: "#BBBBBB", fontWeight: 300 }}>→</div>
          <div style={{ flex: 1.15, border: "0.1vh solid #E0E0E0", padding: "1.6vh 1.1vw", display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: "0.75vw", color: "#999999", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "1vh" }}>03 · Intelligence</div>
            <div style={{ fontSize: "1.1vw", fontWeight: 600, marginBottom: "0.6vh" }}>STT · LLM · TTS</div>
            <div style={{ fontSize: "0.9vw", color: "#4A4A4A", lineHeight: 1.45 }}>Today: Sarvam · Gemini · Cartesia · Deepgram</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: "1.6vw", alignItems: "center", border: "0.1vh solid #E0E0E0", padding: "1.7vh 1.5vw", marginBottom: "2.8vh" }}>
          <div style={{ fontSize: "0.75vw", color: "#888888", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", letterSpacing: "0.08em", minWidth: "11vw" }}>Shared control plane</div>
          <div style={{ width: "0.1vw", height: "4.5vh", backgroundColor: "#E0E0E0" }} />
          <div style={{ flex: 1, fontSize: "1vw", color: "#1C1C1C", lineHeight: 1.5 }}>Caller memory · Billing &amp; wallet · Dashboard &amp; admin · Scheduling &amp; booking · Integrations (CRM, calendar, webhooks) — read and written on every single call.</div>
        </div>
        <div style={{ display: "flex", gap: "2.5vw", alignItems: "center", backgroundColor: "#FAFAFA", padding: "2.2vh 2.5vw", border: "0.1vh solid #E0E0E0" }}>
          <div style={{ fontSize: "0.75vw", color: "#999999", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", letterSpacing: "0.08em", minWidth: "11vw" }}>Next — Own the stack</div>
          <div style={{ width: "0.1vw", height: "6vh", backgroundColor: "#E0E0E0" }} />
          <div style={{ flex: 1, fontSize: "1.05vw", color: "#1C1C1C", lineHeight: 1.5 }}>SnapServe is building its own <strong style={{ fontWeight: 700 }}>STT, LLM, and TTS models</strong> — India-optimised and fully owned. Owning the model layer turns per-minute provider fees into proprietary IP: higher margin, a deeper moat, and accuracy tuned for Indic voice.</div>
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
          <div style={{ fontWeight: 600, color: "#1C1C1C" }}>05 / 12</div>
        </div>
      </div>
    </div>
  );
}
