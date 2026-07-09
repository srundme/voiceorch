const VBWatermark = () => (
  <div style={{ position: "absolute", bottom: "2.8vh", left: "3vw", display: "flex", alignItems: "center", gap: "0.7vw" }}>
    <div style={{ width: "2.2vw", height: "0.3vh", background: "#FF6F00", borderRadius: "2px" }} />
    <span style={{ fontSize: "0.75vw", fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: "#FF6F00", fontVariant: "small-caps", opacity: 0.85 }}>
      Startup Singam 2026
    </span>
  </div>
);

export default function Slide9() {
  const risks = [
    {
      risk: "Platform Competition",
      description: "Vapi, Retell, or a large cloud provider adds memory to their voice stack.",
      mitigation: "Our moat is the memory architecture and Indian-market specificity — not the voice pipeline itself. Data network effects (caller histories) grow with every call and can't be replicated overnight. We are also building the Memory Proxy so other platforms depend on us.",
      icon: (
        <svg width="1.6vw" height="1.6vw" viewBox="0 0 24 24" fill="none" stroke="#FF6F00" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 20V10" /><path d="M12 20V4" /><path d="M6 20v-6" />
        </svg>
      ),
    },
    {
      risk: "Regulatory Tightening",
      description: "TRAI or DPDP rules tighten further, restricting AI outbound calls.",
      mitigation: "Compliance is built into the core — we track every regulation update and ship guardrails as platform updates. Stricter regulation is actually a competitive advantage: it raises the bar for self-hosted or unregulated competitors and makes our managed compliance a required feature.",
      icon: (
        <svg width="1.6vw" height="1.6vw" viewBox="0 0 24 24" fill="none" stroke="#FF6F00" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
        </svg>
      ),
    },
    {
      risk: "Dialect Latency",
      description: "Model quality for regional languages degrades or latency spikes in production.",
      mitigation: "Provider-agnostic architecture means we swap engines without downtime. We run Deepgram, Sarvam, and Azure STT in parallel and route to the best performer per call. Continuous in-production latency monitoring alerts us before customers notice.",
      icon: (
        <svg width="1.6vw" height="1.6vw" viewBox="0 0 24 24" fill="none" stroke="#FF6F00" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
        </svg>
      ),
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
          <div style={{ fontSize: "0.75vw", fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: "#FF6F00", marginBottom: "0.8vh" }}>Key Risks &amp; Mitigation</div>
          <h1 style={{ fontFamily: "var(--font-display-family)", fontSize: "2.6vw", fontWeight: 700, color: "#FFFFFF", margin: 0, lineHeight: 1.15 }}>
            We've thought through the risks
          </h1>
        </div>
        <span style={{ fontSize: "0.85vw", fontWeight: 600, color: "#4B6CB7", letterSpacing: "0.06em", paddingBottom: "0.3vh" }}>09 / 14</span>
      </div>

      <div style={{ flex: 1, padding: "2.8vh 6vw 6.5vh 6vw", display: "flex", flexDirection: "column", gap: "2vh" }}>
        {risks.map(({ risk, description, mitigation, icon }) => (
          <div
            key={risk}
            style={{
              flex: 1, display: "flex", gap: "2.4vw", alignItems: "stretch",
              background: "#FFFFFF", border: "0.06vh solid #E8EAF0",
              borderRadius: "1.1vw", overflow: "hidden",
              boxShadow: "0 0.6vh 1.8vh rgba(26,35,126,0.08)",
            }}
          >
            <div style={{
              width: "28vw", background: "#FFF8F0", borderRight: "0.06vh solid #FFCC80",
              padding: "2.2vh 2vw", display: "flex", flexDirection: "column", justifyContent: "center", gap: "0.8vh",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.8vw" }}>
                <div style={{
                  width: "2.6vw", height: "2.6vw", borderRadius: "50%", background: "#FFF3E0",
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                }}>
                  {icon}
                </div>
                <div style={{ fontSize: "1.2vw", fontWeight: 700, color: "#BF360C" }}>{risk}</div>
              </div>
              <div style={{ fontSize: "1.02vw", color: "#8D4000", lineHeight: 1.58, paddingLeft: "3.4vw" }}>{description}</div>
            </div>
            <div style={{ flex: 1, padding: "2.2vh 2vw", display: "flex", flexDirection: "column", justifyContent: "center" }}>
              <div style={{ fontSize: "0.75vw", fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: "#1A237E", marginBottom: "0.8vh" }}>
                Mitigation
              </div>
              <div style={{ fontSize: "1.05vw", color: "#3A3A5C", lineHeight: 1.62 }}>{mitigation}</div>
            </div>
          </div>
        ))}
      </div>

      <VBWatermark />
    </div>
  );
}
