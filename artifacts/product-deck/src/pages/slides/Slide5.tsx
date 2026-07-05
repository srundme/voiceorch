export default function Slide5() {
  const rowStyle: React.CSSProperties = {
    display: "flex",
    gap: "2vw",
    alignItems: "flex-start",
    background: "#FFFFFF",
    border: "0.06vh solid #E7DFF6",
    borderRadius: "1.2vw",
    padding: "2.6vh 2.4vw",
    boxShadow: "0 1vh 2.6vh rgba(42,22,112,0.06)",
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
          05 / 11
        </span>
      </div>

      <div style={{ fontSize: "0.95vw", fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: "#F59E0B", marginBottom: "1.6vh" }}>
        Why Now
      </div>
      <h1 style={{ fontFamily: "var(--font-display-family)", fontSize: "3vw", fontWeight: 700, color: "#1A1033", margin: "0 0 4.5vh 0", lineHeight: 1.15 }}>
        Three shifts are converging
      </h1>

      <div style={{ display: "flex", flexDirection: "column", gap: "2vh", flex: 1, justifyContent: "center" }}>
        <div style={rowStyle}>
          <div style={{ minWidth: "3vw", fontSize: "1.6vw", fontFamily: "var(--font-display-family)", fontWeight: 700, color: "#4B2ED6" }}>01</div>
          <div>
            <div style={{ fontSize: "1.35vw", fontWeight: 700, marginBottom: "0.9vh" }}>Voice AI just crossed the quality bar</div>
            <div style={{ fontSize: "1.05vw", color: "#5B5470", lineHeight: 1.55 }}>Indian-language STT, LLM and TTS became good and cheap in the last 12–18 months.</div>
          </div>
        </div>

        <div style={rowStyle}>
          <div style={{ minWidth: "3vw", fontSize: "1.6vw", fontFamily: "var(--font-display-family)", fontWeight: 700, color: "#4B2ED6" }}>02</div>
          <div>
            <div style={{ fontSize: "1.35vw", fontWeight: 700, marginBottom: "0.9vh" }}>India-first models have arrived</div>
            <div style={{ fontSize: "1.05vw", color: "#5B5470", lineHeight: 1.55 }}>Home-grown speech models handle Indian accents and code-switching; global platforms treat India as an afterthought.</div>
          </div>
        </div>

        <div style={rowStyle}>
          <div style={{ minWidth: "3vw", fontSize: "1.6vw", fontFamily: "var(--font-display-family)", fontWeight: 700, color: "#4B2ED6" }}>03</div>
          <div>
            <div style={{ fontSize: "1.35vw", fontWeight: 700, marginBottom: "0.9vh" }}>Regulation is forcing the shift</div>
            <div style={{ fontSize: "1.05vw", color: "#5B5470", lineHeight: 1.55 }}>DPDP, TRAI and IRDAI tightening rules make compliant-by-design automation a purchase driver.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
