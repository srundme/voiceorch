export default function Slide6() {
  return (
    <div className="w-screen h-screen overflow-hidden relative" style={{ width: "100vw", height: "100vh", overflow: "hidden", backgroundColor: "#FFFFFF", fontFamily: "'Inter', sans-serif", color: "#1C1C1C", position: "relative", display: "flex", flexDirection: "column", padding: "7vh 8vw 5vh 8vw", boxSizing: "border-box" }}>
      <div style={{ width: "84vw", height: "0.2vh", backgroundColor: "#1C1C1C", position: "absolute", top: "7vh", left: "8vw" }} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: "2vh", zIndex: 1 }}>
        <div style={{ fontSize: "0.95vw", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: "'DM Mono', monospace" }}>snapserve.ai</div>
        <div style={{ fontSize: "0.9vw", fontWeight: 400, color: "#888888", fontFamily: "'DM Mono', monospace" }}>05 — Who It's For</div>
      </div>
      <div style={{ position: "absolute", top: "28vh", right: "4vw", fontSize: "22vw", fontWeight: 700, color: "#F5F5F5", lineHeight: 1, zIndex: 0, userSelect: "none", letterSpacing: "-0.06em" }}>06</div>
      <div style={{ flexGrow: 1, display: "flex", flexDirection: "column", justifyContent: "flex-start", zIndex: 1, position: "relative", marginTop: "5vh" }}>
        <h2 style={{ fontSize: "3.4vw", fontWeight: 700, margin: "0 0 1.5vh 0", lineHeight: 1.1, letterSpacing: "-0.025em", maxWidth: "70vw" }}>Built for any business that lives on the phone.</h2>
        <p style={{ fontSize: "1.2vw", color: "#4A4A4A", maxWidth: "62vw", lineHeight: 1.6, marginBottom: "4vh" }}>The highest-value deployments cluster in four verticals where call volume is large, repetitive, and revenue-critical — every one of them multilingual, high-concurrency, and powered by returning callers.</p>
        <div style={{ display: "flex", gap: "1.5vw", marginBottom: "3.5vh", alignItems: "stretch" }}>
          <div style={{ flex: 1, borderTop: "0.3vh solid #1C1C1C", paddingTop: "1.5vh" }}>
            <div style={{ fontSize: "0.75vw", color: "#999999", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", marginBottom: "1vh" }}>01 · BFSI &amp; Lending</div>
            <div style={{ fontSize: "1.15vw", fontWeight: 600, marginBottom: "0.5vh" }}>Collections &amp; servicing</div>
            <div style={{ fontSize: "0.95vw", color: "#4A4A4A", lineHeight: 1.5 }}>EMI and payment reminders, KYC verification, balance and policy queries — multilingual outbound at scale without expanding the call floor.</div>
          </div>
          <div style={{ flex: 1, borderTop: "0.3vh solid #1C1C1C", paddingTop: "1.5vh" }}>
            <div style={{ fontSize: "0.75vw", color: "#999999", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", marginBottom: "1vh" }}>02 · Logistics &amp; Delivery</div>
            <div style={{ fontSize: "1.15vw", fontWeight: 600, marginBottom: "0.5vh" }}>Confirm &amp; reschedule</div>
            <div style={{ fontSize: "0.95vw", color: "#4A4A4A", lineHeight: 1.5 }}>Delivery confirmation, address correction, failed-delivery reattempts, COD verification — thousands of concurrent calls per route.</div>
          </div>
          <div style={{ flex: 1, borderTop: "0.3vh solid #1C1C1C", paddingTop: "1.5vh" }}>
            <div style={{ fontSize: "0.75vw", color: "#999999", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", marginBottom: "1vh" }}>03 · Healthcare &amp; Clinics</div>
            <div style={{ fontSize: "1.15vw", fontWeight: 600, marginBottom: "0.5vh" }}>Book &amp; remind</div>
            <div style={{ fontSize: "0.95vw", color: "#4A4A4A", lineHeight: 1.5 }}>Appointment booking and reminders, report-ready alerts, refill follow-ups. Caller memory means returning patients never repeat themselves.</div>
          </div>
          <div style={{ flex: 1, borderTop: "0.3vh solid #1C1C1C", paddingTop: "1.5vh" }}>
            <div style={{ fontSize: "0.75vw", color: "#999999", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", marginBottom: "1vh" }}>04 · E-commerce &amp; Services</div>
            <div style={{ fontSize: "1.15vw", fontWeight: 600, marginBottom: "0.5vh" }}>Support &amp; win-back</div>
            <div style={{ fontSize: "0.95vw", color: "#4A4A4A", lineHeight: 1.5 }}>Order status, returns and refunds, abandoned-cart recovery, lead qualification — 24/7 across 12 Indic languages.</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: "3vw", alignItems: "stretch", backgroundColor: "#FAFAFA", padding: "2.5vh 2.5vw", border: "0.1vh solid #E0E0E0" }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "0.75vw", color: "#888888", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "1vh" }}>Buyer 01 — Self-serve SMBs</div>
            <div style={{ fontSize: "1.05vw", color: "#4A4A4A", lineHeight: 1.5 }}>Managed plan. A phone number and a system prompt — live in 48 hours, no engineering and no provider contracts to negotiate.</div>
          </div>
          <div style={{ width: "0.1vw", backgroundColor: "#E0E0E0" }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "0.75vw", color: "#888888", fontFamily: "'DM Mono', monospace", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "1vh" }}>Buyer 02 — Enterprises &amp; BFSI</div>
            <div style={{ fontSize: "1.05vw", color: "#4A4A4A", lineHeight: 1.5 }}>BYOP plan. Bring existing provider keys and high call volume; SnapServe runs the orchestration layer at a pure-margin rate.</div>
          </div>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", borderTop: "0.1vh solid #E0E0E0", paddingTop: "2.5vh", marginTop: "auto", fontFamily: "'DM Mono', monospace", fontSize: "0.85vw", color: "#4A4A4A", zIndex: 1 }}>
        <div style={{ display: "flex", gap: "5vw" }}>
          <div>
            <div style={{ color: "#999999", marginBottom: "0.4vh", textTransform: "uppercase", fontSize: "0.65vw" }}>Date</div>
            <div>June 2026</div>
          </div>
          <div>
            <div style={{ color: "#999999", marginBottom: "0.4vh", textTransform: "uppercase", fontSize: "0.65vw" }}>Prepared By</div>
            <div>SnapServe</div>
          </div>
          <div>
            <div style={{ color: "#999999", marginBottom: "0.4vh", textTransform: "uppercase", fontSize: "0.65vw" }}>Status</div>
            <div>Live</div>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: "#999999", marginBottom: "0.4vh", textTransform: "uppercase", fontSize: "0.65vw" }}>Page</div>
          <div style={{ fontWeight: 600, color: "#1C1C1C" }}>06 / 11</div>
        </div>
      </div>
    </div>
  );
}
