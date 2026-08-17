import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Users, CheckCircle2, AlertCircle } from "lucide-react";

interface InvitePreview {
  id: number;
  email: string;
  role: string;
  status: string;
  ownerName: string;
  emailMatch: boolean;
  signedInEmail: string | null;
}

export default function TeamJoinPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [inviteKey] = useState(() => {
    const q = new URLSearchParams(window.location.search);
    return {
      token: q.get("token") ?? "",
      teamId: q.get("teamId") ?? "",
    };
  });
  const [joined, setJoined] = useState(false);
  const hasInvite = !!inviteKey.token || !!inviteKey.teamId;
  const previewQs = inviteKey.token
    ? `token=${encodeURIComponent(inviteKey.token)}`
    : `teamId=${encodeURIComponent(inviteKey.teamId)}`;

  const { data: preview, isLoading, error } = useQuery<InvitePreview>({
    queryKey: ["team-invite-preview", inviteKey.token, inviteKey.teamId],
    enabled: hasInvite,
    retry: false,
    queryFn: async () => {
      const res = await fetch(`/api/team/invite-preview?${previewQs}`, { credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Invitation not found");
      }
      return res.json();
    },
  });

  const joinMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/team/join", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          inviteKey.token
            ? { token: inviteKey.token }
            : { teamId: Number(inviteKey.teamId) },
        ),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Could not join team");
      }
      return res.json();
    },
    onSuccess: () => {
      setJoined(true);
      toast({ title: "You're on the team", description: `You can now see ${preview?.ownerName}'s agents.` });
      setTimeout(() => navigate("/app/agents"), 1000);
    },
    onError: (err: Error) => {
      toast({ title: "Could not join", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="flex items-center justify-center min-h-[70vh] px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8">
        {!hasInvite ? (
          <CenteredMessage
            icon={<AlertCircle className="w-8 h-8 text-amber-400" />}
            title="Missing invitation"
            body="Open the link from your team invitation email."
          />
        ) : isLoading ? (
          <div className="space-y-3 animate-pulse">
            <div className="h-10 w-10 rounded-xl bg-muted" />
            <div className="h-5 w-2/3 rounded bg-muted" />
            <div className="h-4 w-1/2 rounded bg-muted" />
          </div>
        ) : error ? (
          <CenteredMessage
            icon={<AlertCircle className="w-8 h-8 text-amber-400" />}
            title="Invitation not found"
            body="This link is invalid, revoked, or no longer available."
          />
        ) : joined || preview?.status === "accepted" ? (
          <CenteredMessage
            icon={<CheckCircle2 className="w-8 h-8 text-emerald-400" />}
            title="You're on the team"
            body={`You can see agents in ${preview?.ownerName}'s workspace. Taking you there…`}
          />
        ) : (
          <>
            <div className="flex items-center gap-3 mb-5">
              <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Users className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h1 className="text-lg font-semibold leading-tight">{preview?.ownerName} invited you</h1>
                <p className="text-xs text-muted-foreground">Team invitation for {preview?.email}</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground mb-5">
              Accepting lets you see and work with agents in this workspace. Sign in with the invited email.
            </p>
            {preview && !preview.emailMatch && (
              <p className="text-xs text-amber-400 mb-3">
                You're signed in as {preview.signedInEmail ?? "a different account"}, but this invitation was sent to {preview.email}.
              </p>
            )}
            <div className="flex gap-2">
              <Button className="flex-1" disabled={joinMutation.isPending || preview?.emailMatch === false} onClick={() => joinMutation.mutate()}>
                {joinMutation.isPending ? "Joining…" : "Accept invitation"}
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
