import { useEffect } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { AppLoader } from "@/components/logo";

export default function ImpersonatePage() {
  const { signIn } = useAuth();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const impToken = params.get("imp_token");
    const impName = params.get("imp_name");
    const impEmail = params.get("imp_email");
    const returnTo = params.get("return_to");

    if (code && impToken) {
      fetch(`/api/impersonate/exchange?code=${encodeURIComponent(code)}`)
        .then((r) => {
          if (!r.ok) throw new Error("Exchange failed");
          return r.json() as Promise<{ sessionJwt: string }>;
        })
        .then(({ sessionJwt }) => {
          signIn(sessionJwt);
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
        })
        .catch(() => navigate("/"));
    } else {
      navigate("/");
    }
  }, []);

  return <AppLoader />;
}
