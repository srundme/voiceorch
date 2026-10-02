import { useEffect, type ReactNode } from "react";
import { Redirect, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useSalesMe, salesKeys } from "@/hooks/use-sales-api";
import { isSalesApiError } from "@/lib/sales-api";
import { SalesPrefsProvider } from "@/components/sales/sales-context";
import { QuickActionsProvider } from "@/components/sales/quick-actions";
import { ErrorBlock } from "@/components/sales/sales-ui";

export function SalesFullScreenLoader() {
  return (
    <div className="flex h-dvh items-center justify-center bg-background text-muted-foreground">
      <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…
    </div>
  );
}

/** Gates the sales app on GET /api/sales/auth/me (cookie session), independent of the admin token. */
export function SalesProtected({ children }: { children: ReactNode }) {
  const me = useSalesMe();
  const qc = useQueryClient();
  const [location, navigate] = useLocation();

  useEffect(() => {
    const onUnauthorized = () => {
      qc.removeQueries({ queryKey: salesKeys.me });
      navigate(`/sales/login?next=${encodeURIComponent(window.location.pathname.replace(/^.*?\/sales/, "/sales"))}`);
    };
    window.addEventListener("sales:unauthorized", onUnauthorized);
    return () => window.removeEventListener("sales:unauthorized", onUnauthorized);
  }, [qc, navigate]);

  if (me.isLoading) return <SalesFullScreenLoader />;
  if (me.error) {
    if (isSalesApiError(me.error) && me.error.status === 401) {
      return <Redirect to={`/sales/login?next=${encodeURIComponent(location)}`} />;
    }
    return (
      <div className="mx-auto max-w-md p-6">
        <ErrorBlock error={me.error} onRetry={() => me.refetch()} />
      </div>
    );
  }
  if (!me.data) return <SalesFullScreenLoader />;
  return (
    <SalesPrefsProvider user={me.data.user}>
      <QuickActionsProvider>{children}</QuickActionsProvider>
    </SalesPrefsProvider>
  );
}
