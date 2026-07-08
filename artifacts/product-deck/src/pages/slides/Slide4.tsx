const VBWatermark = () => (
  <div style={{ position: "absolute", bottom: "2.8vh", left: "3vw", display: "flex", alignItems: "center", gap: "0.7vw" }}>
    <div style={{ width: "2.2vw", height: "0.3vh", background: "#FF6F00", borderRadius: "2px" }} />
    <span style={{ fontSize: "0.75vw", fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: "#FF6F00", fontVariant: "small-caps", opacity: 0.85 }}>
      Vande Bharatam
    </span>
  </div>
);

export default function Slide4() {
  const block: React.CSSProperties = {
    flex: 1, background: "#FFFFFF", border: "0.06vh solid #E8EAF0",
    borderRadius: "1.1vw", padding: "2.4vh 2vw",
    boxShadow: "0 0.8vh 2vh rgba(26,35,126,0.09)", display: "flex", flexDirection: "column",
  };

  return (
    <div
      className="w-screen h-screen overflow-hidden relative"
      style={{ background: "#FAFAFA", fontFamily: "var(--font-body-family)", display: "flex", flexDirection: "column" }}
    >
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "0.55vh", background: "#FF6F00" }} />
      <div style={{ background: "#1A237E", padding: "3.2vh 6vw 2.8vh 6vw", display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: "0.75vw", fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: "#FF6F00", marginBottom: "0.8vh" }}>The Solution</div>
          <h1 style={{ fontFamily: "var(--font-display-family)", fontSize: "2.6vw", fontWeight: 700, color: "#FFFFFF", margin: 0, lineHeight: 1.15 }}>
            SnapServe — voice AI with a memory
          </h1>
        </div>
        <span style={{ fontSize: "0.85vw", fontWeight: 600, color: "#4B6CB7", letterSpacing: "0.06em", paddingBottom: "0.3vh" }}>04 / 14</span>
      </div>

      <div style={{ flex: 1, padding: "2.6vh 6vw 6.5vh 6vw", display: "flex", gap: "2.4vw" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "2vh" }}>
          <p style={{ fontSize: "1.12vw", color: "#3A3A5C", lineHeight: 1.65, margin: 0 }}>
            SnapServe lets any business owner describe their voice agent in plain language and go live in under 5 minutes.
            The platform auto-configures STT, LLM, and TTS — and every caller is remembered across every call.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: "1.4vh", flex: 1 }}>
            <div style={block}>
              <div style={{ display: "flex", alignItems: "center", gap: "1vw", marginBottom: "1.2vh" }}>
                <div style={{ width: "2.8vw", height: "2.8vw", borderRadius: "50%", background: "#EEF0FB", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <svg width="1.4vw" height="1.4vw" viewBox="0 0 24 24" fill="none" stroke="#1A237E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08A3 3 0 0 1 3 13.5a3 3 0 0 1 .34-5.62A2.5 2.5 0 0 1 6 4a2.5 2.5 0 0 1 3.5-2Z" />
                    <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08A3 3 0 0 0 21 13.5a3 3 0 0 0-.34-5.62A2.5 2.5 0 0 0 18 4a2.5 2.5 0 0 0-3.5-2Z" />
                  </svg>
                </div>
                <div style={{ fontSize: "1.18vw", fontWeight: 700, color: "#1A237E" }}>Persistent Memory</div>
              </div>
              <div style={{ fontSize: "1.02vw", color: "#5B5470", lineHeight: 1.58 }}>
                Caller history, facts, and commitments carry across every call — conversations resume, not restart.
              </div>
            </div>

            <div style={block}>
              <div style={{ display: "flex", alignItems: "center", gap: "1vw", marginBottom: "1.2vh" }}>
                <div style={{ width: "2.8vw", height: "2.8vw", borderRadius: "50%", background: "#FFF3E0", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <svg width="1.4vw" height="1.4vw" viewBox="0 0 24 24" fill="none" stroke="#FF6F00" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                  </svg>
                </div>
                <div style={{ fontSize: "1.18vw", fontWeight: 700, color: "#1A237E" }}>Contextual Auto-Redial</div>
              </div>
              <div style={{ fontSize: "1.02vw", color: "#5B5470", lineHeight: 1.58 }}>
                Call drops mid-sentence? The agent dials back and picks up exactly where it left off.
              </div>
            </div>

            <div style={block}>
              <div style={{ display: "flex", alignItems: "center", gap: "1vw", marginBottom: "1.2vh" }}>
                <div style={{ width: "2.8vw", height: "2.8vw", borderRadius: "50%", background: "#EEF0FB", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <svg width="1.4vw" height="1.4vw" viewBox="0 0 24 24" fill="none" stroke="#1A237E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" />
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                  </svg>
                </div>
                <div style={{ fontSize: "1.18vw", fontWeight: 700, color: "#1A237E" }}>Native Localization</div>
              </div>
              <div style={{ fontSize: "1.02vw", color: "#5B5470", lineHeight: 1.58 }}>
                Tamil, Hinglish, and Indian accents handled natively — low latency, in-country infrastructure.
              </div>
            </div>
          </div>
        </div>

        <div style={{ width: "28vw", display: "flex", flexDirection: "column", gap: "1.8vh" }}>
          <div style={{
            flex: 1, background: "#F0F3FF", border: "0.1vw dashed #C5CAE9", borderRadius: "1.2vw",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            color: "#9FA8DA", fontSize: "1.05vw", gap: "1.2vh",
          }}>
            <svg width="3vw" height="3vw" viewBox="0 0 24 24" fill="none" stroke="#9FA8DA" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" />
            </svg>
            <span>Product screenshot</span>
          </div>
          <div style={{
            background: "#1A237E", borderRadius: "1vw", padding: "1.8vh 2vw",
            display: "flex", alignItems: "center", gap: "1.2vw",
          }}>
            <div style={{ width: "0.55vw", height: "0.55vw", borderRadius: "50%", background: "#4CAF50", flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: "0.78vw", fontWeight: 700, color: "#FF6F00", textTransform: "uppercase", letterSpacing: "0.14em" }}>Current Stage</div>
              <div style={{ fontSize: "1.05vw", fontWeight: 600, color: "#FFFFFF", marginTop: "0.3vh" }}>Product Ready · Live in Production</div>
            </div>
          </div>
        </div>
      </div>

      <VBWatermark />
    </div>
  );
}
