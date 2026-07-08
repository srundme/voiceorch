export default function Slide5() {
  const pipeCard: React.CSSProperties = {
    flex: 1,
    background: "#FFFFFF",
    border: "0.06vh solid #E7DFF6",
    borderRadius: "1.4vw",
    padding: "2.4vh 1.8vw",
    boxShadow: "0 1.2vh 3vh rgba(42,22,112,0.08)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    textAlign: "center",
  };

  return (
    <div
      className="w-screen h-screen overflow-hidden relative"
      style={{
        background: "linear-gradient(180deg, #FFFFFF 0%, #FAF8FE 100%)",
        fontFamily: "var(--font-body-family)",
        color: "#1A1033",
        padding: "6vh 8vw 5vh 8vw",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4vh" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.8vw" }}>
          <svg width="1.6vw" height="1.6vw" viewBox="0 0 100 100" fill="none">
            <rect x="6" y="14" width="88" height="20" rx="10" fill="#4B2ED6" opacity="1" />
            <rect x="14" y="42" width="72" height="20" rx="10" fill="#4B2ED6" opacity="0.6" />
            <rect x="22" y="70" width="56" height="20" rx="10" fill="#4B2ED6" opacity="0.36" />
          </svg>
          <span style={{ fontSize: "1vw", fontWeight: 700, color: "#2A1670" }}>SnapServe</span>
        </div>
        <span style={{ fontSize: "0.85vw", fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", color: "#9A90B5" }}>
          05 / 12
        </span>
      </div>

      <div style={{ fontSize: "0.95vw", fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: "#F59E0B", marginBottom: "1.6vh" }}>
        How It Works
      </div>
      <h1 style={{ fontFamily: "var(--font-display-family)", fontSize: "3vw", fontWeight: 700, color: "#1A1033", margin: "0 0 4vh 0", lineHeight: 1.15 }}>
        Orchestration, not a single model
      </h1>

      <div style={{ display: "flex", alignItems: "center", gap: "1.4vw", marginBottom: "2vh" }}>
        <div style={pipeCard}>
          <div style={{ width: "3.2vw", height: "3.2vw", borderRadius: "50%", background: "#EEE8FB", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "1.6vh" }}>
            <svg width="1.6vw" height="1.6vw" viewBox="0 0 24 24" fill="none" stroke="#4B2ED6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
              <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
              <line x1="12" y1="19" x2="12" y2="23" />
            </svg>
          </div>
          <div style={{ fontSize: "1.25vw", fontWeight: 700 }}>Speech-to-Text</div>
        </div>

        <div style={{ fontSize: "1.8vw", color: "#C9BEEA" }}>→</div>

        <div style={pipeCard}>
          <div style={{ width: "3.2vw", height: "3.2vw", borderRadius: "50%", background: "#FDF0DA", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "1.6vh" }}>
            <svg width="1.6vw" height="1.6vw" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="10" rx="2" />
              <circle cx="12" cy="5" r="2" />
              <line x1="12" y1="7" x2="12" y2="11" />
              <line x1="8" y1="16" x2="8" y2="16" />
              <line x1="16" y1="16" x2="16" y2="16" />
            </svg>
          </div>
          <div style={{ fontSize: "1.25vw", fontWeight: 700 }}>Language Model</div>
        </div>

        <div style={{ fontSize: "1.8vw", color: "#C9BEEA" }}>→</div>

        <div style={pipeCard}>
          <div style={{ width: "3.2vw", height: "3.2vw", borderRadius: "50%", background: "#EEE8FB", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "1.6vh" }}>
            <svg width="1.6vw" height="1.6vw" viewBox="0 0 24 24" fill="none" stroke="#4B2ED6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 5 6 9H2v6h4l5 4V5Z" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
            </svg>
          </div>
          <div style={{ fontSize: "1.25vw", fontWeight: 700 }}>Text-to-Speech</div>
        </div>
      </div>

      <div style={{ fontSize: "1.05vw", color: "#5B5470", textAlign: "center", marginBottom: "4vh" }}>
        Provider-agnostic orchestration in TypeScript — swap the best or cheapest engine at every layer.
      </div>

      <div
        style={{
          background: "linear-gradient(135deg, #4B2ED6 0%, #2A1670 100%)",
          borderRadius: "1.4vw",
          padding: "3vh 2.6vw",
          color: "#FFFFFF",
          display: "flex",
          flexDirection: "column",
          gap: "1.2vh",
          boxShadow: "0 1.4vh 3.4vh rgba(42,22,112,0.22)",
        }}
      >
        <div style={{ fontSize: "0.9vw", fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: "#F59E0B" }}>
          Memory Layer — The Moat
        </div>
        <div style={{ fontSize: "1.2vw", lineHeight: 1.55 }}>
          Facts, commitments and episodes stored per caller, injected into every conversation.
        </div>
        <div style={{ fontSize: "1vw", color: "#DCD3F2", lineHeight: 1.55 }}>
          Also works as an OpenAI-compatible proxy — other platforms point their <code style={{ background: "rgba(255,255,255,0.14)", padding: "0.1vh 0.4vw", borderRadius: "0.4vw" }}>api_base</code> at SnapServe and get caller memory with zero code change.
        </div>
      </div>
    </div>
  );
}
