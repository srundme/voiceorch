const SSWatermark = () => (
  <div style={{ position: "absolute", bottom: "2.8vh", left: "3vw", display: "flex", alignItems: "center", gap: "0.7vw" }}>
    <div style={{ width: "2.2vw", height: "0.3vh", background: "#FF6F00", borderRadius: "2px" }} />
    <span style={{ fontSize: "0.75vw", fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: "#FF6F00", opacity: 0.85 }}>
      snapserve.ai
    </span>
  </div>
);

export default function Slide3() {
  const row: React.CSSProperties = {
    display: "flex", alignItems: "flex-start", gap: "2vw",
    background: "#FFFFFF", border: "0.06vh solid #E8EAF0", borderRadius: "1vw",
    padding: "2.2vh 2.4vw", boxShadow: "0 0.6vh 1.8vh rgba(26,35,126,0.07)",
  };

  return (
    <div
      className="w-screen h-screen overflow-hidden relative"
      style={{ background: "#FAFAFA", fontFamily: "var(--font-body-family)", display: "flex", flexDirection: "column" }}
    >
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "0.55vh", background: "#FF6F00" }} />
      <div style={{ background: "#1A237E", padding: "3.2vh 6vw 2.8vh 6vw", display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: "0.75vw", fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: "#FF6F00", marginBottom: "0.8vh" }}>The Problem</div>
          <h1 style={{ fontFamily: "var(--font-display-family)", fontSize: "2.6vw", fontWeight: 700, color: "#FFFFFF", margin: 0, lineHeight: 1.15 }}>
            Every call starts from scratch. That's costing billions.
          </h1>
        </div>
        <span style={{ fontSize: "0.85vw", fontWeight: 600, color: "#4B6CB7", letterSpacing: "0.06em", paddingBottom: "0.3vh" }}>03 / 14</span>
      </div>

      <div style={{ flex: 1, padding: "2.6vh 6vw 6.5vh 6vw", display: "flex", flexDirection: "column", gap: "1.8vh" }}>
        <div style={{
          background: "#1A237E", borderRadius: "1vw", padding: "2.2vh 2.4vw",
          display: "flex", alignItems: "center", gap: "2vw",
        }}>
          <div style={{ fontSize: "0.78vw", fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: "#FF6F00", whiteSpace: "nowrap" }}>
            KEY STAT
          </div>
          <div style={{ width: "0.06vw", height: "3.6vh", background: "rgba(255,111,0,0.4)" }} />
          <div style={{ fontSize: "1.12vw", color: "#FFFFFF", lineHeight: 1.5 }}>
            India's BPM industry exceeds <strong style={{ color: "#FF6F00" }}>$40B</strong> (NASSCOM) — yet every AI call today treats the customer as a stranger, every single time.
          </div>
        </div>

        <div style={row}>
          <div style={{
            minWidth: "3vw", width: "3vw", height: "3vw", borderRadius: "50%",
            background: "#1A237E", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <span style={{ color: "#FF6F00", fontWeight: 800, fontSize: "1.15vw" }}>01</span>
          </div>
          <div>
            <div style={{ fontSize: "1.28vw", fontWeight: 700, color: "#1A237E", marginBottom: "0.8vh" }}>AI tools don't understand India</div>
            <div style={{ fontSize: "1.05vw", color: "#3A3A5C", lineHeight: 1.6 }}>
              US-hosted voice AI fails on Indian accents, can't switch between Tamil and English mid-sentence, and has zero understanding of TRAI, DPDP, or IRDAI requirements. The compliance gap alone is a liability.
            </div>
          </div>
        </div>

        <div style={row}>
          <div style={{
            minWidth: "3vw", width: "3vw", height: "3vw", borderRadius: "50%",
            background: "#1A237E", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <span style={{ color: "#FF6F00", fontWeight: 800, fontSize: "1.15vw" }}>02</span>
          </div>
          <div>
            <div style={{ fontSize: "1.28vw", fontWeight: 700, color: "#1A237E", marginBottom: "0.8vh" }}>Human agents are stateless and expensive</div>
            <div style={{ fontSize: "1.05vw", color: "#3A3A5C", lineHeight: 1.6 }}>
              Insurance renewals, collections, and verification teams run thousands of calls daily — re-briefing agents every call, losing context on every drop, and paying ₹8–₹15/min per agent with supervisor overhead.
            </div>
          </div>
        </div>

        <div style={row}>
          <div style={{
            minWidth: "3vw", width: "3vw", height: "3vw", borderRadius: "50%",
            background: "#FF6F00", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <span style={{ color: "#FFFFFF", fontWeight: 800, fontSize: "1.15vw" }}>03</span>
          </div>
          <div>
            <div style={{ fontSize: "1.28vw", fontWeight: 700, color: "#1A237E", marginBottom: "0.8vh" }}>Memory loss = revenue loss</div>
            <div style={{ fontSize: "1.05vw", color: "#3A3A5C", lineHeight: 1.6 }}>
              A caller who said "I'll pay Friday" three calls ago gets asked for their name again today. Every dropped call that isn't resumed is a lost renewal. The compounding cost of context amnesia is invisible — until you measure it.
            </div>
          </div>
        </div>
      </div>

      <SSWatermark />
    </div>
  );
}
