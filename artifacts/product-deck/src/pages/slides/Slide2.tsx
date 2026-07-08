export default function Slide2() {
  const cardStyle: React.CSSProperties = {
    flex: 1,
    background: "#FFFFFF",
    border: "0.06vh solid #E7DFF6",
    borderRadius: "1.4vw",
    padding: "3.2vh 2.6vw",
    boxShadow: "0 1.2vh 3vh rgba(42,22,112,0.08)",
    display: "flex",
    flexDirection: "column",
  };
  const bulletStyle: React.CSSProperties = {
    fontSize: "1.15vw",
    lineHeight: 1.6,
    color: "#3A3350",
    marginBottom: "1.4vh",
    paddingLeft: "1.6vw",
    position: "relative",
  };
  const dotStyle = (color: string): React.CSSProperties => ({
    position: "absolute",
    left: 0,
    top: "0.75vh",
    width: "0.55vw",
    height: "0.55vw",
    borderRadius: "50%",
    background: color,
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
          02 / 12
        </span>
      </div>

      <div
        style={{
          fontSize: "0.95vw",
          fontWeight: 600,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: "#F59E0B",
          marginBottom: "1.6vh",
        }}
      >
        The Problem
      </div>
      <h1
        style={{
          fontFamily: "var(--font-display-family)",
          fontSize: "3vw",
          fontWeight: 700,
          color: "#1A1033",
          margin: "0 0 4.5vh 0",
          lineHeight: 1.15,
        }}
      >
        Customer calling in India is broken
      </h1>

      <div style={{ display: "flex", gap: "2.2vw", flex: 1 }}>
        <div style={cardStyle}>
          <div
            style={{
              width: "3.6vw",
              height: "3.6vw",
              borderRadius: "50%",
              background: "#EEE8FB",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: "2.2vh",
            }}
          >
            <svg width="1.8vw" height="1.8vw" viewBox="0 0 24 24" fill="none" stroke="#4B2ED6" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </div>
          <div style={{ fontSize: "1.4vw", fontWeight: 700, color: "#1A1033", marginBottom: "2.2vh" }}>
            Human call centers
          </div>
          <div style={bulletStyle}><span style={dotStyle("#4B2ED6")} />Expensive to scale, high attrition</div>
          <div style={bulletStyle}><span style={dotStyle("#4B2ED6")} />Agents forget context between calls</div>
          <div style={bulletStyle}><span style={dotStyle("#4B2ED6")} />Follow-ups missed, dropped calls never resumed</div>
          <div style={{ ...bulletStyle, marginBottom: 0 }}><span style={dotStyle("#4B2ED6")} />Quality depends on which human picks up</div>
        </div>

        <div style={cardStyle}>
          <div
            style={{
              width: "3.6vw",
              height: "3.6vw",
              borderRadius: "50%",
              background: "#FDF0DA",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: "2.2vh",
            }}
          >
            <svg width="1.8vw" height="1.8vw" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="8" width="16" height="12" rx="2" />
              <path d="M12 8V4" />
              <circle cx="9" cy="14" r="1" />
              <circle cx="15" cy="14" r="1" />
            </svg>
          </div>
          <div style={{ fontSize: "1.4vw", fontWeight: 700, color: "#1A1033", marginBottom: "2.2vh" }}>
            Today&apos;s AI voice agents
          </div>
          <div style={bulletStyle}><span style={dotStyle("#F59E0B")} />Stateless — every call starts from zero</div>
          <div style={bulletStyle}><span style={dotStyle("#F59E0B")} />Weak on Indian languages and accents</div>
          <div style={bulletStyle}><span style={dotStyle("#F59E0B")} />US-hosted latency kills conversation flow</div>
          <div style={{ ...bulletStyle, marginBottom: 0 }}><span style={dotStyle("#F59E0B")} />No IRDAI/TRAI/DPDP compliance built in</div>
        </div>
      </div>
    </div>
  );
}
