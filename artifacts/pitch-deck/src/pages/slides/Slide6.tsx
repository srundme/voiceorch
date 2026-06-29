export default function Slide6() {
  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", backgroundColor: "#FFFFFF", fontFamily: "'Inter', sans-serif", color: "#1C1C1C", position: "relative", display: "flex", flexDirection: "column", padding: "7vh 8vw 5vh 8vw", boxSizing: "border-box" }}>
      <div style={{ width: "84vw", height: "0.2vh", backgroundColor: "#1C1C1C", position: "absolute", top: "7vh", left: "8vw" }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: "2vh", zIndex: 1 }}>
        <div style={{ fontSize: "0.95vw", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "'DM Mono', monospace" }}>snapserve.ai</div>
        <div style={{ fontSize: "0.9vw", fontWeight: 400, color: "#888888", fontFamily: "'DM Mono', monospace" }}>06 — Why Now</div>
      </div>
      <div style={{ position: "absolute", top: "28vh", right: "4vw", fontSize: "22vw", fontWeight: 700, color: "#F5F5F5", lineHeight: 1, zIndex: 0, userSelect: "none", letterSpacing: "-0.06em" }}>07</div>
      <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", justifyContent: "flex-start", zIndex: 1, position: "relative", marginTop: "5vh" }}>
        <h2 style={{ fontSize: "3.4vw", fontWeight: 700, margin: "0 0 1.5vh 0", lineHeight: 1.1, letterSpacing: "-0.025em", maxWidth: "70vw" }}>Four structural shifts made 2026 the right year to build this.</h2>
        <p style={{ fontSize: "1.2vw", color: "#4A4A4A", maxWidth: "60vw", lineHeight: 1.6, marginBottom: "4vh" }}>This is not a "coming soon" market. It is an open infrastructure race that closes in the next 18–24 months. The player who captures enterprise trust now becomes the default layer.</p>
        <div style={{ display: "flex", flexDirection: "column", gap: "2.2vh" }}>
          <div style={{ display: "flex", gap: "2.5vw", alignItems: "flex-start" }}>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.85vw", color: "#888888", minWidth: "12vw", paddingTop: "0.2vh" }}>LLM cost − 90%</div>
            <div style={{ flex: 1, fontSize: "1.1vw", color: "#1C1C1C", lineHeight: 1.5 }}>Gemini Flash and Groq Llama brought per-call LLM cost from $0.12 in 2023 to $0.008 today. Voice AI is now economically viable at ₹3/min.</div>
          </div>
          <div style={{ width: "84vw", marginLeft: "-8vw", height: "0.05vh", backgroundColor: "#F0F0F0" }} />
          <div style={{ display: "flex", gap: "2.5vw", alignItems: "flex-start" }}>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.85vw", color: "#888888", minWidth: "12vw", paddingTop: "0.2vh" }}>Indic ASR — solved</div>
            <div style={{ flex: 1, fontSize: "1.1vw", color: "#1C1C1C", lineHeight: 1.5 }}>Sarvam AI's Saarika model crossed 94% WER on Hindi, Tamil, and Telugu in 2024. The language barrier for 600M Indian callers no longer exists.</div>
          </div>
          <div style={{ width: "84vw", marginLeft: "-8vw", height: "0.05vh", backgroundColor: "#F0F0F0" }} />
          <div style={{ display: "flex", gap: "2.5vw", alignItems: "flex-start" }}>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.85vw", color: "#888888", minWidth: "12vw", paddingTop: "0.2vh" }}>Category validated</div>
            <div style={{ flex: 1, fontSize: "1.1vw", color: "#1C1C1C", lineHeight: 1.5 }}>Vapi AI crossed $15M ARR. Bolna AI raised a seed round. The market has confirmed demand for voice AI infrastructure — but neither serves India well.</div>
          </div>
          <div style={{ width: "84vw", marginLeft: "-8vw", height: "0.05vh", backgroundColor: "#F0F0F0" }} />
          <div style={{ display: "flex", gap: "2.5vw", alignItems: "flex-start" }}>
            <div style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.85vw", color: "#888888", minWidth: "12vw", paddingTop: "0.2vh" }}>Window before big tech</div>
            <div style={{ flex: 1, fontSize: "1.1vw", color: "#1C1C1C", lineHeight: 1.5 }}>AWS Connect and Twilio AI are US-first and 18–24 months behind on Indian telephony and Indic languages. The window to own India's orchestration layer is now.</div>
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
          <div style={{ fontWeight: 600, color: "#1C1C1C" }}>07 / 14</div>
        </div>
      </div>
    </div>
  );
}
