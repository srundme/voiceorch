const SSWatermark = () => (
  <div style={{ position: "absolute", bottom: "2.8vh", left: "3vw", display: "flex", alignItems: "center", gap: "0.7vw" }}>
    <div style={{ width: "2.2vw", height: "0.3vh", background: "#FF6F00", borderRadius: "2px" }} />
    <span style={{ fontSize: "0.75vw", fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: "#FF6F00", opacity: 0.85 }}>
      snapserve.ai
    </span>
  </div>
);

export default function Slide15() {
  return (
    <div
      className="w-screen h-screen overflow-hidden relative"
      style={{ background: "#FAFAFA", fontFamily: "var(--font-body-family)", display: "flex", flexDirection: "column" }}
    >
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "0.55vh", background: "#FF6F00" }} />

      <div style={{ background: "#1A237E", padding: "3.2vh 6vw 2.8vh 6vw", display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "1.2vw", marginBottom: "0.8vh" }}>
            <div style={{ fontSize: "0.75vw", fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: "#FF6F00" }}>
              Live Today — Voice AI
            </div>
            <div style={{
              background: "#1B5E20", color: "#A5D6A7",
              fontSize: "0.7vw", fontWeight: 800, letterSpacing: "0.16em",
              textTransform: "uppercase", padding: "0.25vh 0.8vw", borderRadius: "99px",
            }}>
              LIVE
            </div>
          </div>
          <h1 style={{ fontFamily: "var(--font-display-family)", fontSize: "2.6vw", fontWeight: 700, color: "#FFFFFF", margin: 0, lineHeight: 1.15 }}>
            The agent that sees, hears, and remembers — without leaving the page.
          </h1>
        </div>
        <span style={{ fontSize: "0.85vw", fontWeight: 600, color: "#4B6CB7", letterSpacing: "0.06em", paddingBottom: "0.3vh" }}>06 / 16</span>
      </div>

      <div style={{ flex: 1, padding: "2.4vh 6vw 6.5vh 6vw", display: "flex", gap: "2vw" }}>

        {/* Left — What it enables */}
        <div style={{ flex: 1.1, display: "flex", flexDirection: "column", gap: "1.6vh" }}>
          <div style={{ fontSize: "0.78vw", fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#FF6F00" }}>
            What it enables
          </div>
          {[
            {
              icon: (
                <svg width="1.4vw" height="1.4vw" viewBox="0 0 24 24" fill="none" stroke="#FF6F00" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>
                </svg>
              ),
              title: "Live KYC — no app switch",
              body: "The agent speaks to the customer and screens the document simultaneously. Identity verified. Compliance logged. User never redirected.",
            },
            {
              icon: (
                <svg width="1.4vw" height="1.4vw" viewBox="0 0 24 24" fill="none" stroke="#FF6F00" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8M12 17v4"/>
                </svg>
              ),
              title: "Visual guided support",
              body: "Agent sees what the customer is looking at on-screen. Guides them step-by-step through forms, documents, or app workflows while speaking.",
            },
            {
              icon: (
                <svg width="1.4vw" height="1.4vw" viewBox="0 0 24 24" fill="none" stroke="#FF6F00" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/>
                </svg>
              ),
              title: "Embedded — no native app required",
              body: "Drop a single JS snippet into any web or mobile app. No SDK, no platform dependency, no user download. Works in any browser, any framework.",
            },
          ].map(({ icon, title, body }) => (
            <div key={title} style={{
              background: "#FFFFFF", border: "0.06vh solid #E8EAF0",
              borderRadius: "1vw", padding: "1.8vh 1.8vw",
              boxShadow: "0 0.5vh 1.5vh rgba(26,35,126,0.07)",
              display: "flex", gap: "1.2vw", alignItems: "flex-start",
            }}>
              <div style={{
                width: "2.6vw", height: "2.6vw", borderRadius: "50%",
                background: "#FFF3E0", display: "flex", alignItems: "center",
                justifyContent: "center", flexShrink: 0, marginTop: "0.2vh",
              }}>
                {icon}
              </div>
              <div>
                <div style={{ fontSize: "1.08vw", fontWeight: 700, color: "#1A237E", marginBottom: "0.5vh" }}>{title}</div>
                <div style={{ fontSize: "0.98vw", color: "#5B5470", lineHeight: 1.58 }}>{body}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Center — Flow diagram */}
        <div style={{ width: "22vw", display: "flex", flexDirection: "column", gap: "1.6vh" }}>
          <div style={{ fontSize: "0.78vw", fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#FF6F00" }}>
            How the session works
          </div>
          <div style={{ flex: 1, background: "#1A237E", borderRadius: "1.2vw", padding: "2.4vh 2vw", display: "flex", flexDirection: "column", gap: "0" }}>
            {[
              { step: "01", label: "Customer opens your app", sub: "No redirect. No download." },
              { step: "02", label: "Agent joins: voice + camera feed", sub: "Sees the screen in real time" },
              { step: "03", label: "Identity confirmed", sub: "Compliance logged automatically" },
              { step: "04", label: "KYC approved — agent continues the conversation", sub: "Memory layer updated instantly" },
            ].map(({ step, label, sub }, i) => (
              <div key={step} style={{ display: "flex", flexDirection: "column", position: "relative" }}>
                <div style={{ display: "flex", gap: "1.2vw", alignItems: "flex-start", paddingBottom: i < 3 ? "2.2vh" : "0" }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <div style={{
                      width: "2.2vw", height: "2.2vw", borderRadius: "50%",
                      background: i === 0 ? "#FF6F00" : "rgba(255,111,0,0.18)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      flexShrink: 0,
                    }}>
                      <span style={{ fontSize: "0.78vw", fontWeight: 800, color: i === 0 ? "#FFFFFF" : "#FF6F00" }}>{step}</span>
                    </div>
                    {i < 3 && <div style={{ width: "0.06vw", flex: 1, background: "rgba(255,111,0,0.25)", minHeight: "1.8vh", marginTop: "0.4vh" }} />}
                  </div>
                  <div style={{ paddingTop: "0.2vh" }}>
                    <div style={{ fontSize: "1.02vw", fontWeight: 700, color: "#FFFFFF", lineHeight: 1.3 }}>{label}</div>
                    <div style={{ fontSize: "0.88vw", color: "#9FA8DA", marginTop: "0.3vh" }}>{sub}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right — Differentiation */}
        <div style={{ flex: 0.95, display: "flex", flexDirection: "column", gap: "1.6vh" }}>
          <div style={{ fontSize: "0.78vw", fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", color: "#FF6F00" }}>
            Why no one else does this
          </div>

          <div style={{
            background: "#FFFFFF", border: "0.06vh solid #E8EAF0",
            borderRadius: "1vw", padding: "2vh 1.8vw",
            boxShadow: "0 0.5vh 1.5vh rgba(26,35,126,0.07)", flex: 1,
            display: "flex", flexDirection: "column", gap: "1.4vh",
          }}>
            {[
              { label: "Vapi / Retell", detail: "Voice only. No visual layer. KYC requires a separate app or human handoff." },
              { label: "Traditional KYC SDKs", detail: "Document scanning with no conversational intelligence. Rigid flows, no memory." },
              { label: "Human agents", detail: "Expensive, inconsistent, can't run at 3AM. Can't log a verifiable audit trail automatically." },
            ].map(({ label, detail }) => (
              <div key={label} style={{ display: "flex", gap: "1vw", alignItems: "flex-start" }}>
                <span style={{ color: "#BDBDBD", fontWeight: 700, fontSize: "1.2vw", flexShrink: 0, marginTop: "0.1vh" }}>✗</span>
                <div>
                  <div style={{ fontSize: "1.02vw", fontWeight: 700, color: "#1A237E" }}>{label}</div>
                  <div style={{ fontSize: "0.94vw", color: "#5B5470", lineHeight: 1.52 }}>{detail}</div>
                </div>
              </div>
            ))}
            <div style={{ height: "0.06vh", background: "#E8EAF0" }} />
            <div style={{ display: "flex", gap: "1vw", alignItems: "flex-start" }}>
              <span style={{ color: "#FF6F00", fontWeight: 800, fontSize: "1.2vw", flexShrink: 0, marginTop: "0.1vh" }}>✓</span>
              <div>
                <div style={{ fontSize: "1.02vw", fontWeight: 700, color: "#FF6F00" }}>SnapServe Voice AI</div>
                <div style={{ fontSize: "0.94vw", color: "#5B5470", lineHeight: 1.52 }}>
                  Live today. One embedded agent that speaks, sees, verifies, and remembers — compliant by default, no human required, no app download.
                </div>
              </div>
            </div>
          </div>

          <div style={{
            background: "#FFF3E0", border: "0.06vh solid #FFCC80",
            borderRadius: "1vw", padding: "1.6vh 1.8vw",
          }}>
            <div style={{ fontSize: "0.98vw", color: "#BF360C", lineHeight: 1.55 }}>
              <strong>First target:</strong> Indian insurers running manual KYC calls — 40M+ verifications per year, ₹150+ per manual call. SnapServe cuts that to ₹8. <strong>Live in production — insurance pilots running now.</strong>
            </div>
          </div>
        </div>
      </div>


    </div>
  );
}
