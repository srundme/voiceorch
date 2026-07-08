export default function Slide4() {
  const stepCard: React.CSSProperties = {
    flex: 1,
    background: "#FFFFFF",
    border: "0.06vh solid #E7DFF6",
    borderRadius: "1.4vw",
    padding: "3.2vh 2.2vw",
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
          04 / 12
        </span>
      </div>

      <div style={{ fontSize: "0.95vw", fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: "#F59E0B", marginBottom: "1.6vh" }}>
        Vibe Builder
      </div>
      <h1 style={{ fontFamily: "var(--font-display-family)", fontSize: "3vw", fontWeight: 700, color: "#1A1033", margin: "0 0 1.4vh 0", lineHeight: 1.15 }}>
        From idea to live agent in minutes
      </h1>
      <p style={{ fontSize: "1.15vw", color: "#5B5470", margin: "0 0 4.5vh 0", maxWidth: "62vw", lineHeight: 1.55 }}>
        No technical knowledge required. No developers. No agency. Just describe what you need.
      </p>

      <div style={{ display: "flex", alignItems: "stretch", gap: "0", flex: 1 }}>
        <div style={stepCard}>
          <div
            style={{
              width: "3.8vw",
              height: "3.8vw",
              borderRadius: "50%",
              background: "linear-gradient(135deg, #EEE8FB 0%, #D8CEFB 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: "2.2vh",
              flexShrink: 0,
            }}
          >
            <svg width="1.8vw" height="1.8vw" viewBox="0 0 24 24" fill="none" stroke="#4B2ED6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
            </svg>
          </div>
          <div
            style={{
              fontSize: "0.78vw",
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "#4B2ED6",
              marginBottom: "1.2vh",
            }}
          >
            Step 1 — Describe
          </div>
          <div style={{ fontSize: "1.3vw", fontWeight: 700, marginBottom: "1.6vh", lineHeight: 1.25 }}>
            Tell us about your agent
          </div>
          <div style={{ fontSize: "1vw", color: "#5B5470", lineHeight: 1.6 }}>
            Type a plain-language brief: what the agent does, what language it speaks, what it should remember. No forms, no config screens.
          </div>
          <div
            style={{
              marginTop: "2.4vh",
              background: "#F5F3FD",
              borderRadius: "0.8vw",
              padding: "1.4vh 1.2vw",
              fontSize: "0.95vw",
              color: "#4B2ED6",
              fontStyle: "italic",
              lineHeight: 1.5,
              textAlign: "left",
            }}
          >
            &ldquo;An insurance renewal agent that speaks Tamil, remembers past interactions, and never asks the customer for info they&apos;ve already given.&rdquo;
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", padding: "0 1.6vw" }}>
          <div style={{ fontSize: "2vw", color: "#C9BEEA" }}>→</div>
        </div>

        <div style={stepCard}>
          <div
            style={{
              width: "3.8vw",
              height: "3.8vw",
              borderRadius: "50%",
              background: "linear-gradient(135deg, #FDF0DA 0%, #FDDFA8 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: "2.2vh",
              flexShrink: 0,
            }}
          >
            <svg width="1.8vw" height="1.8vw" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          </div>
          <div
            style={{
              fontSize: "0.78vw",
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "#F59E0B",
              marginBottom: "1.2vh",
            }}
          >
            Step 2 — Auto-configure
          </div>
          <div style={{ fontSize: "1.3vw", fontWeight: 700, marginBottom: "1.6vh", lineHeight: 1.25 }}>
            SnapServe sets everything up
          </div>
          <div style={{ fontSize: "1vw", color: "#5B5470", lineHeight: 1.6 }}>
            Picks the right STT, LLM, and TTS for your language. Writes the system prompt. Sets compliance rules for TRAI, IRDAI, and DPDP. Zero decisions for you.
          </div>
          <div style={{ marginTop: "2.4vh", display: "flex", flexDirection: "column", gap: "0.8vh" }}>
            {["Tamil STT + Sarvam LLM selected", "System prompt generated", "TRAI/DPDP rules applied"].map((item) => (
              <div key={item} style={{ display: "flex", alignItems: "center", gap: "0.6vw", fontSize: "0.92vw", color: "#3A3350" }}>
                <span style={{ color: "#4B2ED6", fontWeight: 700 }}>✓</span>
                {item}
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", padding: "0 1.6vw" }}>
          <div style={{ fontSize: "2vw", color: "#C9BEEA" }}>→</div>
        </div>

        <div style={stepCard}>
          <div
            style={{
              width: "3.8vw",
              height: "3.8vw",
              borderRadius: "50%",
              background: "linear-gradient(135deg, #4B2ED6 0%, #2A1670 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: "2.2vh",
              flexShrink: 0,
            }}
          >
            <svg width="1.8vw" height="1.8vw" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.24h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.85A16 16 0 0 0 15.15 16.09l.98-.98a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
          </div>
          <div
            style={{
              fontSize: "0.78vw",
              fontWeight: 700,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "#4B2ED6",
              marginBottom: "1.2vh",
            }}
          >
            Step 3 — Go Live
          </div>
          <div style={{ fontSize: "1.3vw", fontWeight: 700, marginBottom: "1.6vh", lineHeight: 1.25 }}>
            Connect a number, you&apos;re live
          </div>
          <div style={{ fontSize: "1vw", color: "#5B5470", lineHeight: 1.6 }}>
            Link a phone number from your telephony provider. Your agent starts taking calls immediately — with memory active from call one.
          </div>
          <div
            style={{
              marginTop: "2.4vh",
              background: "linear-gradient(135deg, #4B2ED6 0%, #2A1670 100%)",
              borderRadius: "0.8vw",
              padding: "1.4vh 1.4vw",
              color: "#FFFFFF",
              fontSize: "1.05vw",
              fontWeight: 600,
              textAlign: "center",
            }}
          >
            Agent live in &lt; 5 minutes
          </div>
        </div>
      </div>
    </div>
  );
}
