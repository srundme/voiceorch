export default function Slide3() {
  const cardStyle: React.CSSProperties = {
    background: "#FFFFFF",
    border: "0.06vh solid #E7DFF6",
    borderRadius: "1.4vw",
    padding: "2.6vh 2vw",
    boxShadow: "0 1.2vh 3vh rgba(42,22,112,0.08)",
    display: "flex",
    flexDirection: "column",
    flex: 1,
  };
  const iconWrap = (bg: string): React.CSSProperties => ({
    width: "3.2vw",
    height: "3.2vw",
    borderRadius: "50%",
    background: bg,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: "1.8vh",
  });

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
          03 / 11
        </span>
      </div>

      <div style={{ fontSize: "0.95vw", fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: "#F59E0B", marginBottom: "1.6vh" }}>
        The Solution
      </div>
      <h1 style={{ fontFamily: "var(--font-display-family)", fontSize: "3vw", fontWeight: 700, color: "#1A1033", margin: "0 0 4vh 0", lineHeight: 1.15 }}>
        SnapServe: voice AI with a memory
      </h1>

      <div style={{ display: "flex", gap: "1.8vw", flex: 1 }}>
        <div style={cardStyle}>
          <div style={iconWrap("#EEE8FB")}>
            <svg width="1.6vw" height="1.6vw" viewBox="0 0 24 24" fill="none" stroke="#4B2ED6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08A3 3 0 0 1 3 13.5a3 3 0 0 1 .34-5.62A2.5 2.5 0 0 1 6 4a2.5 2.5 0 0 1 3.5-2Z" />
              <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08A3 3 0 0 0 21 13.5a3 3 0 0 0-.34-5.62A2.5 2.5 0 0 0 18 4a2.5 2.5 0 0 0-3.5-2Z" />
            </svg>
          </div>
          <div style={{ fontSize: "1.2vw", fontWeight: 700, marginBottom: "1.2vh", lineHeight: 1.25 }}>Persistent cross-call memory</div>
          <div style={{ fontSize: "1vw", color: "#5B5470", lineHeight: 1.55 }}>
            Caller history, commitments and context carry across calls — conversations resume, not restart.
          </div>
        </div>

        <div style={cardStyle}>
          <div style={iconWrap("#FDF0DA")}>
            <svg width="1.6vw" height="1.6vw" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
            </svg>
          </div>
          <div style={{ fontSize: "1.2vw", fontWeight: 700, marginBottom: "1.2vh", lineHeight: 1.25 }}>Drop → auto-redial → resume</div>
          <div style={{ fontSize: "1vw", color: "#5B5470", lineHeight: 1.55 }}>
            Call drops mid-sentence, the agent redials and picks up exactly where it left off.
          </div>
        </div>

        <div style={cardStyle}>
          <div style={iconWrap("#EEE8FB")}>
            <svg width="1.6vw" height="1.6vw" viewBox="0 0 24 24" fill="none" stroke="#4B2ED6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
          </div>
          <div style={{ fontSize: "1.2vw", fontWeight: 700, marginBottom: "1.2vh", lineHeight: 1.25 }}>Built for Indian languages</div>
          <div style={{ fontSize: "1vw", color: "#5B5470", lineHeight: 1.55 }}>
            Tamil, Hinglish and Indian accents native, with low in-country latency.
          </div>
        </div>

        <div style={cardStyle}>
          <div style={iconWrap("#FDF0DA")}>
            <svg width="1.6vw" height="1.6vw" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
            </svg>
          </div>
          <div style={{ fontSize: "1.2vw", fontWeight: 700, marginBottom: "1.2vh", lineHeight: 1.25 }}>Compliance built in</div>
          <div style={{ fontSize: "1vw", color: "#5B5470", lineHeight: 1.55 }}>
            IRDAI, TRAI and DPDP designed in from day one.
          </div>
        </div>
      </div>
    </div>
  );
}
