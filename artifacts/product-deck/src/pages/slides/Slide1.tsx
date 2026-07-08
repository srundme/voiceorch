const VBWatermark = () => (
  <div style={{ position: "absolute", bottom: "2.8vh", left: "3vw", display: "flex", alignItems: "center", gap: "0.7vw" }}>
    <div style={{ width: "2.2vw", height: "0.3vh", background: "#FF6F00", borderRadius: "2px" }} />
    <span style={{ fontSize: "0.75vw", fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: "#FF6F00", fontVariant: "small-caps", opacity: 0.85 }}>
      Vande Bharatam
    </span>
  </div>
);

export default function Slide1() {
  return (
    <div
      className="w-screen h-screen overflow-hidden relative"
      style={{ background: "#0D1B4B", fontFamily: "var(--font-body-family)", color: "#FFFFFF" }}
    >
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "0.55vh", background: "#FF6F00" }} />

      <div style={{
        position: "absolute", top: 0, right: 0, width: "38vw", height: "100vh",
        background: "linear-gradient(135deg, #1A237E 0%, #0D1B4B 60%)",
        clipPath: "polygon(18% 0, 100% 0, 100% 100%, 0% 100%)",
      }} />

      <div style={{
        position: "absolute", top: 0, right: 0, width: "36vw", height: "100vh",
        background: "rgba(255,111,0,0.06)",
        clipPath: "polygon(20% 0, 100% 0, 100% 100%, 2% 100%)",
      }} />

      <div style={{
        position: "absolute", top: "6vh", left: "7vw", display: "flex", alignItems: "center", gap: "1vw",
      }}>
        <div style={{
          width: "3.6vw", height: "3.6vw", borderRadius: "50%",
          background: "rgba(255,111,0,0.18)", border: "0.1vw solid rgba(255,111,0,0.4)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="1.8vw" height="1.8vw" viewBox="0 0 100 100" fill="none">
            <rect x="6" y="14" width="88" height="20" rx="10" fill="#FFFFFF" />
            <rect x="14" y="42" width="72" height="20" rx="10" fill="#FFFFFF" opacity="0.65" />
            <rect x="22" y="70" width="56" height="20" rx="10" fill="#FFFFFF" opacity="0.38" />
          </svg>
        </div>
        <span style={{ fontSize: "1.3vw", fontWeight: 700, letterSpacing: "-0.01em" }}>SnapServe AI</span>
      </div>

      <div style={{
        position: "absolute", top: "7vh", right: "4vw",
        fontSize: "0.8vw", fontWeight: 600, letterSpacing: "0.18em",
        textTransform: "uppercase", color: "#FF6F00", opacity: 0.9,
      }}>
        Vande Bharatam — 2026
      </div>

      <div style={{
        position: "absolute", top: 0, left: "7vw", right: "40vw",
        height: "100vh", display: "flex", flexDirection: "column", justifyContent: "center",
      }}>
        <div style={{
          fontSize: "0.9vw", fontWeight: 700, letterSpacing: "0.2em",
          textTransform: "uppercase", color: "#FF6F00", marginBottom: "2.8vh",
        }}>
          AI Voice Agents · Made in India
        </div>

        <h1 style={{
          fontFamily: "var(--font-display-family)", fontSize: "5.8vw", fontWeight: 800,
          lineHeight: 1.06, margin: 0, color: "#FFFFFF",
        }}>
          SnapServe AI
        </h1>

        <div style={{
          width: "5vw", height: "0.4vh", background: "#FF6F00", borderRadius: "2px", margin: "2.4vh 0",
        }} />

        <p style={{
          fontSize: "1.7vw", fontWeight: 400, lineHeight: 1.5, color: "#C9D5F5",
          maxWidth: "48vw", margin: 0,
        }}>
          Build and deploy voice AI agents without writing a line of code.
        </p>

        <div style={{ marginTop: "4.5vh", display: "flex", flexDirection: "column", gap: "1.2vh" }}>
          <div style={{ fontSize: "1.05vw", fontWeight: 600, color: "#FFFFFF" }}>
            Karthikeyan&ensp;<span style={{ color: "#FF6F00" }}>|</span>&ensp;Founder &amp; CEO
          </div>
          <div style={{ fontSize: "1.05vw", fontWeight: 600, color: "#FFFFFF" }}>
            Gopi N.&ensp;<span style={{ color: "#FF6F00" }}>|</span>&ensp;Co-Founder &amp; COO
          </div>
        </div>
      </div>

      <div style={{
        position: "absolute", bottom: "2.8vh", right: "4vw",
        fontSize: "0.85vw", fontWeight: 500, color: "#4B6CB7", letterSpacing: "0.06em",
      }}>
        01 / 14
      </div>

      <VBWatermark />
    </div>
  );
}
