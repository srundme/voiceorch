export default function Slide7() {
  const statCard: React.CSSProperties = {
    flex: 1,
    background: "#FFFFFF",
    border: "0.06vh solid #E7DFF6",
    borderRadius: "1.4vw",
    padding: "3vh 2vw",
    boxShadow: "0 1.2vh 3vh rgba(42,22,112,0.08)",
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
          07 / 11
        </span>
      </div>

      <div style={{ fontSize: "0.95vw", fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: "#F59E0B", marginBottom: "1.6vh" }}>
        Market Opportunity
      </div>
      <h1 style={{ fontFamily: "var(--font-display-family)", fontSize: "3vw", fontWeight: 700, color: "#1A1033", margin: "0 0 4vh 0", lineHeight: 1.15 }}>
        A large, underserved market
      </h1>

      <div style={{ display: "flex", gap: "2vw", marginBottom: "4vh" }}>
        <div style={statCard}>
          <div style={{ fontFamily: "var(--font-display-family)", fontSize: "3.2vw", fontWeight: 700, color: "#4B2ED6" }}>$40B+</div>
          <div style={{ fontSize: "1.02vw", color: "#5B5470", lineHeight: 1.5, marginTop: "1.4vh" }}>
            India BPM / contact-center industry — voice still the largest channel
          </div>
        </div>
        <div style={statCard}>
          <div style={{ fontFamily: "var(--font-display-family)", fontSize: "3.2vw", fontWeight: 700, color: "#4B2ED6" }}>Millions</div>
          <div style={{ fontSize: "1.02vw", color: "#5B5470", lineHeight: 1.5, marginTop: "1.4vh" }}>
            of outbound calls daily across insurance, lending, collections, support
          </div>
        </div>
        <div style={statCard}>
          <div style={{ fontFamily: "var(--font-display-family)", fontSize: "3.2vw", fontWeight: 700, color: "#4B2ED6" }}>10x</div>
          <div style={{ fontSize: "1.02vw", color: "#5B5470", lineHeight: 1.5, marginTop: "1.4vh" }}>
            cost advantage of AI calls vs human agents at scale
          </div>
        </div>
      </div>

      <div
        style={{
          background: "linear-gradient(135deg, #4B2ED6 0%, #2A1670 100%)",
          borderRadius: "1.4vw",
          padding: "3vh 2.6vw",
          color: "#FFFFFF",
          display: "flex",
          flexDirection: "column",
          gap: "1.4vh",
          boxShadow: "0 1.4vh 3.4vh rgba(42,22,112,0.22)",
        }}
      >
        <div style={{ fontSize: "1.15vw", lineHeight: 1.55 }}>
          <span style={{ color: "#F59E0B", fontWeight: 700 }}>Beachhead: </span>
          insurance &amp; BFSI outbound in India (renewals, collections, verification) — high volume, compliance-heavy, badly served.
        </div>
        <div style={{ fontSize: "1.15vw", lineHeight: 1.55, color: "#DCD3F2" }}>
          <span style={{ color: "#F59E0B", fontWeight: 700 }}>Expansion: </span>
          UAE and Philippines on the same India cost base.
        </div>
      </div>
    </div>
  );
}
