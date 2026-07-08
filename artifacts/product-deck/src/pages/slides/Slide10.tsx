const VBWatermark = () => (
  <div style={{ position: "absolute", bottom: "2.8vh", left: "3vw", display: "flex", alignItems: "center", gap: "0.7vw" }}>
    <div style={{ width: "2.2vw", height: "0.3vh", background: "#FF6F00", borderRadius: "2px" }} />
    <span style={{ fontSize: "0.75vw", fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: "#FF6F00", fontVariant: "small-caps", opacity: 0.85 }}>
      Vande Bharatam
    </span>
  </div>
);

export default function Slide10() {
  const th: React.CSSProperties = {
    padding: "1.4vh 1.6vw", fontSize: "0.85vw", fontWeight: 700,
    letterSpacing: "0.06em", textTransform: "uppercase",
    borderBottom: "0.14vh solid #E8EAF0", color: "#1A237E",
  };
  const td: React.CSSProperties = {
    padding: "1.4vh 1.6vw", fontSize: "1.05vw", color: "#3A3A5C",
    borderBottom: "0.06vh solid #F0F3FF",
  };
  const tdC: React.CSSProperties = { ...td, textAlign: "center" };

  const Check = () => <span style={{ color: "#1A237E", fontWeight: 800, fontSize: "1.2vw" }}>✓</span>;
  const Cross = () => <span style={{ color: "#BDBDBD", fontWeight: 700, fontSize: "1.1vw" }}>✗</span>;
  const Part = () => <span style={{ color: "#FF6F00", fontWeight: 600, fontSize: "0.95vw" }}>Partial</span>;

  const features = [
    { feature: "Zero-code agent builder", snap: <Check />, vapi: <Cross />, status: <Cross /> },
    { feature: "Persistent cross-call memory", snap: <Check />, vapi: <Cross />, status: <Cross /> },
    { feature: "Dropped-call resume with context", snap: <Check />, vapi: <Cross />, status: <Cross /> },
    { feature: "Tamil / Hinglish native handling", snap: <Check />, vapi: <Part />, status: <Cross /> },
    { feature: "IRDAI / TRAI / DPDP built-in", snap: <Check />, vapi: <Cross />, status: <Cross /> },
    { feature: "Provider-agnostic STT / LLM / TTS", snap: <Check />, vapi: <Part />, status: <Cross /> },
  ];

  return (
    <div
      className="w-screen h-screen overflow-hidden relative"
      style={{ background: "#FAFAFA", fontFamily: "var(--font-body-family)", display: "flex", flexDirection: "column" }}
    >
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "0.55vh", background: "#FF6F00" }} />
      <div style={{ background: "#1A237E", padding: "3.2vh 6vw 2.8vh 6vw", display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: "0.75vw", fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: "#FF6F00", marginBottom: "0.8vh" }}>Competition &amp; Your Advantage</div>
          <h1 style={{ fontFamily: "var(--font-display-family)", fontSize: "2.6vw", fontWeight: 700, color: "#FFFFFF", margin: 0, lineHeight: 1.15 }}>
            Where SnapServe wins
          </h1>
        </div>
        <span style={{ fontSize: "0.85vw", fontWeight: 600, color: "#4B6CB7", letterSpacing: "0.06em", paddingBottom: "0.3vh" }}>10 / 14</span>
      </div>

      <div style={{ flex: 1, padding: "2.4vh 6vw 6.5vh 6vw", display: "flex", flexDirection: "column", gap: "2vh" }}>
        <div style={{
          background: "#FFFFFF", border: "0.06vh solid #E8EAF0", borderRadius: "1.1vw",
          boxShadow: "0 0.8vh 2.2vh rgba(26,35,126,0.08)", overflow: "hidden",
        }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#F0F3FF" }}>
                <th style={{ ...th, textAlign: "left" }}>Feature</th>
                <th style={{ ...th, textAlign: "center", color: "#FF6F00" }}>SnapServe</th>
                <th style={{ ...th, textAlign: "center" }}>Vapi · Retell · Bolna</th>
                <th style={{ ...th, textAlign: "center" }}>Status Quo (Human)</th>
              </tr>
            </thead>
            <tbody>
              {features.map(({ feature, snap, vapi, status }, i) => (
                <tr key={feature} style={{ background: i % 2 === 0 ? "#FFFFFF" : "#FAFBFF" }}>
                  <td style={{ ...td, fontWeight: 600, color: "#1A237E" }}>{feature}</td>
                  <td style={tdC}>{snap}</td>
                  <td style={tdC}>{vapi}</td>
                  <td style={tdC}>{status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{
          background: "#1A237E", borderRadius: "1.1vw", padding: "2.4vh 2.6vw",
          display: "flex", gap: "2vw", alignItems: "flex-start",
        }}>
          <div style={{ flexShrink: 0 }}>
            <div style={{ fontSize: "0.78vw", fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#FF6F00", marginBottom: "0.6vh" }}>
              Your Advantage
            </div>
            <div style={{ fontSize: "1.32vw", fontWeight: 700, color: "#FFFFFF", lineHeight: 1.25, maxWidth: "20vw" }}>
              The Memory Layer Moat
            </div>
          </div>
          <div style={{ width: "0.06vw", background: "rgba(255,111,0,0.35)", alignSelf: "stretch" }} />
          <div style={{ fontSize: "1.08vw", color: "#C9D5F5", lineHeight: 1.65, flex: 1 }}>
            Every call enriches our caller knowledge graph. That data compound — competitors who copy our pipeline still start from zero caller history.
            The Memory Proxy also lets other platforms (Vapi, Bolna, Retell) route through SnapServe for memory, creating a distribution network inside our competitors' ecosystems.
            This is not a feature — it is a structural moat that grows with usage.
          </div>
        </div>
      </div>

      <VBWatermark />
    </div>
  );
}
