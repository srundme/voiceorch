const SSWatermark = () => (
  <div style={{ position: "absolute", bottom: "2.8vh", left: "3vw", display: "flex", alignItems: "center", gap: "0.7vw" }}>
    <div style={{ width: "2.2vw", height: "0.3vh", background: "#FF6F00", borderRadius: "2px" }} />
    <span style={{ fontSize: "0.75vw", fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: "#FF6F00", opacity: 0.85 }}>
      snapserve.ai
    </span>
  </div>
);

export default function Slide5() {
  const step: React.CSSProperties = {
    flex: 1, background: "#FFFFFF", border: "0.06vh solid #E8EAF0",
    borderRadius: "1.2vw", padding: "2.4vh 2vw",
    boxShadow: "0 0.8vh 2.2vh rgba(26,35,126,0.09)", display: "flex", flexDirection: "column",
    alignItems: "center", textAlign: "center",
  };

  return (
    <div
      className="w-screen h-screen overflow-hidden relative"
      style={{ background: "#FAFAFA", fontFamily: "var(--font-body-family)", display: "flex", flexDirection: "column" }}
    >
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "0.55vh", background: "#FF6F00" }} />
      <div style={{ background: "#1A237E", padding: "3.2vh 6vw 2.8vh 6vw", display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: "0.75vw", fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: "#FF6F00", marginBottom: "0.8vh" }}>How It Works</div>
          <h1 style={{ fontFamily: "var(--font-display-family)", fontSize: "2.6vw", fontWeight: 700, color: "#FFFFFF", margin: 0, lineHeight: 1.15 }}>
            Describe → Configure → Live. Under 5 minutes.
          </h1>
        </div>
        <span style={{ fontSize: "0.85vw", fontWeight: 600, color: "#4B6CB7", letterSpacing: "0.06em", paddingBottom: "0.3vh" }}>06 / 14</span>
      </div>

      <div style={{ flex: 1, padding: "2.8vh 6vw 6.5vh 6vw", display: "flex", flexDirection: "column", gap: "2.4vh" }}>
        <div style={{ display: "flex", alignItems: "stretch", gap: "0" }}>
          <div style={step}>
            <div style={{
              width: "3.6vw", height: "3.6vw", borderRadius: "50%", background: "#1A237E",
              display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "1.8vh",
            }}>
              <span style={{ color: "#FF6F00", fontWeight: 800, fontSize: "1.2vw" }}>01</span>
            </div>
            <div style={{ fontSize: "1.22vw", fontWeight: 700, color: "#1A237E", marginBottom: "1.2vh", lineHeight: 1.25 }}>Describe your agent</div>
            <div style={{ fontSize: "1.02vw", color: "#5B5470", lineHeight: 1.6 }}>
              Plain language. What it does, which languages it speaks, what to remember. No forms, no config screens, no engineers needed.
            </div>
            <div style={{
              marginTop: "2vh", background: "#F0F3FF", borderRadius: "0.8vw",
              padding: "1.4vh 1.2vw", fontSize: "0.95vw", color: "#1A237E",
              fontStyle: "italic", lineHeight: 1.5, textAlign: "left",
            }}>
              &ldquo;A Tamil-speaking insurance renewal agent that remembers past interactions and never asks for info already given.&rdquo;
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", padding: "0 1.4vw" }}>
            <div style={{ fontSize: "2vw", color: "#FF6F00", fontWeight: 700 }}>→</div>
          </div>

          <div style={step}>
            <div style={{
              width: "3.6vw", height: "3.6vw", borderRadius: "50%", background: "#1A237E",
              display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "1.8vh",
            }}>
              <span style={{ color: "#FF6F00", fontWeight: 800, fontSize: "1.2vw" }}>02</span>
            </div>
            <div style={{ fontSize: "1.22vw", fontWeight: 700, color: "#1A237E", marginBottom: "1.2vh", lineHeight: 1.25 }}>Platform auto-configures everything</div>
            <div style={{ fontSize: "1.02vw", color: "#5B5470", lineHeight: 1.6 }}>
              Selects the right STT, LLM, and TTS for your language. Applies TRAI and DPDP guardrails automatically. Generates your system prompt.
            </div>
            <div style={{ marginTop: "2vh", display: "flex", flexDirection: "column", gap: "0.7vh" }}>
              {["Tamil STT + Sarvam LLM selected", "System prompt generated", "TRAI / DPDP rules applied", "Memory layer armed"].map((item) => (
                <div key={item} style={{ display: "flex", alignItems: "center", gap: "0.6vw", fontSize: "0.92vw", color: "#1A237E" }}>
                  <span style={{ color: "#FF6F00", fontWeight: 700, fontSize: "1.1vw" }}>✓</span> {item}
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", padding: "0 1.4vw" }}>
            <div style={{ fontSize: "2vw", color: "#FF6F00", fontWeight: 700 }}>→</div>
          </div>

          <div style={step}>
            <div style={{
              width: "3.6vw", height: "3.6vw", borderRadius: "50%", background: "#FF6F00",
              display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "1.8vh",
            }}>
              <span style={{ color: "#FFFFFF", fontWeight: 800, fontSize: "1.2vw" }}>03</span>
            </div>
            <div style={{ fontSize: "1.22vw", fontWeight: 700, color: "#1A237E", marginBottom: "1.2vh", lineHeight: 1.25 }}>Get a number &amp; go live</div>
            <div style={{ fontSize: "1.02vw", color: "#5B5470", lineHeight: 1.6 }}>
              Provision a real Indian mobile number via built-in KYC — or connect your own. Memory is active from call one. Every caller remembered from minute one.
            </div>
            <div style={{
              marginTop: "2vh", background: "#1A237E", borderRadius: "0.8vw",
              padding: "1.4vh 1.4vw", color: "#FFFFFF", fontSize: "1.05vw", fontWeight: 700,
            }}>
              Live in &lt; 5 minutes
            </div>
          </div>
        </div>

        <div style={{
          background: "#1A237E", borderRadius: "1.1vw", padding: "2.2vh 2.8vw",
          display: "flex", alignItems: "center", gap: "3vw",
        }}>
          <div style={{ fontSize: "1.18vw", fontStyle: "italic", color: "#C9D5F5", lineHeight: 1.6, flex: 1 }}>
            "I described the agent in plain English. In under five minutes I had a live Tamil-speaking insurance agent with a real Indian mobile number — and it remembered everything from my test call."
          </div>
          <div style={{ width: "0.06vw", background: "rgba(255,111,0,0.35)", alignSelf: "stretch" }} />
          <div style={{ whiteSpace: "nowrap", textAlign: "center" }}>
            <div style={{ fontFamily: "var(--font-display-family)", fontSize: "3vw", fontWeight: 800, color: "#FF6F00" }}>&lt; 5 min</div>
            <div style={{ fontSize: "0.88vw", fontWeight: 600, color: "#9FA8DA", marginTop: "0.4vh", letterSpacing: "0.1em", textTransform: "uppercase" }}>from sign-up to live call</div>
          </div>
        </div>
      </div>

      <SSWatermark />
    </div>
  );
}
