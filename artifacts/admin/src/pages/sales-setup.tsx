import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ExternalLink, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CopyField } from "@/components/sales/sales-ui";
import { adminFetch } from "@/lib/api";
import { adminAppUrl } from "@/lib/sales-api";
import type { InviteResult } from "@/lib/sales-types";

function bootstrapError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.startsWith("HTTP 409")) return "A founder already exists. Ask them to invite people from Sales → Settings → Team.";
  const body = msg.replace(/^HTTP \d+:\s*/, "");
  try {
    const parsed = JSON.parse(body) as { error?: string };
    if (parsed.error) return parsed.error;
  } catch {
    /* not JSON */
  }
  return msg;
}

/** One-time creation of the first sales founder invite, gated by the admin token. */
export default function SalesSetupPage() {
  const [email, setEmail] = useState("");
  const bootstrap = useMutation<InviteResult, Error, string>({
    mutationFn: (e) => adminFetch<InviteResult>("/sales/bootstrap", { method: "POST", body: JSON.stringify({ email: e }) }),
  });

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Rocket className="text-primary" size={28} />
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Sales setup</h1>
          <p className="text-sm text-muted-foreground">Create the first founder account for the sales pipeline. This works only once.</p>
        </div>
      </div>

      <div className="space-y-4 rounded-lg border border-border bg-card p-5">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (email.trim()) bootstrap.mutate(email.trim());
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="founder-email">Founder email</Label>
            <Input id="founder-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="founder@snapserve.ai" className="h-11" />
          </div>
          <Button type="submit" className="h-11" disabled={bootstrap.isPending || !email.trim()}>
            {bootstrap.isPending ? "Creating…" : "Create founder invite"}
          </Button>
        </form>

        {bootstrap.error && <p className="text-sm text-red-500">{bootstrapError(bootstrap.error)}</p>}

        {bootstrap.data && (
          <div className="space-y-2 rounded-md border border-border bg-muted/40 p-4">
            <p className="text-sm">
              Invite created for <strong>{bootstrap.data.invite.email}</strong>. Open the link to set a name and password. It expires{" "}
              {new Date(bootstrap.data.invite.expiresAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST.
            </p>
            <CopyField value={adminAppUrl(bootstrap.data.inviteUrlPath)} label="Copy link" />
            <p className="text-xs text-muted-foreground">This link is shown only once. Share it privately.</p>
          </div>
        )}
      </div>

      <a href={adminAppUrl("/sales")} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        Open the sales pipeline <ExternalLink className="h-3.5 w-3.5" />
      </a>
    </div>
  );
}
