const SSWatermark = () => (
  <div style={{ position: "absolute", bottom: "2.8vh", left: "3vw", display: "flex", alignItems: "center", gap: "0.7vw" }}>
    <div style={{ width: "2.2vw", height: "0.3vh", background: "#FF6F00", borderRadius: "2px" }} />
    <span style={{ fontSize: "0.75vw", fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: "#FF6F00", opacity: 0.85 }}>
      snapserve.ai
    </span>
  </div>
);

export default function Slide12() {
  const bullets = [
    {
      title: "TypeScript orchestration — fully type-safe end to end",
      body: "Entire voice pipeline built in TypeScript on Node.js 24 — from ASR transcript to TTS audio byte. Full type-safety across every provider boundary means rapid iteration without sacrificing production reliability.",
    },
    {
      title: "Decoupled, provider-agnostic architecture",
      body: "STT, LLM, and TTS are abstract adapter layers. Swapping a provider (e.g. Deepgram → Sarvam, OpenAI → Groq) is a single config change — no pipeline surgery. Each layer today supports 3+ providers in parallel.",
    },
    {
      title: "Dynamic provider selection + automatic failover",
      body: "Provider selection happens at call-start based on agent config, caller language, and real-time performance. Retry logic and latency routing are baked in — a provider outage triggers automatic failover, not a dropped call.",
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
            Annexure 1 — The Tech Stack
          </h1>
        </div>
        <span style={{ fontSize: "0.85vw", fontWeight: 600, color: "#4B6CB7", letterSpacing: "0.06em", paddingBottom: "0.3vh" }}>13 / 15</span>
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
            <div style={{ width: "0.55vw", background: i % 2 === 0 ? "#1A237E" : "#FF6F00", flexShrink: 0 }} />
            <div style={{ padding: "2.4vh 2.2vw", display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <div style={{ fontSize: "1.22vw", fontWeight: 700, color: "#1A237E", marginBottom: "1vh", lineHeight: 1.25 }}>
                {title}
              </div>
              <div style={{ fontSize: "1.08vw", color: "#5B5470", lineHeight: 1.65 }}>{body}</div>
            </div>
          </div>
        ))}

        <div style={{
          background: "#F0F3FF", border: "0.06vh solid #C5CAE9", borderRadius: "1vw",
          padding: "1.8vh 2.4vw",
        }}>
          <div style={{ fontSize: "0.78vw", fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: "#1A237E", marginBottom: "0.6vh" }}>
            Stack at a glance
          </div>
          <div style={{ fontSize: "1.02vw", color: "#3A3A5C", lineHeight: 1.55 }}>
            pnpm monorepo · Node.js 24 · TypeScript 5.9 · Express 5 · PostgreSQL + Drizzle ORM · React + Vite · esbuild bundle · OpenAPI contract-first codegen (Orval)
          </div>
        </div>
      </div>

      <SSWatermark />
    </div>
  );
}
