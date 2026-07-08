export default function Slide7() {
  const th: React.CSSProperties = {
    textAlign: "center",
    padding: "1.6vh 1.4vw",
    fontSize: "0.85vw",
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "#2A1670",
    borderBottom: "0.14vh solid #E7DFF6",
  };
  const td: React.CSSProperties = {
    padding: "1.6vh 1.4vw",
    fontSize: "1.05vw",
    color: "#3A3350",
    borderBottom: "0.06vh solid #EFE9FA",
  };
  const tdCenter: React.CSSProperties = { ...td, textAlign: "center" };

  const Check = () => (
    <span style={{ color: "#4B2ED6", fontWeight: 700, fontSize: "1.2vw" }}>&#10003;</span>
  );
  const Cross = () => (
    <span style={{ color: "#C7BCEA", fontWeight: 700, fontSize: "1.1vw" }}>&#10005;</span>
  );

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
          07 / 12
        </span>
      </div>

      <div style={{ fontSize: "0.95vw", fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: "#F59E0B", marginBottom: "1.6vh" }}>
        Competitive Landscape
      </div>
      <h1 style={{ fontFamily: "var(--font-display-family)", fontSize: "3vw", fontWeight: 700, color: "#1A1033", margin: "0 0 1.6vh 0", lineHeight: 1.15 }}>
        Where we win
      </h1>
      <div style={{ fontSize: "1.15vw", color: "#5B5470", marginBottom: "3.5vh", maxWidth: "62vw" }}>
        Vapi, Retell, Bolna and others orchestrate calls. None of them remember callers or let non-technical users build agents.
      </div>

      <div
        style={{
          background: "#FFFFFF",
          border: "0.06vh solid #E7DFF6",
          borderRadius: "1.2vw",
          padding: "1vh 1.6vw 0.4vh 1.6vw",
          boxShadow: "0 1.2vh 3vh rgba(42,22,112,0.08)",
          flex: 1,
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: "left" }}>Capability</th>
              <th style={{ ...th, color: "#4B2ED6" }}>SnapServe</th>
              <th style={th}>Vapi / Retell / Bolna</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ background: "#F5F3FD" }}>
              <td style={{ ...td, fontWeight: 600, color: "#2A1670" }}>Zero-code agent builder</td>
              <td style={{ ...tdCenter, background: "#F5F3FD" }}><Check /></td>
              <td style={{ ...tdCenter, background: "#F5F3FD" }}><Cross /></td>
            </tr>
            <tr>
              <td style={td}>Persistent cross-call memory</td>
              <td style={tdCenter}><Check /></td>
              <td style={tdCenter}><Cross /></td>
            </tr>
            <tr>
              <td style={td}>Dropped-call resume with full context</td>
              <td style={tdCenter}><Check /></td>
              <td style={tdCenter}><Cross /></td>
            </tr>
            <tr>
              <td style={td}>Tamil / Hinglish native handling</td>
              <td style={tdCenter}><Check /></td>
              <td style={tdCenter}><Cross /></td>
            </tr>
            <tr>
              <td style={td}>In-India latency</td>
              <td style={tdCenter}><Check /></td>
              <td style={tdCenter}><Cross /></td>
            </tr>
            <tr>
              <td style={td}>IRDAI / TRAI / DPDP compliance built in</td>
              <td style={tdCenter}><Check /></td>
              <td style={tdCenter}><Cross /></td>
            </tr>
            <tr>
              <td style={{ ...td, borderBottom: "none" }}>Provider-agnostic STT / LLM / TTS</td>
              <td style={{ ...tdCenter, borderBottom: "none" }}><Check /></td>
              <td style={{ ...tdCenter, borderBottom: "none", color: "#9A90B5" }}>Partial</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
