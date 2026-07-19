const SSWatermark = () => (
  <div style={{ position: "absolute", bottom: "2.8vh", left: "3vw", display: "flex", alignItems: "center", gap: "0.7vw" }}>
    <div style={{ width: "2.2vw", height: "0.3vh", background: "#FF6F00", borderRadius: "2px" }} />
    <span style={{ fontSize: "0.75vw", fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: "#FF6F00", opacity: 0.85 }}>
      snapserve.ai
    </span>
  </div>
);

export default function Slide14() {
  const rows = [
    {
      reg: "TRAI",
      full: "Telecom Regulatory Authority of India",
      description: "National Do Not Call (DND) registry scrubbing before every outbound call. Call timing restricted to permitted hours (9 AM – 9 PM). Caller ID disclosure and purpose-of-call announcement on connect. Automated call logging with duration and outcome for audit trails.",
      color: "#1A237E",
    },
    {
      reg: "DPDP",
      full: "Digital Personal Data Protection Act, 2023",
      description: "Caller consent captured and stored before any data is processed. Caller data is purpose-limited — facts extracted from calls are used only for service continuity, not sold or shared. Data retention windows enforced automatically; erasure requests handled via API. All PII encrypted at rest (AES-256-GCM).",
      color: "#FF6F00",
    },
    {
      reg: "IRDAI",
      full: "Insurance Regulatory & Development Authority of India",
      description: "Mandatory disclosure of agent identity and insurer name at call start for insurance deployments. Misselling prevention prompts baked into the agent system — the agent cannot quote prices or make promises outside the approved script. Call recordings retained per IRDAI audit requirements. Compliance module activates automatically when agent category is set to Insurance.",
      color: "#1A237E",
    },
  ];

  return (
    <div
      className="w-screen h-screen overflow-hidden relative"
      style={{ background: "#FAFAFA", fontFamily: "var(--font-body-family)", display: "flex", flexDirection: "column" }}
    >
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "0.55vh", background: "#FF6F00" }} />
      <div style={{
        background: "#1A237E", padding: "3.2vh 6vw 2.8vh 6vw",
        display: "flex", alignItems: "flex-end", justifyContent: "space-between",
      }}>
        <div>
          <div style={{ fontSize: "0.75vw", fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: "#FF6F00", marginBottom: "0.8vh" }}>
            Technical Appendix
          </div>
          <h1 style={{ fontFamily: "var(--font-display-family)", fontSize: "2.6vw", fontWeight: 700, color: "#FFFFFF", margin: 0, lineHeight: 1.15 }}>
            Annexure 3 — Enterprise Compliance Matrix
          </h1>
        </div>
        <span style={{ fontSize: "0.85vw", fontWeight: 600, color: "#4B6CB7", letterSpacing: "0.06em", paddingBottom: "0.3vh" }}>14 / 14</span>
      </div>

      <div style={{ flex: 1, padding: "2.8vh 6vw 2vh 6vw", display: "flex", flexDirection: "column", gap: "2vh" }}>
        {rows.map(({ reg, full, description, color }) => (
          <div
            key={reg}
            style={{
              flex: 1, display: "flex", gap: "0", alignItems: "stretch",
              background: "#FFFFFF", border: "0.06vh solid #E8EAF0",
              borderRadius: "1.1vw", overflow: "hidden",
              boxShadow: "0 0.6vh 1.8vh rgba(26,35,126,0.08)",
            }}
          >
            <div style={{
              width: "14vw", background: color === "#FF6F00" ? "#FFF3E0" : "#EEF0FB",
              padding: "2.4vh 2vw", display: "flex", flexDirection: "column", justifyContent: "center",
              borderRight: `0.06vh solid ${color === "#FF6F00" ? "#FFCC80" : "#C5CAE9"}`,
              flexShrink: 0,
            }}>
              <div style={{ fontFamily: "var(--font-display-family)", fontSize: "2.2vw", fontWeight: 800, color, lineHeight: 1 }}>
                {reg}
              </div>
              <div style={{ fontSize: "0.88vw", color: "#6B7280", lineHeight: 1.4, marginTop: "0.6vh" }}>{full}</div>
            </div>
            <div style={{ flex: 1, padding: "2.4vh 2.4vw", display: "flex", alignItems: "center" }}>
              <div style={{ fontSize: "1.07vw", color: "#3A3A5C", lineHeight: 1.65 }}>{description}</div>
            </div>
          </div>
        ))}

        <div style={{
          background: "#0D1B4B", borderRadius: "1.1vw", padding: "2.2vh 3vw",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <div style={{ fontSize: "1.4vw", fontWeight: 800, color: "#FFFFFF", marginBottom: "0.4vh" }}>
              Ready to see it live?
            </div>
            <div style={{ fontSize: "1.05vw", color: "#9FA8DA" }}>
              Book a demo or try it yourself at <span style={{ color: "#FF6F00", fontWeight: 700 }}>snapserve.ai</span>
            </div>
          </div>
          <div style={{
            background: "#FF6F00", borderRadius: "0.8vw", padding: "1.2vh 2.4vw",
            fontSize: "1.05vw", fontWeight: 700, color: "#FFFFFF", whiteSpace: "nowrap",
          }}>
            snapserve.ai →
          </div>
        </div>
      </div>

      <SSWatermark />
    </div>
  );
}
