export default function Slide10() {
  const cardStyle: React.CSSProperties = {
    flex: 1,
    background: "#FFFFFF",
    border: "0.06vh solid #E7DFF6",
    borderRadius: "1.4vw",
    padding: "3.4vh 2.6vw",
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
          10 / 12
        </span>
      </div>

      <div style={{ fontSize: "0.95vw", fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: "#F59E0B", marginBottom: "1.6vh" }}>
        Team
      </div>
      <h1 style={{ fontFamily: "var(--font-display-family)", fontSize: "3vw", fontWeight: 700, color: "#1A1033", margin: "0 0 4.5vh 0", lineHeight: 1.15 }}>
        Built by people who&apos;ve shipped it
      </h1>

      <div style={{ display: "flex", gap: "2.4vw", flex: 1 }}>
        <div style={cardStyle}>
          <div style={{ width: "4.2vw", height: "4.2vw", borderRadius: "50%", background: "#EEE8FB", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "2.2vh" }}>
            <svg width="2vw" height="2vw" viewBox="0 0 24 24" fill="none" stroke="#4B2ED6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </div>
          <div style={{ fontSize: "1.5vw", fontWeight: 700, marginBottom: "0.6vh" }}>Karthikeyan</div>
          <div style={{ fontSize: "0.95vw", fontWeight: 600, color: "#F59E0B", marginBottom: "1.8vh", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Founder · Product &amp; Business
          </div>
          <div style={{ fontSize: "1.05vw", color: "#5B5470", lineHeight: 1.6 }}>
            CMA US background, strong on unit economics and compliance. Non-technical founder who learnt AI hands-on and built the first prototype solo — knows the product to every nuance.
          </div>
        </div>

        <div style={cardStyle}>
          <div style={{ width: "4.2vw", height: "4.2vw", borderRadius: "50%", background: "#FDF0DA", display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "2.2vh" }}>
            <svg width="2vw" height="2vw" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="16 18 22 12 16 6" />
              <polyline points="8 6 2 12 8 18" />
            </svg>
          </div>
          <div style={{ fontSize: "1.5vw", fontWeight: 700, marginBottom: "0.6vh" }}>Gopi</div>
          <div style={{ fontSize: "0.95vw", fontWeight: 600, color: "#F59E0B", marginBottom: "1.8vh", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Co-founder · Engineering
          </div>
          <div style={{ fontSize: "1.05vw", color: "#5B5470", lineHeight: 1.6 }}>
            Software engineer from CGI. Took SnapServe from prototype to production platform running live calls — owns the TypeScript orchestration stack end to end.
          </div>
        </div>
      </div>
    </div>
  );
}
