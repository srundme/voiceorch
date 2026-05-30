import { useEffect } from "react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function LandingPage() {
  // Keep body scrollable while this page is mounted
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  return (
    <iframe
      src={`${BASE}/landing.html`}
      title="SnapServe"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100vh",
        border: "none",
        zIndex: 9999,
      }}
    />
  );
}
