import { useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorBlock, Field, LoadingBlock, Pill, ServerErrors, touch } from "@/components/sales/sales-ui";
import { useAcceptInvite, useSalesInvite } from "@/hooks/use-sales-api";
import { formatDateTimeIST } from "@/lib/sales-format";
import { SalesAuthShell } from "@/pages/sales/login";

const MIN_PASSWORD = 10;

export default function SalesInvite() {
  const { token = "" } = useParams<{ token: string }>();
  const invite = useSalesInvite(token);
  const accept = useAcceptInvite(token);
  const [, navigate] = useLocation();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD;
  const mismatch = confirm.length > 0 && confirm !== password;
  const valid = name.trim() && password.length >= MIN_PASSWORD && password === confirm;

  return (
    <SalesAuthShell title="Accept invite" subtitle="Set up your sales pipeline account.">
      {invite.isLoading && <LoadingBlock rows={3} />}
      {invite.error && (
        <div className="space-y-3">
          <ErrorBlock error={invite.error} />
          <Link href="/sales/login" className="text-sm underline">
            Go to sign in
          </Link>
        </div>
      )}
      {invite.data && (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            accept.mutate({ name: name.trim(), password }, { onSuccess: () => navigate("/sales") });
          }}
        >
          <div className="space-y-1 rounded-md bg-muted/50 p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-medium">{invite.data.email}</span>
              <Pill tone={invite.data.role === "founder" ? "accent" : "neutral"}>{invite.data.role}</Pill>
            </div>
            <p className="text-xs text-muted-foreground">Invite expires {formatDateTimeIST(invite.data.expiresAt)} IST</p>
          </div>
          <Field label="Your name" htmlFor="invite-name" required>
            <Input id="invite-name" value={name} onChange={(e) => setName(e.target.value)} className={touch} autoComplete="name" autoFocus />
          </Field>
          <Field label="Password" htmlFor="invite-password" required hint={`At least ${MIN_PASSWORD} characters.`}>
            <Input id="invite-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={touch} autoComplete="new-password" aria-invalid={tooShort} />
          </Field>
          {tooShort && <p className="text-xs text-red-500">Password must be at least {MIN_PASSWORD} characters.</p>}
          <Field label="Confirm password" htmlFor="invite-confirm" required>
            <Input id="invite-confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={touch} autoComplete="new-password" aria-invalid={mismatch} />
          </Field>
          {mismatch && <p className="text-xs text-red-500">Passwords do not match.</p>}
          <ServerErrors error={accept.error} />
          <Button type="submit" className={`w-full ${touch}`} disabled={!valid || accept.isPending}>
            {accept.isPending ? "Creating account…" : "Create account and sign in"}
          </Button>
        </form>
      )}
    </SalesAuthShell>
  );
}
