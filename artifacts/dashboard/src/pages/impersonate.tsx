import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { SnapServeLoader } from "@/components/logo";

export default function ImpersonatePage() {
  const { signIn } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const session = params.get("session");
    const impToken = params.get("imp_token");
    const impName = params.get("imp_name");
    const impEmail = params.get("imp_email");

    if (session && impToken) {
      signIn(session);
      localStorage.setItem(
        "voiceorch:impersonation",
        JSON.stringify({
          sessionToken: impToken,
          name: impName ? decodeURIComponent(impName) : null,
          email: impEmail ? decodeURIComponent(impEmail) : null,
        }),
      );
      navigate("/app");
    } else {
      navigate("/");
    }
  }, []);

  return <SnapServeLoader />;
}
