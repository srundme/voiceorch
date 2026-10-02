import { useState, type ReactNode } from "react";
import { Redirect, useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, ServerErrors, touch } from "@/components/sales/sales-ui";
import { useSalesLogin, useSalesMe } from "@/hooks/use-sales-api";

export function SalesAuthShell({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="sales-app flex min-h-dvh items-center justify-center bg-background px-4 py-10 font-sans text-foreground">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center gap-2">
          <img src={`${import.meta.env.BASE_URL}snapserve-icon-light.png`} alt="" aria-hidden className="h-6 w-6" />
          <span className="text-sm font-semibold">SnapServe Sales</span>
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="rounded-lg border border-border bg-card p-5">{children}</div>
      </div>
    </div>
  );
}

function safeNext(raw: string | null): string {
  return raw && raw.startsWith("/sales") && !raw.startsWith("/sales/login") ? raw : "/sales";
}

export default function SalesLogin() {
  const search = useSearch();
  const next = safeNext(new URLSearchParams(search).get("next"));
  const me = useSalesMe();
  const login = useSalesLogin();
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  if (me.data) return <Redirect to={next} />;

  return (
    <SalesAuthShell title="Sign in" subtitle="Internal sales pipeline. Ask a founder for an invite if you don't have an account.">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          login.mutate({ email: email.trim(), password }, { onSuccess: () => navigate(next) });
        }}
      >
        <Field label="Email" htmlFor="sales-email">
          <Input id="sales-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className={touch} autoFocus required />
        </Field>
        <Field label="Password" htmlFor="sales-password">
          <Input id="sales-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={touch} required />
        </Field>
        <ServerErrors error={login.error} />
        <Button type="submit" className={`w-full ${touch}`} disabled={login.isPending || !email || !password}>
          {login.isPending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </SalesAuthShell>
  );
}
