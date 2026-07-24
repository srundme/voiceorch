const SSWatermark = () => (
  <div style={{ position: "absolute", bottom: "2.8vh", left: "3vw", display: "flex", alignItems: "center", gap: "0.7vw" }}>
    <div style={{ width: "2.2vw", height: "0.3vh", background: "#FF6F00", borderRadius: "2px" }} />
    <span style={{ fontSize: "0.75vw", fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: "#FF6F00", opacity: 0.85 }}>
      snapserve.ai
    </span>
  </div>
);

export default function Slide16() {
  return (
    <div
      className="w-screen h-screen overflow-hidden relative"
      style={{ background: "#FAFAFA", fontFamily: "var(--font-body-family)", display: "flex", flexDirection: "column" }}
    >
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "0.55vh", background: "#FF6F00" }} />

      <div style={{ background: "#1A237E", padding: "3.2vh 6vw 2.8vh 6vw", display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: "0.75vw", fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: "#FF6F00", marginBottom: "0.8vh" }}>
            The Core Differentiator
          </div>
          <h1 style={{ fontFamily: "var(--font-display-family)", fontSize: "2.4vw", fontWeight: 700, color: "#FFFFFF", margin: 0, lineHeight: 1.15 }}>
            The Core Memory Engine — Persistent episodic memory, native by design.
          </h1>
        </div>
        <span style={{ fontSize: "0.85vw", fontWeight: 600, color: "#4B6CB7", letterSpacing: "0.06em", paddingBottom: "0.3vh" }}>05 / 16</span>
      </div>

      <div style={{ flex: 1, padding: "2.8vh 6vw 2.4vh 6vw", display: "flex", flexDirection: "column", gap: "2.2vh" }}>
        <div style={{ display: "flex", gap: "2.4vw", flex: 1 }}>

          {/* Left — The Insight */}
          <div style={{
            flex: 1, background: "#FFFFFF", border: "0.06vh solid #E8EAF0",
            borderRadius: "1.2vw", padding: "3vh 2.8vw",
            boxShadow: "0 0.8vh 2.2vh rgba(26,35,126,0.09)", display: "flex", flexDirection: "column", gap: "1.8vh",
          }}>
            <div style={{ fontSize: "0.78vw", fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#FF6F00" }}>
              The Insight
            </div>
            <div style={{ fontSize: "1.28vw", fontWeight: 700, color: "#1A237E", lineHeight: 1.3 }}>
              Every voice agent built on SnapServe is stateful by default.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "1.2vh" }}>
              {[
                {
                  label: "The Problem",
                  color: "#B71C1C",
                  bg: "#FFF5F5",
                  border: "#FFCDD2",
                  text: "Traditional voice AI suffers from \"context amnesia.\" When a call drops or a follow-up is scheduled, the caller starts from zero — every time.",
                },
                {
                  label: "The SnapServe Standard",
                  color: "#1A237E",
                  bg: "#F0F3FF",
                  border: "#C5CAE9",
                  text: "We built episodic memory directly into the core architecture. Zero external databases. Zero integrations. Zero custom configurations.",
                },
                {
                  label: "The Result",
                  color: "#1B5E20",
                  bg: "#F1F8F1",
                  border: "#A5D6A7",
                  text: "Every fact, commitment, and conversation history is retained natively. SnapServe does not just handle the voice — it handles the relationship.",
                },
              ].map(({ label, color, bg, border, text }) => (
                <div key={label} style={{
                  background: bg, borderRadius: "0.8vw", padding: "1.4vh 1.4vw",
                  borderLeft: `0.28vw solid ${color}`, border: `0.06vh solid ${border}`,
                  borderLeftWidth: "0.28vw", borderLeftColor: color,
                }}>
                  <div style={{ fontSize: "0.78vw", fontWeight: 800, color, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: "0.5vh" }}>{label}</div>
                  <div style={{ fontSize: "0.97vw", color: "#3A3A5C", lineHeight: 1.58 }}>{text}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Right — Insurance Use Case */}
          <div style={{
            flex: 1, background: "#1A237E", borderRadius: "1.2vw", padding: "3vh 2.8vw",
            display: "flex", flexDirection: "column", gap: "0",
          }}>
            <div style={{ fontSize: "0.78vw", fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#FF6F00", marginBottom: "2vh" }}>
              How It Works — Insurance Use Case
            </div>
            {[
              {
                n: "01",
                title: "The Initial Conversation",
                body: "An AI agent calls a prospect about a term life insurance policy. They spend 5 minutes on pre-existing conditions and premium budget — until the prospect says, \"I'm driving, call me back tomorrow at 10 AM.\"",
              },
              {
                n: "02",
                title: "Auto-Extraction to the Memory Graph",
                body: "Without any manual trigger, SnapServe immediately extracts the exact budget, medical facts, and callback time — stored securely in the agent's persistent memory.",
              },
              {
                n: "03",
                title: "The Seamless Callback",
                body: "The agent dials back at exactly 10 AM: \"Hi, picking up from yesterday — you mentioned your budget was ₹15,000 for the term plan. Should we proceed with those details?\"",
              },
            ].map(({ n, title, body }, i) => (
              <div key={n} style={{ display: "flex", gap: "1.4vw", alignItems: "flex-start", paddingBottom: i < 2 ? "2.2vh" : "0" }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <div style={{
                    width: "2.4vw", height: "2.4vw", borderRadius: "50%",
                    background: i === 0 ? "#FF6F00" : "rgba(255,111,0,0.22)",
                    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                  }}>
                    <span style={{ fontSize: "0.84vw", fontWeight: 800, color: "#FFFFFF" }}>{n}</span>
                  </div>
                  {i < 2 && <div style={{ width: "0.06vw", height: "2.8vh", background: "rgba(255,111,0,0.28)", marginTop: "0.4vh" }} />}
                </div>
                <div style={{ paddingTop: "0.3vh" }}>
                  <div style={{ fontSize: "1.05vw", fontWeight: 700, color: "#FFFFFF", marginBottom: "0.6vh", lineHeight: 1.25 }}>{title}</div>
                  <div style={{ fontSize: "0.93vw", color: "#9FA8DA", lineHeight: 1.58 }}>{body}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom banner */}
        <div style={{
          background: "#0D1B4B", borderRadius: "1vw", padding: "2vh 2.8vw",
          display: "flex", alignItems: "center", gap: "2vw",
        }}>
          <div style={{ width: "0.35vw", height: "4.5vh", background: "#FF6F00", borderRadius: "2px", flexShrink: 0 }} />
          <div style={{ fontSize: "1.18vw", fontWeight: 700, color: "#FF6F00", lineHeight: 1.45 }}>
            This is not a plugin or an add-on. It is a foundational architecture that treats every customer journey as one continuous conversation.
          </div>
        </div>
      </div>

      <SSWatermark />
    </div>
  );
}
