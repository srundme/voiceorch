const SSWatermark = () => (
  <div style={{ position: "absolute", bottom: "2.8vh", left: "3vw", display: "flex", alignItems: "center", gap: "0.7vw" }}>
    <div style={{ width: "2.2vw", height: "0.3vh", background: "#FF6F00", borderRadius: "2px" }} />
    <span style={{ fontSize: "0.75vw", fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: "#FF6F00", opacity: 0.85 }}>
      snapserve.ai
    </span>
  </div>
);

export default function Slide7() {
  const col: React.CSSProperties = {
    flex: 1, background: "#FFFFFF", border: "0.06vh solid #E8EAF0",
    borderRadius: "1.2vw", padding: "2.8vh 2.2vw",
    boxShadow: "0 0.8vh 2.2vh rgba(26,35,126,0.09)", display: "flex", flexDirection: "column",
  };
  const label: React.CSSProperties = {
    fontSize: "0.75vw", fontWeight: 700, letterSpacing: "0.18em",
    textTransform: "uppercase", color: "#FF6F00", marginBottom: "1.2vh",
  };

  return (
    <div
      className="w-screen h-screen overflow-hidden relative"
      style={{ background: "#FAFAFA", fontFamily: "var(--font-body-family)", display: "flex", flexDirection: "column" }}
    >
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "0.55vh", background: "#FF6F00" }} />
      <div style={{ background: "#1A237E", padding: "3.2vh 6vw 2.8vh 6vw", display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: "0.75vw", fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: "#FF6F00", marginBottom: "0.8vh" }}>Business Model</div>
          <h1 style={{ fontFamily: "var(--font-display-family)", fontSize: "2.6vw", fontWeight: 700, color: "#FFFFFF", margin: 0, lineHeight: 1.15 }}>
            Simple per-minute pricing. Flexible at scale.
          </h1>
        </div>
        <span style={{ fontSize: "0.85vw", fontWeight: 600, color: "#4B6CB7", letterSpacing: "0.06em", paddingBottom: "0.3vh" }}>10 / 16</span>
      </div>

      <div style={{ flex: 1, padding: "2.6vh 6vw 6.5vh 6vw", display: "flex", flexDirection: "column", gap: "2vh" }}>
        <div style={{ display: "flex", gap: "2vw", flex: 1 }}>
          <div style={col}>
            <div style={label}>Who pays</div>
            <div style={{ fontSize: "1.28vw", fontWeight: 700, color: "#1A237E", marginBottom: "1.4vh" }}>BFSI · NBFCs · Enterprise</div>
            <div style={{ fontSize: "1.05vw", color: "#5B5470", lineHeight: 1.62 }}>
              Mid-size insurers, collections teams, and NBFCs running high-volume outbound calls daily — where compliance is non-negotiable and context amnesia costs real money.
            </div>
          </div>
          <div style={{ ...col, background: "#F0F3FF", borderColor: "#C5CAE9" }}>
            <div style={label}>How they pay</div>
            <div style={{ fontSize: "1.28vw", fontWeight: 700, color: "#1A237E", marginBottom: "1.4vh" }}>Per-minute + SaaS</div>
            <div style={{ fontSize: "1.05vw", color: "#5B5470", lineHeight: 1.62, display: "flex", flexDirection: "column", gap: "1.2vh" }}>
              <div style={{ padding: "1vh 0", borderBottom: "0.06vh solid #C5CAE9" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: "0.6vw" }}>
                  <strong style={{ color: "#1A237E" }}>Standard</strong>
                  <span style={{ fontFamily: "var(--font-display-family)", fontWeight: 800, fontSize: "1.3vw", color: "#FF6F00" }}>₹5/min</span>
                  <span style={{ fontSize: "0.88vw", color: "#9FA8DA" }}>all-in</span>
                </div>
                <div style={{ fontSize: "0.92vw", color: "#7986CB", marginTop: "0.3vh" }}>SnapServe supplies speech recognition, AI brain, voice, and telephony — nothing to set up.</div>
              </div>
              <div style={{ padding: "1vh 0", borderBottom: "0.06vh solid #C5CAE9" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: "0.6vw" }}>
                  <strong style={{ color: "#1A237E" }}>Self-serve plan</strong>
                  <span style={{ fontWeight: 600, fontSize: "1vw", color: "#5B5470" }}>— subscription only</span>
                </div>
                <div style={{ fontSize: "0.92vw", color: "#7986CB", marginTop: "0.3vh" }}>You bring your own AI keys, we handle the orchestration. Pricing flexible — talk to us.</div>
              </div>
              <div style={{ padding: "1vh 0" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: "0.6vw" }}>
                  <strong style={{ color: "#1A237E" }}>Enterprise</strong>
                  <span style={{ fontWeight: 600, fontSize: "1.05vw", color: "#1A237E" }}>Volume reduction from ₹5/min</span>
                </div>
                <div style={{ fontSize: "0.92vw", color: "#7986CB", marginTop: "0.3vh" }}>Custom SLA, dedicated support, Memory Proxy API access.</div>
              </div>
            </div>
          </div>
          <div style={{ ...col, background: "#1A237E", borderColor: "#1A237E" }}>
            <div style={{ ...label, color: "#FF6F00" }}>Revenue per customer</div>
            <div style={{ fontSize: "1.28vw", fontWeight: 700, color: "#FFFFFF", marginBottom: "1.4vh" }}>₹5L – ₹25L ARR</div>
            <div style={{ fontSize: "1.05vw", color: "#C9D5F5", lineHeight: 1.62 }}>
              10 clients at avg ₹10L/yr = ₹1 Cr ARR in Year 1. Enterprise accounts exceed ₹2L/month. Every new call enriches the memory — retention is structural.
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: "2vw" }}>
          <div style={{
            flex: 1, background: "#FFF3E0", border: "0.06vh solid #FFCC80",
            borderRadius: "1vw", padding: "2vh 2.4vw",
          }}>
            <div style={{ fontSize: "0.78vw", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: "#BF360C", marginBottom: "0.8vh" }}>
              Unit Economics
            </div>
            <div style={{ fontSize: "1.1vw", color: "#BF360C", lineHeight: 1.55 }}>
              <strong>2–3× cost advantage</strong> over human agents today — ₹5/min AI vs. ₹8–₹15/min human agent with supervision overhead. The gap widens at scale.
            </div>
          </div>
          <div style={{
            flex: 1, background: "#FFFFFF", border: "0.06vh solid #E8EAF0",
            borderRadius: "1vw", padding: "2vh 2.4vw",
            boxShadow: "0 0.6vh 1.6vh rgba(26,35,126,0.07)",
          }}>
            <div style={{ fontSize: "0.78vw", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.14em", color: "#FF6F00", marginBottom: "0.8vh" }}>
              Two Revenue Streams
            </div>
            <div style={{ display: "flex", gap: "1.4vw" }}>
              <div style={{ flex: 1, fontSize: "1.05vw", color: "#3A3A5C", lineHeight: 1.58 }}>
                <strong style={{ color: "#1A237E" }}>No-code SaaS</strong> — dashboard for non-technical business teams. Build, launch, and manage agents without a single engineer.
              </div>
              <div style={{ width: "0.06vw", background: "#E8EAF0" }} />
              <div style={{ flex: 1, fontSize: "1.05vw", color: "#3A3A5C", lineHeight: 1.58 }}>
                <strong style={{ color: "#1A237E" }}>Enterprise Memory API</strong> — memory-as-a-service for teams already on Vapi, Bolna, or Retell. Our distribution lives inside competitors' stacks.
              </div>
            </div>
          </div>
        </div>
      </div>

      <SSWatermark />
    </div>
  );
}
