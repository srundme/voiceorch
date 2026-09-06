import { useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { AppLoader } from "@/components/logo";

export default function ImpersonatePage() {
  const { signIn } = useAuth();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const impToken = params.get("imp_token");
    const impName = params.get("imp_name");
    const impEmail = params.get("imp_email");
    const returnTo = params.get("return_to");

    if (!code || !impToken) {
      navigate("/");
      return;
    }

    void (async () => {
      try {
        const res = await fetch(
          `/api/impersonate/exchange?code=${encodeURIComponent(code)}`,
          { credentials: "include" },
        );
        if (!res.ok) throw new Error("Exchange failed");

        // Cookie is set by the exchange response. Wait until identity is loaded
        // before navigating — otherwise ProtectedApp treats us as signed-out.
        const ok = await signIn();
        if (!ok) return;

        localStorage.setItem(
          "voiceorch:impersonation",
          JSON.stringify({
            sessionToken: impToken,
            name: impName ? decodeURIComponent(impName) : null,
            email: impEmail ? decodeURIComponent(impEmail) : null,
            returnUrl: returnTo || null,
          }),
        );
        queryClient.clear();
        navigate("/app");
      } catch {
        navigate("/");
      }
    })();
  }, [navigate, queryClient, signIn]);

  return <AppLoader />;
}
