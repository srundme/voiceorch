import { useEffect } from "react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function LandingPage() {
  useEffect(() => {
    window.location.replace(BASE + "/landing.html");
  }, [BASE]);
  return null;
}
