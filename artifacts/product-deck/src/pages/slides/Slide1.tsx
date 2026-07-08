export default function Slide1() {
  return (
    <div
      className="w-screen h-screen overflow-hidden relative"
      style={{
        background: "radial-gradient(120% 100% at 20% 0%, #38208A 0%, #2A1670 45%, #1F0F52 100%)",
        fontFamily: "var(--font-body-family)",
        color: "#FFFFFF",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: "-18vh",
          right: "-10vw",
          width: "48vw",
          height: "48vw",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(245,158,11,0.14) 0%, rgba(245,158,11,0) 70%)",
        }}
      />

      <div
        style={{
          position: "absolute",
          top: "6vh",
          left: "8vw",
          display: "flex",
          alignItems: "center",
          gap: "1.1vw",
        }}
      >
        <div
          style={{
            width: "4.2vw",
            height: "4.2vw",
            borderRadius: "50%",
            background: "rgba(255,255,255,0.10)",
            border: "0.08vw solid rgba(255,255,255,0.22)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg width="2.1vw" height="2.1vw" viewBox="0 0 100 100" fill="none">
            <rect x="6" y="14" width="88" height="20" rx="10" fill="#FFFFFF" opacity="1" />
            <rect x="14" y="42" width="72" height="20" rx="10" fill="#FFFFFF" opacity="0.6" />
            <rect x="22" y="70" width="56" height="20" rx="10" fill="#FFFFFF" opacity="0.36" />
          </svg>
        </div>
        <span style={{ fontSize: "1.4vw", fontWeight: 700, letterSpacing: "-0.01em" }}>SnapServe</span>
      </div>

      <div
        style={{
          position: "absolute",
          top: "7vh",
          right: "8vw",
          fontSize: "0.9vw",
          fontWeight: 500,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "#C7BCEA",
        }}
      >
        Antler Hub — Application 2026
      </div>

      <div
        style={{
          position: "absolute",
          top: "0",
          left: "8vw",
          right: "8vw",
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            fontSize: "0.95vw",
            fontWeight: 600,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "#F59E0B",
            marginBottom: "3vh",
          }}
        >
          AI Voice Agents
        </div>

        <h1
          style={{
            fontFamily: "var(--font-display-family)",
            fontSize: "5.4vw",
            fontWeight: 700,
            lineHeight: 1.08,
            margin: 0,
            maxWidth: "72vw",
            color: "#FFFFFF",
          }}
        >
          Build and deploy voice AI agents without writing a line of code.
        </h1>

        <p
          style={{
            fontSize: "1.85vw",
            fontWeight: 400,
            lineHeight: 1.5,
            color: "#DCD3F2",
            maxWidth: "56vw",
            marginTop: "3.5vh",
            marginBottom: 0,
          }}
        >
          No developers. No agency. Just describe your agent and go live.{" "}
          <span style={{ color: "#F59E0B", fontWeight: 600 }}>And it remembers every caller.</span>
        </p>
      </div>

      <div
        style={{
          position: "absolute",
          bottom: "6vh",
          left: "8vw",
          right: "8vw",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: "1vw",
          color: "#B7ABDD",
          borderTop: "0.06vh solid rgba(255,255,255,0.16)",
          paddingTop: "2.5vh",
        }}
      >
        <span>Karthikeyan &middot; Gopi</span>
        <span>Chennai, India</span>
        <span>Antler Hub Application 2026</span>
      </div>
    </div>
  );
}
