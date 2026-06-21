export default function Slide5() {
  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", backgroundColor: "#FFFFFF", fontFamily: "'Inter', sans-serif", color: "#1C1C1C", position: "relative", display: "flex", flexDirection: "column", padding: "8vh 8vw", boxSizing: "border-box" }}>
      <div style={{ width: "84vw", height: "0.2vh", backgroundColor: "#1C1C1C", position: "absolute", top: "8vh", left: "8vw" }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: "2vh" }}>
        <div style={{ fontSize: "1vw", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>snapserve.ai</div>
        <div style={{ fontSize: "1vw", fontWeight: 400, color: "#666666" }}>How — The Aitel Pipeline</div>
      </div>
      <div style={{ position: "absolute", top: "32vh", left: "8vw", fontSize: "26vw", fontWeight: 700, color: "#F5F5F5", lineHeight: 0.8, zIndex: 0, userSelect: "none", letterSpacing: "-0.05em" }}>05</div>
      <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", justifyContent: "flex-start", zIndex: 1, position: "relative", marginTop: "7vh" }}>
        <h2 style={{ fontSize: "3.5vw", fontWeight: 700, margin: "0 0 5vh 0", lineHeight: 1.1, letterSpacing: "-0.02em" }}>Four layers, sub-2-second response.</h2>
        <div style={{ display: "flex", gap: "0", alignItems: "stretch", marginBottom: "4vh" }}>
          <div style={{ flex: 1, borderLeft: "0.3vh solid #1C1C1C", paddingLeft: "1.5vw", paddingRight: "2vw" }}>
            <div style={{ fontSize: "0.8vw", color: "#888888", textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "'DM Mono', monospace", marginBottom: "1vh" }}>Step 1</div>
            <div style={{ fontSize: "1.4vw", fontWeight: 600, marginBottom: "0.8vh" }}>ASR</div>
            <div style={{ fontSize: "1vw", color: "#4A4A4A", lineHeight: 1.5 }}>Caller speaks. Sarvam / Azure transcribes in real-time with Indic language support.</div>
          </div>
          <div style={{ width: "0.1vw", backgroundColor: "#E0E0E0", margin: "0 1vw" }} />
          <div style={{ flex: 1, borderLeft: "0.3vh solid #1C1C1C", paddingLeft: "1.5vw", paddingRight: "2vw" }}>
            <div style={{ fontSize: "0.8vw", color: "#888888", textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "'DM Mono', monospace", marginBottom: "1vh" }}>Step 2</div>
            <div style={{ fontSize: "1.4vw", fontWeight: 600, marginBottom: "0.8vh" }}>LLM</div>
            <div style={{ fontSize: "1vw", color: "#4A4A4A", lineHeight: 1.5 }}>Google Gemini / Groq understands intent, queries memory, executes tools, forms a response.</div>
          </div>
          <div style={{ width: "0.1vw", backgroundColor: "#E0E0E0", margin: "0 1vw" }} />
          <div style={{ flex: 1, borderLeft: "0.3vh solid #1C1C1C", paddingLeft: "1.5vw", paddingRight: "2vw" }}>
            <div style={{ fontSize: "0.8vw", color: "#888888", textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "'DM Mono', monospace", marginBottom: "1vh" }}>Step 3</div>
            <div style={{ fontSize: "1.4vw", fontWeight: 600, marginBottom: "0.8vh" }}>TTS</div>
            <div style={{ fontSize: "1vw", color: "#4A4A4A", lineHeight: 1.5 }}>Cartesia / ElevenLabs synthesises speech. Audio starts playing before the full response is generated.</div>
          </div>
          <div style={{ width: "0.1vw", backgroundColor: "#E0E0E0", margin: "0 1vw" }} />
          <div style={{ flex: 1, borderLeft: "0.3vh solid #1C1C1C", paddingLeft: "1.5vw" }}>
            <div style={{ fontSize: "0.8vw", color: "#888888", textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: "'DM Mono', monospace", marginBottom: "1vh" }}>Step 4</div>
            <div style={{ fontSize: "1.4vw", fontWeight: 600, marginBottom: "0.8vh" }}>Memory</div>
            <div style={{ fontSize: "1vw", color: "#4A4A4A", lineHeight: 1.5 }}>Every call, every preference, every fact stored. The agent remembers the caller across all future interactions.</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: "5vw", backgroundColor: "#FAFAFA", padding: "2.5vh 2.5vw", border: "0.1vh solid #E0E0E0" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "2.8vw", fontWeight: 700, letterSpacing: "-0.02em" }}>854ms</div>
            <div style={{ fontSize: "0.9vw", color: "#666666", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", marginTop: "0.5vh" }}>Avg LLM latency</div>
          </div>
          <div style={{ width: "0.1vw", backgroundColor: "#E0E0E0" }} />
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "2.8vw", fontWeight: 700, letterSpacing: "-0.02em" }}>452ms</div>
            <div style={{ fontSize: "0.9vw", color: "#666666", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", marginTop: "0.5vh" }}>TTS first audio</div>
          </div>
          <div style={{ width: "0.1vw", backgroundColor: "#E0E0E0" }} />
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "2.8vw", fontWeight: 700, letterSpacing: "-0.02em" }}>24/7</div>
            <div style={{ fontSize: "0.9vw", color: "#666666", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", marginTop: "0.5vh" }}>Availability</div>
          </div>
          <div style={{ width: "0.1vw", backgroundColor: "#E0E0E0" }} />
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "2.8vw", fontWeight: 700, letterSpacing: "-0.02em" }}>∞</div>
            <div style={{ fontSize: "0.9vw", color: "#666666", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", marginTop: "0.5vh" }}>Concurrent calls</div>
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
          <div style={{ color: "#1C1C1C", fontWeight: 600 }}>05</div>
        </div>
      </div>
    </div>
  );
}
