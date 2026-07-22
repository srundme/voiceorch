const SSWatermark = () => (
  <div style={{ position: "absolute", bottom: "2.8vh", left: "3vw", display: "flex", alignItems: "center", gap: "0.7vw" }}>
    <div style={{ width: "2.2vw", height: "0.3vh", background: "#FF6F00", borderRadius: "2px" }} />
    <span style={{ fontSize: "0.75vw", fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: "#FF6F00", opacity: 0.85 }}>
      snapserve.ai
    </span>
  </div>
);

export default function Slide4() {
  const block: React.CSSProperties = {
    flex: 1, background: "#FFFFFF", border: "0.06vh solid #E8EAF0",
    borderRadius: "1.1vw", padding: "1.8vh 1.6vw",
    boxShadow: "0 0.8vh 2vh rgba(26,35,126,0.09)", display: "flex", flexDirection: "column",
  };

  const features = [
    {
      color: "#EEF0FB", iconColor: "#1A237E",
      title: "Persistent Cross-Call Memory",
      body: "Caller name, commitments, past issues — remembered forever. 'I'll pay Friday' is still known on the Monday call three weeks later.",
      icon: (
        <svg width="1.3vw" height="1.3vw" viewBox="0 0 24 24" fill="none" stroke="#1A237E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08A3 3 0 0 1 3 13.5a3 3 0 0 1 .34-5.62A2.5 2.5 0 0 1 6 4a2.5 2.5 0 0 1 3.5-2Z" />
          <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08A3 3 0 0 0 21 13.5a3 3 0 0 0-.34-5.62A2.5 2.5 0 0 0 18 4a2.5 2.5 0 0 0-3.5-2Z" />
        </svg>
      ),
    },
    {
      color: "#FFF3E0", iconColor: "#FF6F00",
      title: "Contextual Auto-Redial",
      body: "Call drops mid-sentence? The agent dials back within seconds and resumes exactly where it left off — no re-introduction, no lost context.",
      icon: (
        <svg width="1.3vw" height="1.3vw" viewBox="0 0 24 24" fill="none" stroke="#FF6F00" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
        </svg>
      ),
    },
    {
      color: "#EEF0FB", iconColor: "#1A237E",
      title: "12+ Indian Languages, Natively",
      body: "Hindi · Tamil · Telugu · Kannada · Malayalam · Marathi · Bengali · Gujarati · Punjabi · Odia + more. Not translated — natively modelled.",
      icon: (
        <svg width="1.3vw" height="1.3vw" viewBox="0 0 24 24" fill="none" stroke="#1A237E" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
      ),
    },
    {
      color: "#F0FFF4", iconColor: "#2E7D32",
      title: "Indian Number Provisioning",
      body: "Get a real Indian mobile number in 2 steps via built-in KYC — no SIM card, no Twilio account, no US detour. The only India-first voice AI that does this natively.",
      icon: (
        <svg width="1.3vw" height="1.3vw" viewBox="0 0 24 24" fill="none" stroke="#2E7D32" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.41 2 2 0 0 1 3.6 1.21h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.8a16 16 0 0 0 6.29 6.29l.98-.9a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
        </svg>
      ),
    },
    {
      color: "#F3E5F5", iconColor: "#6A1B9A",
      title: "Memory-Backed Human Handoff",
      body: "When the AI transfers to a human agent, it pushes the caller's complete cross-call history, facts, and commitments — not just the current transcript. True empathy, not a cold transfer.",
      icon: (
        <svg width="1.3vw" height="1.3vw" viewBox="0 0 24 24" fill="none" stroke="#6A1B9A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
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
      <div style={{ background: "#1A237E", padding: "2.8vh 6vw 2.4vh 6vw", display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: "0.75vw", fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: "#FF6F00", marginBottom: "0.6vh" }}>The Solution</div>
          <h1 style={{ fontFamily: "var(--font-display-family)", fontSize: "2.4vw", fontWeight: 700, color: "#FFFFFF", margin: 0, lineHeight: 1.15 }}>
            Memory · Language · Compliance — in one platform.
          </h1>
        </div>
        <span style={{ fontSize: "0.85vw", fontWeight: 600, color: "#4B6CB7", letterSpacing: "0.06em", paddingBottom: "0.3vh" }}>04 / 16</span>
      </div>

      <div style={{ flex: 1, padding: "2vh 6vw 5.5vh 6vw", display: "flex", gap: "2vw" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "1.4vh" }}>
          <p style={{ fontSize: "1.05vw", color: "#3A3A5C", lineHeight: 1.6, margin: 0 }}>
            Describe your agent in plain language. SnapServe auto-configures STT, LLM, and TTS — and every caller is remembered across every call, forever.
          </p>

          <div style={{ display: "flex", gap: "1.4vw", flex: 1 }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "1.4vh" }}>
              {features.slice(0, 2).map(({ color, title, body, icon }) => (
                <div key={title} style={{ ...block }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.8vw", marginBottom: "0.9vh" }}>
                    <div style={{ width: "2.4vw", height: "2.4vw", borderRadius: "50%", background: color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      {icon}
                    </div>
                    <div style={{ fontSize: "1.1vw", fontWeight: 700, color: "#1A237E" }}>{title}</div>
                  </div>
                  <div style={{ fontSize: "0.98vw", color: "#5B5470", lineHeight: 1.55 }}>{body}</div>
                </div>
              ))}
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "1.4vh" }}>
              {features.slice(2).map(({ color, title, body, icon }) => (
                <div key={title} style={{ ...block, borderColor: title.includes("Indian Number") ? "#A5D6A7" : "#E8EAF0" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.8vw", marginBottom: "0.9vh" }}>
                    <div style={{ width: "2.4vw", height: "2.4vw", borderRadius: "50%", background: color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      {icon}
                    </div>
                    <div style={{ fontSize: "1.1vw", fontWeight: 700, color: "#1A237E" }}>{title}</div>
                  </div>
                  <div style={{ fontSize: "0.98vw", color: "#5B5470", lineHeight: 1.55 }}>{body}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ width: "22vw", display: "flex", flexDirection: "column", gap: "1.4vh" }}>
          <div style={{
            flex: 1, background: "linear-gradient(160deg, #0D1B4B 0%, #1A237E 100%)",
            borderRadius: "1.2vw",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            padding: "2.4vh 2vw", gap: "1.4vh",
          }}>
            <div style={{ fontSize: "2.8vw", fontWeight: 900, color: "#FF6F00", lineHeight: 1 }}>2–3×</div>
            <div style={{ fontSize: "1vw", fontWeight: 600, color: "#FFFFFF", textAlign: "center", lineHeight: 1.5 }}>
              cost advantage,<br />widening at scale
            </div>
            <div style={{ fontSize: "0.88vw", color: "#9FA8DA", textAlign: "center", lineHeight: 1.5 }}>
              ₹5/min AI vs.<br />₹8–₹15/min human agent
            </div>
          </div>
          <div style={{
            background: "#1A237E", borderRadius: "1vw", padding: "1.6vh 2vw",
            display: "flex", alignItems: "center", gap: "1.2vw",
          }}>
            <div style={{ width: "0.55vw", height: "0.55vw", borderRadius: "50%", background: "#4CAF50", flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: "0.78vw", fontWeight: 700, color: "#FF6F00", textTransform: "uppercase", letterSpacing: "0.14em" }}>Live Today</div>
              <div style={{ fontSize: "1.02vw", fontWeight: 600, color: "#FFFFFF", marginTop: "0.3vh" }}>Product Ready · Calls Running</div>
            </div>
          </div>
        </div>
      </div>

      <SSWatermark />
    </div>
  );
}
