import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { partnerFetch } from "@/hooks/use-partner";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, AlertCircle } from "lucide-react";
import { SnapServeIcon } from "@/components/logo";

interface InvitePreview {
  status: string;
  email: string;
  companyName: string;
  rateCentsPerMin: number;
  logoUrl: string | null;
}

const inr = (cents: number) => `₹${(cents / 100).toFixed(2)}`;

/**
 * Partner invite acceptance page — /app/partner-join?token=...
 * The token is latched from the initial URL so client-side navigation
 * can't drop it mid-flow.
 */
export default function PartnerJoinPage() {
  const { getToken, user } = useAuth() as ReturnType<typeof useAuth> & { user?: { email?: string } };
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, navigate] = useLocation();
  // Latch the token once from the real URL (query params are invisible to wouter paths).
  const [token] = useState(() => new URLSearchParams(window.location.search).get("token") ?? "");
  const [accepted, setAccepted] = useState(false);

  const { data: preview, isLoading, error } = useQuery<InvitePreview>({
    queryKey: ["partner-invite-preview", token],
    enabled: !!token,
    retry: false,
    queryFn: () => partnerFetch<InvitePreview>(getToken, `/api/partner/invites/preview?token=${encodeURIComponent(token)}`),
  });

  const acceptMutation = useMutation({
    mutationFn: () =>
      partnerFetch<{ linked: boolean; companyName: string }>(getToken, "/api/partner/invites/accept", {
        method: "POST",
        body: JSON.stringify({ token }),
      }),
    onSuccess: (data) => {
      setAccepted(true);
      queryClient.invalidateQueries({ queryKey: ["partner-context"] });
      toast({ title: "Invitation accepted", description: `Your account is now managed in partnership with ${data.companyName}.` });
      setTimeout(() => navigate("/app/home"), 1200);
    },
    onError: (err: Error) => {
      toast({ title: "Could not accept invitation", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="flex items-center justify-center min-h-[70vh] px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8">
        {!token ? (
          <CenteredMessage icon={<AlertCircle className="w-8 h-8 text-amber-400" />} title="Missing invite token"
            body="This page needs an invitation link. Please open the link from your invitation email." />
        ) : isLoading ? (
          <div className="space-y-3 animate-pulse">
            <div className="h-10 w-10 rounded-xl bg-muted" />
            <div className="h-5 w-2/3 rounded bg-muted" />
            <div className="h-4 w-1/2 rounded bg-muted" />
          </div>
        ) : error ? (
          <CenteredMessage icon={<AlertCircle className="w-8 h-8 text-amber-400" />} title="Invitation not found"
            body="This invitation link is invalid, revoked, or no longer available." />
        ) : accepted ? (
          <CenteredMessage icon={<CheckCircle2 className="w-8 h-8 text-emerald-400" />} title="You're all set"
            body={`Your account is now connected to ${preview?.companyName}. Taking you to your dashboard…`} />
        ) : preview?.status === "accepted" ? (
          <CenteredMessage icon={<CheckCircle2 className="w-8 h-8 text-emerald-400" />} title="Invitation already used"
            body="This invitation has already been accepted." />
        ) : (
          <>
            <div className="flex items-center gap-3 mb-5">
              <div className="h-10 w-10 rounded-xl bg-elevated border border-border flex items-center justify-center">
                <SnapServeIcon size={22} className="text-foreground" />
              </div>
              <div>
                <h1 className="text-lg font-semibold leading-tight">{preview?.companyName} invited you</h1>
                <p className="text-xs text-muted-foreground">Partner invitation for {preview?.email}</p>
              </div>
            </div>
            <div className="rounded-lg border border-border bg-elevated/40 px-4 py-3 mb-5 space-y-1.5">
              <p className="text-sm text-muted-foreground">
                Accepting links your account to <span className="text-foreground font-medium">{preview?.companyName}</span>.
                They can fund your wallet and manage your per-minute calling rate.
              </p>
              {preview && (
                <p className="text-sm">
                  Your calling rate: <span className="font-semibold tabular-nums">{inr(preview.rateCentsPerMin)}/min</span>
                </p>
              )}
            </div>
            {user?.email && preview && user.email.toLowerCase() !== preview.email.toLowerCase() && (
              <p className="text-xs text-amber-400 mb-3">
                You're signed in as {user.email}, but this invitation was sent to {preview.email}. Sign in with that email to accept.
              </p>
            )}
            <div className="flex gap-2">
              <Button className="flex-1" disabled={acceptMutation.isPending} onClick={() => acceptMutation.mutate()}>
                {acceptMutation.isPending ? "Accepting…" : "Accept invitation"}
              </Button>
              <Button variant="outline" onClick={() => navigate("/app/home")}>Not now</Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function CenteredMessage({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="flex flex-col items-center text-center py-4">
      {icon}
      <h1 className="text-lg font-semibold mt-3">{title}</h1>
      <p className="text-sm text-muted-foreground mt-1.5">{body}</p>
    </div>
  );
}
