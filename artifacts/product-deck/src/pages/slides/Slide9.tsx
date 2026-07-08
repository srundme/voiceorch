export default function Slide9() {
  const cardStyle: React.CSSProperties = {
    flex: 1,
    background: "#FFFFFF",
    border: "0.06vh solid #E7DFF6",
    borderRadius: "1.4vw",
    padding: "3vh 2.2vw",
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
          09 / 12
        </span>
      </div>

      <div style={{ fontSize: "0.95vw", fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: "#F59E0B", marginBottom: "1.6vh" }}>
        Go-to-Market
      </div>
      <h1 style={{ fontFamily: "var(--font-display-family)", fontSize: "3vw", fontWeight: 700, color: "#1A1033", margin: "0 0 4.5vh 0", lineHeight: 1.15 }}>
        Three ways in
      </h1>

      <div style={{ display: "flex", gap: "2vw", flex: 1 }}>
        <div style={cardStyle}>
          <div style={{ fontSize: "0.85vw", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#F59E0B", marginBottom: "1.6vh" }}>
            Direct
          </div>
          <div style={{ fontSize: "1.3vw", fontWeight: 700, marginBottom: "1.6vh", lineHeight: 1.25 }}>
            Insurance &amp; BFSI
          </div>
          <div style={{ fontSize: "1.05vw", color: "#5B5470", lineHeight: 1.6 }}>
            Outbound campaigns for insurers and lenders, compliance-first pitch.
          </div>
        </div>

        <div style={cardStyle}>
          <div style={{ fontSize: "0.85vw", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#F59E0B", marginBottom: "1.6vh" }}>
            Channel
          </div>
          <div style={{ fontSize: "1.3vw", fontWeight: 700, marginBottom: "1.6vh", lineHeight: 1.25 }}>
            SAP system integrators
          </div>
          <div style={{ fontSize: "1.05vw", color: "#5B5470", lineHeight: 1.6 }}>
            SIs take SnapServe into SAP enterprise accounts, with collections/FSCM as the wedge.
          </div>
        </div>

        <div style={cardStyle}>
          <div style={{ fontSize: "0.85vw", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#F59E0B", marginBottom: "1.6vh" }}>
            Product-led
          </div>
          <div style={{ fontSize: "1.3vw", fontWeight: 700, marginBottom: "1.6vh", lineHeight: 1.25 }}>
            The memory proxy
          </div>
          <div style={{ fontSize: "1.05vw", color: "#5B5470", lineHeight: 1.6 }}>
            Platforms on Vapi, Bolna or Retell plug in SnapServe&apos;s memory with zero switching cost — we grow inside competitors&apos; ecosystems.
          </div>
        </div>
      </div>
    </div>
  );
}
