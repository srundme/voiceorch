const SSWatermark = () => (
  <div style={{ position: "absolute", bottom: "2.8vh", left: "3vw", display: "flex", alignItems: "center", gap: "0.7vw" }}>
    <div style={{ width: "2.2vw", height: "0.3vh", background: "#FF6F00", borderRadius: "2px" }} />
    <span style={{ fontSize: "0.75vw", fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: "#FF6F00", opacity: 0.85 }}>
      snapserve.ai
    </span>
  </div>
);

export default function Slide13() {
  const bullets = [
    {
      title: "Provider-independent context layer",
      body: "The Memory Layer lives outside any single LLM or telephony provider. Structured caller facts, commitments, and episode summaries are cached in PostgreSQL — available to every conversation turn regardless of which STT/LLM/TTS is in use on that call.",
    },
    {
      title: "Fact & commitment extraction after every call",
      body: "After each call, the pipeline automatically extracts caller-specific facts (name, policy number, outstanding balance, language preference) and commitments ('I will pay on Friday'). These are stored as typed key-value pairs and injected verbatim into the next call's system prompt — the agent always knows the caller without being told.",
    },
    {
      title: "OpenAI-compatible Memory Proxy API",
      body: "Any team already running Vapi, Bolna, or Retell can point their api_base at SnapServe and gain persistent caller memory with zero code change. Our distribution network is built inside competitors' stacks — they send us usage, we grow the moat.",
    },
  ];

  return (
    <div
      className="w-screen h-screen overflow-hidden relative"
      style={{ background: "#FAFAFA", fontFamily: "var(--font-body-family)", display: "flex", flexDirection: "column" }}
    >
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "0.55vh", background: "#FF6F00" }} />
      <div style={{
        background: "#1A237E", padding: "3.2vh 6vw 2.8vh 6vw",
        display: "flex", alignItems: "flex-end", justifyContent: "space-between",
      }}>
        <div>
          <div style={{ fontSize: "0.75vw", fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: "#FF6F00", marginBottom: "0.8vh" }}>
            Technical Appendix
          </div>
          <h1 style={{ fontFamily: "var(--font-display-family)", fontSize: "2.6vw", fontWeight: 700, color: "#FFFFFF", margin: 0, lineHeight: 1.15 }}>
            Annexure 2 — The Memory Layer
          </h1>
        </div>
        <span style={{ fontSize: "0.85vw", fontWeight: 600, color: "#4B6CB7", letterSpacing: "0.06em", paddingBottom: "0.3vh" }}>15 / 16</span>
      </div>

      <div style={{ flex: 1, padding: "3vh 6vw 6.5vh 6vw", display: "flex", flexDirection: "column", gap: "2.4vh" }}>
        {bullets.map(({ title, body }, i) => (
          <div
            key={title}
            style={{
              flex: 1, display: "flex", gap: "2.4vw", alignItems: "stretch",
              background: "#FFFFFF", border: "0.06vh solid #E8EAF0",
              borderRadius: "1.1vw", overflow: "hidden",
              boxShadow: "0 0.6vh 1.8vh rgba(26,35,126,0.08)",
            }}
          >
            <div style={{ width: "0.55vw", background: i === 1 ? "#FF6F00" : "#1A237E", flexShrink: 0 }} />
            <div style={{ padding: "2.4vh 2.2vw", display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <div style={{ fontSize: "1.22vw", fontWeight: 700, color: "#1A237E", marginBottom: "1vh", lineHeight: 1.25 }}>
                {title}
              </div>
              <div style={{ fontSize: "1.08vw", color: "#5B5470", lineHeight: 1.65 }}>{body}</div>
            </div>
          </div>
        ))}

        <div style={{
          background: "#1A237E", borderRadius: "1vw", padding: "1.8vh 2.4vw",
          display: "flex", alignItems: "center", gap: "1.6vw",
        }}>
          <div style={{ fontSize: "0.78vw", fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: "#FF6F00", whiteSpace: "nowrap" }}>
            The Moat
          </div>
          <div style={{ width: "0.06vw", height: "3.2vh", background: "rgba(255,111,0,0.35)" }} />
          <div style={{ fontSize: "1.05vw", color: "#C9D5F5", lineHeight: 1.55 }}>
            Every call enriches the knowledge graph. Caller data compounds with usage — competitors who copy our pipeline still start from zero caller history. The gap widens with every minute of calls processed.
          </div>
        </div>
      </div>

      <SSWatermark />
    </div>
  );
}
