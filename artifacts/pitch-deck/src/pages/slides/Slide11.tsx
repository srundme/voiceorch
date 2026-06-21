export default function Slide11() {
  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", backgroundColor: "#FFFFFF", fontFamily: "'Inter', sans-serif", color: "#1C1C1C", position: "relative", display: "flex", flexDirection: "column", padding: "7vh 8vw 5vh 8vw", boxSizing: "border-box" }}>
      <div style={{ width: "84vw", height: "0.2vh", backgroundColor: "#1C1C1C", position: "absolute", top: "7vh", left: "8vw" }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: "2vh", zIndex: 1 }}>
        <div style={{ fontSize: "0.95vw", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "'DM Mono', monospace" }}>snapserve.ai</div>
        <div style={{ fontSize: "0.9vw", fontWeight: 400, color: "#888888", fontFamily: "'DM Mono', monospace" }}>10 — Traction</div>
      </div>
      <div style={{ position: "absolute", top: "28vh", right: "4vw", fontSize: "22vw", fontWeight: 700, color: "#F5F5F5", lineHeight: 1, zIndex: 0, userSelect: "none", letterSpacing: "-0.06em" }}>11</div>
      <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", justifyContent: "flex-start", zIndex: 1, position: "relative", marginTop: "5vh" }}>
        <h2 style={{ fontSize: "3.4vw", fontWeight: 700, margin: "0 0 1.5vh 0", lineHeight: 1.1, letterSpacing: "-0.025em" }}>Full platform built and live. First paying pilots in discussion.</h2>
        <p style={{ fontSize: "1.2vw", color: "#4A4A4A", maxWidth: "62vw", lineHeight: 1.6, marginBottom: "3.5vh" }}>SnapServe is not a prototype. The full orchestration stack — API, dashboard, admin, telephony integrations, memory, scheduling — is deployed in production on Railway and serving real calls.</p>
        <div style={{ display: "flex", gap: "4vw", marginBottom: "3.5vh" }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "2.2vh" }}>
            <div>
              <div style={{ fontSize: "0.75vw", color: "#999999", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "1.2vh", paddingBottom: "1vh", borderBottom: "0.1vh solid #E0E0E0" }}>Infrastructure</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.8vh", fontSize: "1.05vw", color: "#4A4A4A" }}>
                <div>✓ Production API on Railway (Express + Drizzle + Postgres)</div>
                <div>✓ React dashboard — agents, calls log, providers, scheduling</div>
                <div>✓ Admin panel — platform keys, managed keys, user management</div>
                <div>✓ Webcall support (browser-based voice, no phone number required)</div>
              </div>
            </div>
            <div>
              <div style={{ fontSize: "0.75vw", color: "#999999", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "1.2vh", paddingBottom: "1vh", borderBottom: "0.1vh solid #E0E0E0" }}>Provider Matrix</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.8vh", fontSize: "1.05vw", color: "#4A4A4A" }}>
                <div>ASR: Sarvam, Azure, Deepgram, Whisper</div>
                <div>LLM: Google, Groq, OpenAI, Anthropic, Mistral, Cohere</div>
                <div>TTS: Cartesia, ElevenLabs, Azure, AWS Polly, Deepgram</div>
                <div>Telephony: VoBiz, Twilio, Plivo, Vonage</div>
              </div>
            </div>
          </div>
          <div style={{ flex: 0.55, borderLeft: "0.15vh solid #E0E0E0", paddingLeft: "3vw", display: "flex", flexDirection: "column", gap: "2.5vh" }}>
            <div>
              <div style={{ fontSize: "0.75vw", color: "#999999", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", marginBottom: "0.8vh" }}>Stage</div>
              <div style={{ fontSize: "1.4vw", fontWeight: 600 }}>Live · Pre-Revenue</div>
            </div>
            <div style={{ width: "100%", height: "0.08vh", backgroundColor: "#E0E0E0" }} />
            <div>
              <div style={{ fontSize: "0.75vw", color: "#999999", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", marginBottom: "0.8vh" }}>Monthly Burn</div>
              <div style={{ fontSize: "1.4vw", fontWeight: 600 }}>₹5L / month</div>
            </div>
            <div style={{ width: "100%", height: "0.08vh", backgroundColor: "#E0E0E0" }} />
            <div>
              <div style={{ fontSize: "0.75vw", color: "#999999", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", marginBottom: "0.8vh" }}>Founder</div>
              <div style={{ fontSize: "1.4vw", fontWeight: 600 }}>Karthikeyan</div>
              <div style={{ fontSize: "1vw", color: "#4A4A4A" }}>CEO · Full-stack</div>
            </div>
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
          <div style={{ fontWeight: 600, color: "#1C1C1C" }}>11 / 12</div>
        </div>
      </div>
    </div>
  );
}
