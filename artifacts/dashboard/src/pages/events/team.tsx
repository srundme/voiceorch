import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { customFetch, useListAgents } from "@workspace/api-client-react";
import { AppPageHeader } from "@/components/app-page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Loader2, CheckCircle2 } from "lucide-react";

const API = "/api";

export default function EventTeamPortalPage() {
  const params = useParams<{ id: string }>();
  const eventId = parseInt(params.id ?? "", 10);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["voiceathon-my-team", eventId],
    queryFn: () => customFetch<{
      event: { id: number; title: string; slug: string; status: string; shareUrl: string };
      team: {
        id: number;
        name: string;
        referenceCode: string;
        institution: string | null;
        city: string | null;
        leaderPhone: string | null;
        status: string;
        members: Array<{ name: string; email: string | null; role: string }>;
      };
      submission: {
        id: number;
        status: string;
        agentId: number | null;
        agentName: string | null;
        projectTitle: string | null;
        projectSummary: string | null;
        judgeJoinUrl: string | null;
        submittedAt: string | null;
      } | null;
      submissionOpen: boolean;
    }>(`${API}/voiceathon/events/${eventId}/my-team`),
    enabled: Number.isFinite(eventId),
    retry: false,
  });

  const { data: agentsData } = useListAgents();
  const agents = agentsData ?? [];

  const [agentId, setAgentId] = useState("");
  const [projectTitle, setProjectTitle] = useState("");
  const [projectSummary, setProjectSummary] = useState("");

  const submitMut = useMutation({
    mutationFn: () =>
      customFetch(`${API}/voiceathon/events/${eventId}/my-team/submit`, {
        method: "POST",
        body: JSON.stringify({
          agentId: parseInt(agentId, 10),
          projectTitle: projectTitle.trim(),
          projectSummary: projectSummary.trim(),
        }),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["voiceathon-my-team", eventId] });
      toast({ title: "Submission locked for judging" });
    },
    onError: (err: Error) => toast({ title: "Submit failed", description: err.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading team…
      </div>
    );
  }

  if (error || !data) {
    const message = (error as Error)?.message ?? "";
    const pending = message.toLowerCase().includes("pending");
    const rejected = message.toLowerCase().includes("rejected")
      || message.toLowerCase().includes("not approved");
    return (
      <div className="px-6 py-12 max-w-lg space-y-3">
        <Button variant="ghost" size="sm" onClick={() => setLocation("/app/events")}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Events
        </Button>
        <h1 className="text-lg font-semibold">
          {pending ? "Registration under review" : rejected ? "Registration not approved" : "No team found"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {message || "Register on the public event page with this account's email as the team leader, then come back here."}
        </p>
      </div>
    );
  }

  const { event, team, submission, submissionOpen } = data;

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-4 pb-2">
        <Button variant="ghost" size="sm" onClick={() => setLocation("/app/events")} className="-ml-2 mb-2">
          <ArrowLeft className="w-4 h-4 mr-1" /> Events
        </Button>
        <AppPageHeader
          title={event.title}
          description={`Team portal · ${team.name} (${team.referenceCode})`}
          actions={<Badge variant="secondary">{team.status}</Badge>}
        />
      </div>

      <div className="px-6 pb-10 max-w-xl space-y-6 overflow-auto">
        <section className="rounded-lg border border-border/60 p-4 space-y-1 text-sm">
          <p><span className="text-muted-foreground">Members:</span> {team.members.map((m) => m.name).join(", ")}</p>
          {team.institution && <p><span className="text-muted-foreground">Institution:</span> {team.institution}</p>}
          <p className="text-xs text-muted-foreground">
            Build your agent in the Agents builder, then submit it here before the deadline.
          </p>
          <Button size="sm" variant="outline" onClick={() => setLocation("/app/agents")}>
            Open agent builder
          </Button>
        </section>

        {submission?.status === "submitted" ? (
          <section className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-2">
            <p className="text-sm font-medium flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Submitted
            </p>
            <p className="text-sm">{submission.projectTitle}</p>
            <p className="text-xs text-muted-foreground">
              Agent: {submission.agentName} · {submission.submittedAt ? new Date(submission.submittedAt).toLocaleString() : ""}
            </p>
            {submissionOpen && (
              <p className="text-xs text-muted-foreground">You can resubmit below while the window is open (creates a new freeze).</p>
            )}
          </section>
        ) : null}

        {submissionOpen ? (
          <section className="space-y-3 rounded-lg border border-border/60 p-4">
            <h2 className="text-sm font-semibold">Submit SnapServe agent</h2>
            <div>
              <Label>Your agent</Label>
              <Select value={agentId} onValueChange={setAgentId}>
                <SelectTrigger><SelectValue placeholder="Select an agent you own" /></SelectTrigger>
                <SelectContent>
                  {agents.map((a) => (
                    <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Project title</Label>
              <Input value={projectTitle} onChange={(e) => setProjectTitle(e.target.value)} placeholder="Campus helpdesk voice agent" />
            </div>
            <div>
              <Label>Project summary</Label>
              <Textarea
                value={projectSummary}
                onChange={(e) => setProjectSummary(e.target.value)}
                rows={4}
                placeholder="What problem does it solve? How should judges talk to it?"
              />
            </div>
            <Button
              disabled={!agentId || !projectTitle.trim() || !projectSummary.trim() || submitMut.isPending}
              onClick={() => submitMut.mutate()}
            >
              {submitMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Submit for judging"}
            </Button>
          </section>
        ) : (
          <p className="text-sm text-muted-foreground">The submission window is closed for this event.</p>
        )}
      </div>
    </div>
  );
}
