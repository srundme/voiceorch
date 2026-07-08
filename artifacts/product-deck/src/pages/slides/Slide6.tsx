const VBWatermark = () => (
  <div style={{ position: "absolute", bottom: "2.8vh", left: "3vw", display: "flex", alignItems: "center", gap: "0.7vw" }}>
    <div style={{ width: "2.2vw", height: "0.3vh", background: "#FF6F00", borderRadius: "2px" }} />
    <span style={{ fontSize: "0.75vw", fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: "#FF6F00", fontVariant: "small-caps", opacity: 0.85 }}>
      Vande Bharatam
    </span>
  </div>
);

export default function Slide6() {
  const marketBlock: React.CSSProperties = {
    flex: 1, background: "#FFFFFF", border: "0.06vh solid #E8EAF0",
    borderRadius: "1.2vw", padding: "2.6vh 2vw",
    boxShadow: "0 0.8vh 2.2vh rgba(26,35,126,0.09)", display: "flex",
    flexDirection: "column", alignItems: "center", textAlign: "center",
  };

  return (
    <div
      className="w-screen h-screen overflow-hidden relative"
      style={{ background: "#FAFAFA", fontFamily: "var(--font-body-family)", display: "flex", flexDirection: "column" }}
    >
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "0.55vh", background: "#FF6F00" }} />
      <div style={{ background: "#1A237E", padding: "3.2vh 6vw 2.8vh 6vw", display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: "0.75vw", fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: "#FF6F00", marginBottom: "0.8vh" }}>Market Opportunity</div>
          <h1 style={{ fontFamily: "var(--font-display-family)", fontSize: "2.6vw", fontWeight: 700, color: "#FFFFFF", margin: 0, lineHeight: 1.15 }}>
            A large, underserved market — primed to move now
          </h1>
        </div>
        <span style={{ fontSize: "0.85vw", fontWeight: 600, color: "#4B6CB7", letterSpacing: "0.06em", paddingBottom: "0.3vh" }}>06 / 14</span>
      </div>

      <div style={{ flex: 1, padding: "2.6vh 6vw 6.5vh 6vw", display: "flex", flexDirection: "column", gap: "2.2vh" }}>
        <div style={{ display: "flex", gap: "2vw" }}>
          <div style={marketBlock}>
            <div style={{ fontSize: "0.75vw", fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#9FA8DA", marginBottom: "1vh" }}>TAM</div>
            <div style={{ fontFamily: "var(--font-display-family)", fontSize: "3.2vw", fontWeight: 800, color: "#1A237E" }}>$35.2B</div>
            <div style={{ fontSize: "0.98vw", color: "#5B5470", lineHeight: 1.5, marginTop: "1vh" }}>Global conversational AI + contact-centre automation market</div>
          </div>
          <div style={{ ...marketBlock, borderColor: "#C5CAE9", background: "#F0F3FF" }}>
            <div style={{ fontSize: "0.75vw", fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#7986CB", marginBottom: "1vh" }}>SAM</div>
            <div style={{ fontFamily: "var(--font-display-family)", fontSize: "3.2vw", fontWeight: 800, color: "#1A237E" }}>$957M</div>
            <div style={{ fontSize: "0.98vw", color: "#5B5470", lineHeight: 1.5, marginTop: "1vh" }}>India BPM + voice-AI segment (NASSCOM, 2024)</div>
          </div>
          <div style={{ ...marketBlock, background: "#1A237E", borderColor: "#1A237E" }}>
            <div style={{ fontSize: "0.75vw", fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#FF6F00", marginBottom: "1vh" }}>SOM — Beachhead</div>
            <div style={{ fontFamily: "var(--font-display-family)", fontSize: "3.2vw", fontWeight: 800, color: "#FFFFFF" }}>BFSI</div>
            <div style={{ fontSize: "0.98vw", color: "#C9D5F5", lineHeight: 1.5, marginTop: "1vh" }}>Insurance renewals, collections, verification — highest call volume, most compliance-heavy</div>
          </div>
        </div>

        <div style={{
          background: "#FFFFFF", border: "0.06vh solid #E8EAF0", borderRadius: "1vw",
          padding: "2.2vh 2.4vw", boxShadow: "0 0.6vh 1.8vh rgba(26,35,126,0.07)", flex: 1,
        }}>
          <div style={{ fontSize: "0.78vw", fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#FF6F00", marginBottom: "1.6vh" }}>Why Now?</div>
          <div style={{ display: "flex", gap: "2.4vw" }}>
            {[
              { n: "01", title: "Smartphone penetration", body: "800M+ connected Indians ready for voice-first services — the mass market is here." },
              { n: "02", title: "Localized speech models", body: "India-first STT/LLM/TTS reached production quality and low cost in the last 18 months." },
              { n: "03", title: "DPDP / TRAI regulation", body: "Compliance is now a purchase driver, not an afterthought — built-in compliance wins deals." },
            ].map(({ n, title, body }) => (
              <div key={n} style={{ flex: 1 }}>
                <div style={{ fontSize: "1.3vw", fontWeight: 800, color: "#FF6F00", marginBottom: "0.6vh" }}>{n}</div>
                <div style={{ fontSize: "1.1vw", fontWeight: 700, color: "#1A237E", marginBottom: "0.8vh" }}>{title}</div>
                <div style={{ fontSize: "1.02vw", color: "#5B5470", lineHeight: 1.58 }}>{body}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{
          background: "#FFF3E0", border: "0.06vh solid #FFCC80", borderRadius: "1vw",
          padding: "1.8vh 2.4vw", fontSize: "1.05vw", color: "#BF360C", lineHeight: 1.55,
        }}>
          <strong>Early adopters:</strong> Mid-size insurers and NBFCs running 500–5,000 outbound calls/day — large enough to need automation, small enough to move fast without enterprise procurement cycles.
        </div>
      </div>

      <VBWatermark />
    </div>
  );
}
