const SSWatermark = () => (
  <div style={{ position: "absolute", bottom: "2.8vh", left: "3vw", display: "flex", alignItems: "center", gap: "0.7vw" }}>
    <div style={{ width: "2.2vw", height: "0.3vh", background: "#FF6F00", borderRadius: "2px" }} />
    <span style={{ fontSize: "0.75vw", fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: "#FF6F00", opacity: 0.85 }}>
      snapserve.ai
    </span>
  </div>
);

export default function Slide11() {
  const years = [
    { label: "Year 1", milestone: "1,000+ active users & reseller network established · ₹50L ARR" },
    { label: "Year 2", milestone: "50+ clients · Memory Proxy API live · ₹3 Cr ARR" },
    { label: "Year 3", milestone: "UAE & Southeast Asia expansion · ₹10 Cr ARR" },
  ];

  return (
    <div
      className="w-screen h-screen overflow-hidden relative"
      style={{ background: "#FAFAFA", fontFamily: "var(--font-body-family)", display: "flex", flexDirection: "column" }}
    >
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "0.55vh", background: "#FF6F00" }} />
      <div style={{ background: "#1A237E", padding: "3.2vh 6vw 2.8vh 6vw", display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: "0.75vw", fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: "#FF6F00", marginBottom: "0.8vh" }}>Financials &amp; The Ask</div>
          <h1 style={{ fontFamily: "var(--font-display-family)", fontSize: "2.6vw", fontWeight: 700, color: "#FFFFFF", margin: 0, lineHeight: 1.15 }}>
            Raising ₹3 Crore — Pre-Seed
          </h1>
        </div>
        <span style={{ fontSize: "0.85vw", fontWeight: 600, color: "#4B6CB7", letterSpacing: "0.06em", paddingBottom: "0.3vh" }}>13 / 16</span>
      </div>

      <div style={{ flex: 1, padding: "2.6vh 6vw 6.5vh 6vw", display: "flex", gap: "2.4vw" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "2vh" }}>
          <div style={{
            background: "#FFFFFF", border: "0.06vh solid #E8EAF0", borderRadius: "1.2vw",
            padding: "2.6vh 2.4vw", boxShadow: "0 0.8vh 2.2vh rgba(26,35,126,0.09)",
          }}>
            <div style={{ fontSize: "0.78vw", fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#FF6F00", marginBottom: "1.6vh" }}>
              Use of Funds
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "1.2vh" }}>
              {[
                { pct: "45%", label: "Technology & Infrastructure", w: "45%", color: "#1A237E" },
                { pct: "30%", label: "GTM & Sales", w: "30%", color: "#FF6F00" },
                { pct: "15%", label: "Team", w: "15%", color: "#3949AB" },
                { pct: "10%", label: "Operations & Legal", w: "10%", color: "#7986CB" },
              ].map(({ pct, label, w, color }) => (
                <div key={label}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.4vh" }}>
                    <span style={{ fontSize: "1.02vw", color: "#3A3A5C" }}>{label}</span>
                    <span style={{ fontSize: "1.02vw", fontWeight: 700, color }}>{pct}</span>
                  </div>
                  <div style={{ height: "0.9vh", background: "#EEF0FB", borderRadius: "0.5vw", overflow: "hidden" }}>
                    <div style={{ width: w, height: "100%", background: color, borderRadius: "0.5vw" }} />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{
            background: "#1A237E", borderRadius: "1.2vw", padding: "2.4vh 2.4vw",
            display: "flex", flexDirection: "column", gap: "1.4vh",
          }}>
            <div style={{ fontSize: "0.78vw", fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#FF6F00" }}>
              What We're Looking For
            </div>
            <div style={{ fontSize: "1.05vw", color: "#C9D5F5", lineHeight: 1.62 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: "0.7vw", marginBottom: "0.8vh" }}>
                <span style={{ color: "#FF6F00", flexShrink: 0, marginTop: "0.1vh" }}>→</span>
                <span>Strategic mentorship from India's B2B SaaS leaders to accelerate our Enterprise Proxy API go-to-market.</span>
              </div>
              <div style={{ display: "flex", alignItems: "flex-start", gap: "0.7vw", marginBottom: "0.8vh" }}>
                <span style={{ color: "#FF6F00", flexShrink: 0, marginTop: "0.1vh" }}>→</span>
                <span>Direct introductions to BFSI decision-makers — insurers, NBFCs, and collections teams running 500+ daily calls.</span>
              </div>
              <div style={{ display: "flex", alignItems: "flex-start", gap: "0.7vw" }}>
                <span style={{ color: "#FF6F00", flexShrink: 0, marginTop: "0.1vh" }}>→</span>
                <span>Investors who understand Indian enterprise GTM and can open doors to Zoho / Freshworks ecosystem channels.</span>
              </div>
            </div>
          </div>
        </div>

        <div style={{ width: "32vw", display: "flex", flexDirection: "column", gap: "1.8vh" }}>
          <div style={{
            background: "#FFFFFF", border: "0.06vh solid #E8EAF0", borderRadius: "1.2vw",
            padding: "2.6vh 2.4vw", boxShadow: "0 0.8vh 2.2vh rgba(26,35,126,0.09)", flex: 1,
          }}>
            <div style={{ fontSize: "0.78vw", fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#FF6F00", marginBottom: "1.6vh" }}>
              3-Year Snapshot
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "1.8vh" }}>
              {years.map(({ label, milestone }) => (
                <div key={label} style={{ display: "flex", gap: "1.4vw", alignItems: "flex-start" }}>
                  <div style={{
                    minWidth: "5.5vw", background: "#EEF0FB", borderRadius: "0.6vw",
                    padding: "0.5vh 0.8vw", textAlign: "center",
                  }}>
                    <div style={{ fontSize: "0.88vw", fontWeight: 700, color: "#1A237E" }}>{label}</div>
                  </div>
                  <div style={{ fontSize: "1.05vw", color: "#3A3A5C", lineHeight: 1.55 }}>{milestone}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{
            background: "#1A237E", borderRadius: "1.1vw", padding: "2.2vh 2.4vw",
          }}>
            <div style={{ fontSize: "0.78vw", fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: "#FF6F00", marginBottom: "0.8vh" }}>
              18-Month Milestones
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.9vh" }}>
              {[
                { q: "Q1–Q2", text: "1,000+ active users and 2+ paid enterprise clients onboarded" },
                { q: "Q3",    text: "Memory Proxy API in public beta" },
                { q: "Q4",    text: "₹50L ARR · Unit economics validated" },
                { q: "+18M",  text: "₹3 Cr ARR · Series A ready" },
              ].map(({ q, text }) => (
                <div key={q} style={{ display: "flex", alignItems: "center", gap: "1vw", fontSize: "1.02vw" }}>
                  <div style={{ minWidth: "4.5vw", background: "rgba(255,111,0,0.18)", borderRadius: "0.5vw", padding: "0.3vh 0.6vw", textAlign: "center", fontSize: "0.82vw", fontWeight: 700, color: "#FF6F00" }}>{q}</div>
                  <div style={{ color: "#C9D5F5", lineHeight: 1.4 }}>{text}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <SSWatermark />
    </div>
  );
}
