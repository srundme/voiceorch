export default function Slide4() {
  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", backgroundColor: "#FFFFFF", fontFamily: "'Inter', sans-serif", color: "#1C1C1C", position: "relative", display: "flex", flexDirection: "column", padding: "7vh 8vw 5vh 8vw", boxSizing: "border-box" }}>
      <div style={{ width: "84vw", height: "0.2vh", backgroundColor: "#1C1C1C", position: "absolute", top: "7vh", left: "8vw" }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: "2vh", zIndex: 1 }}>
        <div style={{ fontSize: "0.95vw", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "'DM Mono', monospace" }}>snapserve.ai</div>
        <div style={{ fontSize: "0.9vw", fontWeight: 400, color: "#888888", fontFamily: "'DM Mono', monospace" }}>03 — How the Engine Works</div>
      </div>
      <div style={{ position: "absolute", top: "28vh", right: "4vw", fontSize: "22vw", fontWeight: 700, color: "#F5F5F5", lineHeight: 1, zIndex: 0, userSelect: "none", letterSpacing: "-0.06em" }}>04</div>
      <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", justifyContent: "flex-start", zIndex: 1, position: "relative", marginTop: "5vh" }}>
        <h2 style={{ fontSize: "3.4vw", fontWeight: 700, margin: "0 0 1.5vh 0", lineHeight: 1.1, letterSpacing: "-0.025em" }}>Five layers. Sub-2-second latency. Unlimited concurrency.</h2>
        <p style={{ fontSize: "1.2vw", color: "#4A4A4A", maxWidth: "62vw", lineHeight: 1.6, marginBottom: "4vh" }}>When a call arrives, SnapServe receives the audio stream via WebSocket, passes it through a provider-agnostic pipeline, and returns synthesized speech — all in under two seconds per turn.</p>
        <div style={{ display: "flex", gap: "1.5vw", marginBottom: "3.5vh", alignItems: "stretch" }}>
          <div style={{ flex: 1, borderTop: "0.3vh solid #1C1C1C", paddingTop: "1.5vh" }}>
            <div style={{ fontSize: "0.75vw", color: "#999999", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", marginBottom: "1vh" }}>01 · Telephony</div>
            <div style={{ fontSize: "1.15vw", fontWeight: 600, marginBottom: "0.5vh" }}>Audio In</div>
            <div style={{ fontSize: "0.95vw", color: "#4A4A4A", lineHeight: 1.5 }}>VoBiz, Twilio, Plivo, Vonage. SIP or cloud. SnapServe receives the raw audio stream.</div>
          </div>
          <div style={{ flex: 1, borderTop: "0.3vh solid #1C1C1C", paddingTop: "1.5vh" }}>
            <div style={{ fontSize: "0.75vw", color: "#999999", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", marginBottom: "1vh" }}>02 · ASR</div>
            <div style={{ fontSize: "1.15vw", fontWeight: 600, marginBottom: "0.5vh" }}>Transcription</div>
            <div style={{ fontSize: "0.95vw", color: "#4A4A4A", lineHeight: 1.5 }}>Sarvam, Azure, Deepgram. Streaming, barge-in aware, Indic-language optimised.</div>
          </div>
          <div style={{ flex: 1, borderTop: "0.3vh solid #1C1C1C", paddingTop: "1.5vh" }}>
            <div style={{ fontSize: "0.75vw", color: "#999999", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", marginBottom: "1vh" }}>03 · LLM + Memory</div>
            <div style={{ fontSize: "1.15vw", fontWeight: 600, marginBottom: "0.5vh" }}>Reasoning</div>
            <div style={{ fontSize: "0.95vw", color: "#4A4A4A", lineHeight: 1.5 }}>Gemini, GPT-4o, Groq. Accesses cross-call memory graph. Executes tools (CRM, calendar, etc.)</div>
          </div>
          <div style={{ flex: 1, borderTop: "0.3vh solid #1C1C1C", paddingTop: "1.5vh" }}>
            <div style={{ fontSize: "0.75vw", color: "#999999", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", marginBottom: "1vh" }}>04 · TTS</div>
            <div style={{ fontSize: "1.15vw", fontWeight: 600, marginBottom: "0.5vh" }}>Synthesis</div>
            <div style={{ fontSize: "0.95vw", color: "#4A4A4A", lineHeight: 1.5 }}>Cartesia, ElevenLabs, Azure. Streaming first-chunk in 450ms. Natural prosody.</div>
          </div>
          <div style={{ flex: 1, borderTop: "0.3vh solid #1C1C1C", paddingTop: "1.5vh" }}>
            <div style={{ fontSize: "0.75vw", color: "#999999", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", marginBottom: "1vh" }}>05 · Handoff</div>
            <div style={{ fontSize: "1.15vw", fontWeight: 600, marginBottom: "0.5vh" }}>Resolution</div>
            <div style={{ fontSize: "0.95vw", color: "#4A4A4A", lineHeight: 1.5 }}>Resolve, escalate, or transfer to a human agent. Memory is persisted for the next call.</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: "5vw", backgroundColor: "#FAFAFA", padding: "2.5vh 2.5vw", border: "0.1vh solid #E0E0E0" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "2.6vw", fontWeight: 700, letterSpacing: "-0.02em" }}>&lt;2s</div>
            <div style={{ fontSize: "0.8vw", color: "#888888", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", marginTop: "0.5vh" }}>End-to-end latency</div>
          </div>
          <div style={{ width: "0.1vw", backgroundColor: "#E0E0E0" }} />
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "2.6vw", fontWeight: 700, letterSpacing: "-0.02em" }}>12+</div>
            <div style={{ fontSize: "0.8vw", color: "#888888", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", marginTop: "0.5vh" }}>Providers supported</div>
          </div>
          <div style={{ width: "0.1vw", backgroundColor: "#E0E0E0" }} />
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "2.6vw", fontWeight: 700, letterSpacing: "-0.02em" }}>∞</div>
            <div style={{ fontSize: "0.8vw", color: "#888888", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", marginTop: "0.5vh" }}>Concurrent calls</div>
          </div>
          <div style={{ width: "0.1vw", backgroundColor: "#E0E0E0" }} />
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "2.6vw", fontWeight: 700, letterSpacing: "-0.02em" }}>24/7</div>
            <div style={{ fontSize: "0.8vw", color: "#888888", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", marginTop: "0.5vh" }}>Availability</div>
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
          <div style={{ fontWeight: 600, color: "#1C1C1C" }}>04 / 14</div>
        </div>
      </div>
    </div>
  );
}
