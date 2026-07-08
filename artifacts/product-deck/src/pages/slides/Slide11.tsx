export default function Slide11() {
  const colStyle: React.CSSProperties = {
    flex: 1,
    background: "#FFFFFF",
    border: "0.06vh solid #E7DFF6",
    borderRadius: "1.4vw",
    padding: "2.8vh 2.2vw",
    boxShadow: "0 1.2vh 3vh rgba(42,22,112,0.08)",
    display: "flex",
    flexDirection: "column",
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "3.6vh" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.8vw" }}>
          <svg width="1.6vw" height="1.6vw" viewBox="0 0 100 100" fill="none">
            <rect x="6" y="14" width="88" height="20" rx="10" fill="#4B2ED6" opacity="1" />
            <rect x="14" y="42" width="72" height="20" rx="10" fill="#4B2ED6" opacity="0.6" />
            <rect x="22" y="70" width="56" height="20" rx="10" fill="#4B2ED6" opacity="0.36" />
          </svg>
          <span style={{ fontSize: "1vw", fontWeight: 700, color: "#2A1670" }}>SnapServe</span>
        </div>
        <span style={{ fontSize: "0.85vw", fontWeight: 500, letterSpacing: "0.1em", textTransform: "uppercase", color: "#9A90B5" }}>
          11 / 12
        </span>
      </div>

      <div style={{ fontSize: "0.95vw", fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: "#F59E0B", marginBottom: "1.6vh" }}>
        Where We Are
      </div>
      <h1 style={{ fontFamily: "var(--font-display-family)", fontSize: "3vw", fontWeight: 700, color: "#1A1033", margin: "0 0 3.6vh 0", lineHeight: 1.15 }}>
        Built, now, next
      </h1>

      <div style={{ display: "flex", gap: "1.8vw", flex: 1, marginBottom: "2.6vh" }}>
        <div style={colStyle}>
          <div style={{ fontSize: "0.85vw", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#4B2ED6", marginBottom: "1.6vh" }}>
            Built
          </div>
          <div style={{ fontSize: "1.25vw", fontWeight: 700, marginBottom: "1.4vh", lineHeight: 1.3 }}>
            Full platform live in production
          </div>
          <div style={{ fontSize: "1.02vw", color: "#5B5470", lineHeight: 1.6 }}>
            Multilingual calls with cross-call memory working in real conditions.
          </div>
        </div>

        <div style={colStyle}>
          <div style={{ fontSize: "0.85vw", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#4B2ED6", marginBottom: "1.6vh" }}>
            Now
          </div>
          <div style={{ fontSize: "1.25vw", fontWeight: 700, marginBottom: "1.4vh", lineHeight: 1.3 }}>
            Just launched
          </div>
          <div style={{ fontSize: "1.02vw", color: "#5B5470", lineHeight: 1.6 }}>
            Onboarding first pilot clients in insurance and enterprise; SI partner outreach underway.
          </div>
        </div>

        <div style={colStyle}>
          <div style={{ fontSize: "0.85vw", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#4B2ED6", marginBottom: "1.6vh" }}>
            Next
          </div>
          <div style={{ fontSize: "1.25vw", fontWeight: 700, marginBottom: "1.4vh", lineHeight: 1.3 }}>
            Convert pilots to paid campaigns
          </div>
          <div style={{ fontSize: "1.02vw", color: "#5B5470", lineHeight: 1.6 }}>
            Ship the memory proxy publicly; expand language coverage.
          </div>
        </div>
      </div>

      <div style={{ fontSize: "0.98vw", fontStyle: "italic", color: "#9A90B5", textAlign: "center" }}>
        Honest status: pre-revenue, product-complete, launch week.
      </div>
    </div>
  );
}
