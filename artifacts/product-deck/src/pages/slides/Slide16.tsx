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
            Distribution Moat
          </div>
          <h1 style={{ fontFamily: "var(--font-display-family)", fontSize: "2.6vw", fontWeight: 700, color: "#FFFFFF", margin: 0, lineHeight: 1.15 }}>
            The Memory Proxy — our distribution lives inside competitors' stacks.
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
            boxShadow: "0 0.8vh 2.2vh rgba(26,35,126,0.09)", display: "flex", flexDirection: "column", gap: "2vh",
          }}>
            <div style={{ fontSize: "0.78vw", fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#FF6F00" }}>
              The Insight
            </div>
            <div style={{ fontSize: "1.32vw", fontWeight: 700, color: "#1A237E", lineHeight: 1.35 }}>
              Every voice AI platform today — Vapi, Retell, Bolna — is stateless by design.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "1.4vh" }}>
              {[
                "Adding memory requires 3 tools and custom engineering. Most teams never get there.",
                "When a caller rings back, they start from zero — every time. This is accepted as normal.",
                "We built the memory layer they are all missing. And we made it plug-in compatible.",
              ].map((text, i) => (
                <div key={i} style={{ display: "flex", gap: "1vw", alignItems: "flex-start", fontSize: "1.08vw", color: "#3A3A5C", lineHeight: 1.58 }}>
                  <div style={{
                    width: "1.8vw", height: "1.8vw", borderRadius: "50%",
                    background: i === 2 ? "#FFF3E0" : "#F0F3FF",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0, marginTop: "0.15vh",
                  }}>
                    <span style={{ fontSize: "0.8vw", fontWeight: 800, color: i === 2 ? "#FF6F00" : "#7986CB" }}>
                      {i === 2 ? "✓" : String(i + 1)}
                    </span>
                  </div>
                  <span style={{ fontWeight: i === 2 ? 600 : 400, color: i === 2 ? "#1A237E" : "#3A3A5C" }}>{text}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Right — How It Works */}
          <div style={{
            flex: 1, background: "#1A237E", borderRadius: "1.2vw", padding: "3vh 2.8vw",
            display: "flex", flexDirection: "column", gap: "2vh",
          }}>
            <div style={{ fontSize: "0.78vw", fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#FF6F00" }}>
              How It Works — 3 Steps
            </div>
            {[
              {
                n: "01",
                title: "Teams add SnapServe without changing their product",
                body: "Teams already using Vapi or Bolna add SnapServe to their existing setup and gain full caller memory instantly. No rebuild. No migration.",
                code: null,
              },
              {
                n: "02",
                title: "Every call auto-extracts to the memory graph",
                body: "Caller facts, commitments, and history are extracted after every call — regardless of which platform ran it.",
                code: null,
              },
              {
                n: "03",
                title: "Next call starts with full context",
                body: "The competitor's platform handles the voice. Our memory handles the relationship. Both get better.",
                code: null,
              },
            ].map(({ n, title, body, code }, i) => (
              <div key={n} style={{ display: "flex", gap: "1.4vw", alignItems: "flex-start" }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <div style={{
                    width: "2.4vw", height: "2.4vw", borderRadius: "50%",
                    background: i === 0 ? "#FF6F00" : "rgba(255,111,0,0.2)",
                    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                  }}>
                    <span style={{ fontSize: "0.84vw", fontWeight: 800, color: "#FFFFFF" }}>{n}</span>
                  </div>
                  {i < 2 && <div style={{ width: "0.06vw", height: "2.6vh", background: "rgba(255,111,0,0.25)", marginTop: "0.4vh" }} />}
                </div>
                <div style={{ paddingTop: "0.2vh" }}>
                  <div style={{ fontSize: "1.08vw", fontWeight: 700, color: "#FFFFFF", marginBottom: "0.5vh", lineHeight: 1.3 }}>{title}</div>
                  <div style={{ fontSize: "0.95vw", color: "#9FA8DA", lineHeight: 1.55, marginBottom: code ? "0.8vh" : "0" }}>{body}</div>
                  {code && (
                    <div style={{
                      background: "rgba(0,0,0,0.3)", borderRadius: "0.5vw", padding: "0.6vh 1vw",
                      fontFamily: "monospace", fontSize: "0.88vw", color: "#A5D6A7",
                    }}>
                      {code}
                    </div>
                  )}
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
            This is not a feature. It is how our distribution compounds inside competitors' ecosystems.
          </div>
        </div>
      </div>

      <SSWatermark />
    </div>
  );
}
