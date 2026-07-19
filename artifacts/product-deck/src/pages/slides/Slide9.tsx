const SSWatermark = () => (
  <div style={{ position: "absolute", bottom: "2.8vh", left: "3vw", display: "flex", alignItems: "center", gap: "0.7vw" }}>
    <div style={{ width: "2.2vw", height: "0.3vh", background: "#FF6F00", borderRadius: "2px" }} />
    <span style={{ fontSize: "0.75vw", fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: "#FF6F00", opacity: 0.85 }}>
      snapserve.ai
    </span>
  </div>
);

export default function Slide9() {
  const stat: React.CSSProperties = {
    flex: 1, background: "#FFFFFF", border: "0.06vh solid #E8EAF0",
    borderRadius: "1.2vw", padding: "2.8vh 2vw",
    boxShadow: "0 0.8vh 2.2vh rgba(26,35,126,0.09)",
    display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center",
  };

  return (
    <div
      className="w-screen h-screen overflow-hidden relative"
      style={{ background: "#FAFAFA", fontFamily: "var(--font-body-family)", display: "flex", flexDirection: "column" }}
    >
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "0.55vh", background: "#FF6F00" }} />
      <div style={{ background: "#1A237E", padding: "3.2vh 6vw 2.8vh 6vw", display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: "0.75vw", fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: "#FF6F00", marginBottom: "0.8vh" }}>Traction</div>
          <h1 style={{ fontFamily: "var(--font-display-family)", fontSize: "2.6vw", fontWeight: 700, color: "#FFFFFF", margin: 0, lineHeight: 1.15 }}>
            Product live. Calls running. Memory working.
          </h1>
        </div>
        <span style={{ fontSize: "0.85vw", fontWeight: 600, color: "#4B6CB7", letterSpacing: "0.06em", paddingBottom: "0.3vh" }}>05 / 14</span>
      </div>

      <div style={{ flex: 1, padding: "2.8vh 6vw 6.5vh 6vw", display: "flex", flexDirection: "column", gap: "2.2vh" }}>
        <div style={{ display: "flex", gap: "2vw" }}>
          {[
            { number: "12+", label: "Indian languages", sub: "Tamil · Hindi · Marathi · Telugu · Kannada + more — validated in live calls" },
            { number: "5 min", label: "to deploy an agent", sub: "From sign-up to a live phone number — no engineers, no infra" },
            { number: "3", label: "compliance layers", sub: "TRAI DND · DPDP consent · IRDAI disclosure — enforced on every call" },
            { number: "100%", label: "memory carry-forward", sub: "No caller repeats themselves — context from every prior call is available" },
          ].map(({ number, label, sub }) => (
            <div key={label} style={stat}>
              <div style={{ fontFamily: "var(--font-display-family)", fontSize: "3.4vw", fontWeight: 800, color: "#1A237E", lineHeight: 1 }}>{number}</div>
              <div style={{ fontSize: "1.08vw", fontWeight: 700, color: "#FF6F00", marginTop: "0.8vh", marginBottom: "0.6vh" }}>{label}</div>
              <div style={{ fontSize: "0.92vw", color: "#5B5470", lineHeight: 1.5 }}>{sub}</div>
            </div>
          ))}
        </div>

        <div style={{
          background: "#FFFFFF", border: "0.06vh solid #E8EAF0", borderRadius: "1.1vw",
          padding: "2.4vh 2.8vw", boxShadow: "0 0.6vh 1.8vh rgba(26,35,126,0.07)",
          display: "flex", gap: "3vw", alignItems: "stretch",
        }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: "1.2vh" }}>
            <div style={{ fontSize: "0.78vw", fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#FF6F00", marginBottom: "0.4vh" }}>
              Where we are today
            </div>
            {[
              { icon: "✓", text: "Full platform live in production — not a demo, not a prototype" },
              { icon: "✓", text: "Pilot BFSI accounts onboarded — insurance and NBFC use cases running" },
              { icon: "✓", text: "End-to-end call recordings, transcripts, and memory extractions working" },
              { icon: "✓", text: "Caller memory persists across dropped calls, agent switches, and session gaps" },
              { icon: "→", text: "Converting pilots to paid recurring subscriptions — this raise accelerates it" },
            ].map(({ icon, text }) => (
              <div key={text} style={{ display: "flex", alignItems: "flex-start", gap: "0.8vw", fontSize: "1.05vw", color: "#3A3A5C", lineHeight: 1.5 }}>
                <span style={{ color: icon === "→" ? "#FF6F00" : "#1A237E", fontWeight: 800, flexShrink: 0, marginTop: "0.05vh" }}>{icon}</span>
                <span>{text}</span>
              </div>
            ))}
          </div>
          <div style={{ width: "0.06vw", background: "#E8EAF0", alignSelf: "stretch" }} />
          <div style={{ width: "26vw", display: "flex", flexDirection: "column", justifyContent: "center", gap: "1.6vh" }}>
            <div style={{ fontSize: "0.78vw", fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#FF6F00" }}>
              What a pilot customer told us
            </div>
            <div style={{
              background: "#F0F3FF", borderRadius: "1vw", padding: "2vh 1.8vw",
              borderLeft: "0.3vw solid #1A237E",
            }}>
              <div style={{ fontSize: "1.08vw", fontStyle: "italic", color: "#1A237E", lineHeight: 1.65 }}>
                "The agent remembered that the customer had already submitted documents last week and skipped straight to the renewal step. That's something our human agents miss half the time."
              </div>
              <div style={{ fontSize: "0.88vw", color: "#7986CB", marginTop: "1.2vh", fontWeight: 600 }}>
                — Insurance renewal pilot, Tamil Nadu
              </div>
            </div>
          </div>
        </div>
      </div>

      <SSWatermark />
    </div>
  );
}
