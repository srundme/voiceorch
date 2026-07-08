export default function Slide12() {
  return (
    <div
      className="w-screen h-screen overflow-hidden relative"
      style={{
        background: "radial-gradient(120% 100% at 80% 100%, #38208A 0%, #2A1670 45%, #1F0F52 100%)",
        fontFamily: "var(--font-body-family)",
        color: "#FFFFFF",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        textAlign: "center",
        padding: "0 8vw",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          position: "absolute",
          bottom: "-16vh",
          left: "-8vw",
          width: "44vw",
          height: "44vw",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(245,158,11,0.12) 0%, rgba(245,158,11,0) 70%)",
        }}
      />

      <div
        style={{
          width: "5.2vw",
          height: "5.2vw",
          borderRadius: "50%",
          background: "rgba(255,255,255,0.10)",
          border: "0.08vw solid rgba(255,255,255,0.22)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: "4vh",
        }}
      >
        <svg width="2.6vw" height="2.6vw" viewBox="0 0 100 100" fill="none">
          <rect x="6" y="14" width="88" height="20" rx="10" fill="#FFFFFF" opacity="1" />
          <rect x="14" y="42" width="72" height="20" rx="10" fill="#FFFFFF" opacity="0.6" />
          <rect x="22" y="70" width="56" height="20" rx="10" fill="#FFFFFF" opacity="0.36" />
        </svg>
      </div>

      <h1
        style={{
          fontFamily: "var(--font-display-family)",
          fontSize: "4.4vw",
          fontWeight: 700,
          lineHeight: 1.22,
          margin: 0,
          maxWidth: "62vw",
        }}
      >
        The voice AI wave is here.
        <br />
        <span style={{ color: "#F59E0B" }}>The winner in India will be the one that remembers — and anyone can build on.</span>
      </h1>

      <p
        style={{
          fontSize: "1.5vw",
          fontWeight: 400,
          lineHeight: 1.55,
          color: "#DCD3F2",
          maxWidth: "50vw",
          marginTop: "4vh",
          marginBottom: 0,
        }}
      >
        SnapServe — zero-code voice agents with persistent memory, built for India, live in production.
      </p>

      <div
        style={{
          position: "absolute",
          bottom: "6vh",
          fontSize: "1vw",
          color: "#B7ABDD",
        }}
      >
        Karthikeyan &middot; SnapServe (AITEL) &middot; Chennai
      </div>
    </div>
  );
}
