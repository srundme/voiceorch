const SSWatermark = () => (
  <div style={{ position: "absolute", bottom: "2.8vh", left: "3vw", display: "flex", alignItems: "center", gap: "0.7vw" }}>
    <div style={{ width: "2.2vw", height: "0.3vh", background: "#FF6F00", borderRadius: "2px" }} />
    <span style={{ fontSize: "0.75vw", fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: "#FF6F00", opacity: 0.85 }}>
      snapserve.ai
    </span>
  </div>
);

export default function Slide8() {
  const phases = [
    {
      label: "TODAY",
      color: "#FF6F00",
      items: [
        "155 Active Users onboarded",
        "Full platform live in production",
        "Multilingual voice agents with cross-call memory",
        "TRAI / DPDP / IRDAI guardrails active",
      ],
    },
    {
      label: "+12 MONTHS",
      color: "#1A237E",
      items: [
        "Convert pilot users to paid recurring campaigns",
        "Expand footprint across India via reseller networks and direct business owners",
        "Implement SnapServe as the primary L1 Qualifier and customer support engine for 1,000+ businesses",
        "Memory Proxy API publicly available",
      ],
    },
    {
      label: "+2 YEARS",
      color: "#1A237E",
      items: [
        "₹5 Cr ARR — 50+ enterprise clients",
        "Expand to UAE and Philippines",
        "SAP SI channel partnerships live",
        "Sector-specific compliance modules",
      ],
    },
    {
      label: "+5 YEARS",
      color: "#1A237E",
      items: [
        "Market-leading India voice-AI platform",
        "Memory Proxy as industry standard",
        "Southeast Asia + Gulf footprint",
        "₹100 Cr ARR milestone",
      ],
    },
  ];

  return (
    <div
      className="w-screen h-screen overflow-hidden relative"
      style={{ background: "#FAFAFA", fontFamily: "var(--font-body-family)", display: "flex", flexDirection: "column" }}
    >
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "0.55vh", background: "#FF6F00" }} />
      <div style={{ background: "#1A237E", padding: "3.2vh 6vw 2.8vh 6vw", display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: "0.75vw", fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: "#FF6F00", marginBottom: "0.8vh" }}>Roadmap &amp; Milestones</div>
          <h1 style={{ fontFamily: "var(--font-display-family)", fontSize: "2.6vw", fontWeight: 700, color: "#FFFFFF", margin: 0, lineHeight: 1.15 }}>
            Live today. Scaling tomorrow.
          </h1>
        </div>
        <span style={{ fontSize: "0.85vw", fontWeight: 600, color: "#4B6CB7", letterSpacing: "0.06em", paddingBottom: "0.3vh" }}>12 / 16</span>
      </div>

      <div style={{ flex: 1, padding: "2.8vh 6vw 6.5vh 6vw", display: "flex", gap: "1.8vw" }}>
        {phases.map(({ label, color, items }, i) => (
          <div
            key={label}
            style={{
              flex: 1,
              background: i === 0 ? "#1A237E" : "#FFFFFF",
              border: i === 0 ? "none" : "0.06vh solid #E8EAF0",
              borderRadius: "1.2vw",
              padding: "2.8vh 2vw",
              boxShadow: "0 0.8vh 2.2vh rgba(26,35,126,0.09)",
              display: "flex", flexDirection: "column",
              position: "relative",
              overflow: "hidden",
            }}
          >
            {i === 0 && (
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "0.5vh", background: "#FF6F00" }} />
            )}
            <div style={{
              fontSize: "0.78vw", fontWeight: 800, letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: i === 0 ? "#FF6F00" : color,
              marginBottom: "1.6vh",
            }}>
              {label}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "1.2vh" }}>
              {items.map((item) => (
                <div key={item} style={{ display: "flex", alignItems: "flex-start", gap: "0.8vw" }}>
                  <div style={{
                    width: "0.45vw", height: "0.45vw", borderRadius: "50%",
                    background: i === 0 ? "#FF6F00" : "#1A237E",
                    marginTop: "0.65vh", flexShrink: 0,
                  }} />
                  <div style={{ fontSize: "1.05vw", lineHeight: 1.55, color: i === 0 ? "#C9D5F5" : "#3A3A5C" }}>
                    {item}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>


    </div>
  );
}
