import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { AppPageHeader } from "@/components/app-page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft, Copy, Loader2, Trash2, Download, Send, Award, UserPlus,
} from "lucide-react";
import type { VoiceathonEvent } from "./index";

const API = "/api";

type TeamRow = {
  id: number;
  name: string;
  referenceCode: string;
  institution: string | null;
  city: string | null;
  leaderName: string;
  leaderEmail: string;
  leaderPhone: string | null;
  status: string;
  placement: string;
  notes: string | null;
  members: Array<{ id: number; name: string; email: string | null; role: string }>;
  submission: { id: number; status: string; agentId: number | null; projectTitle: string | null; submittedAt: string | null } | null;
  createdAt: string;
};

type SubmissionRow = {
  id: number;
  teamName: string;
  teamReference: string;
  agentName: string | null;
  projectTitle: string | null;
  projectSummary: string | null;
  status: string;
  judgeJoinUrl: string | null;
  submittedAt: string | null;
};

type JudgeRow = {
  id: number;
  name: string;
  email: string;
  status: string;
  assignmentCount: number;
  inviteUrl?: string;
};

export default function EventDetailPage() {
  const params = useParams<{ id: string }>();
  const eventId = parseInt(params.id ?? "", 10);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState("overview");

  const { data: event, isLoading } = useQuery({
    queryKey: ["voiceathon-event", eventId],
    queryFn: () => customFetch<VoiceathonEvent & {
      rules: string | null;
      eligibility: string | null;
      rubric: Array<{ id: string; label: string; maxScore: number; weight: number; description?: string }>;
      prizes: Array<{ place: string; title: string; description?: string }>;
      faq: Array<{ question: string; answer: string }>;
      venue: string | null;
      timezone: string;
      maxTeams: number | null;
      registrationOpensAt: string | null;
      registrationClosesAt: string | null;
      submissionOpensAt: string | null;
      submissionClosesAt: string | null;
      judgingOpensAt: string | null;
      judgingClosesAt: string | null;
      eventStartsAt: string | null;
      eventEndsAt: string | null;
      minTeamSize: number;
      maxTeamSize: number;
    }>(`${API}/voiceathon/events/${eventId}`),
    enabled: Number.isFinite(eventId),
  });

  const { data: teams = [] } = useQuery({
    queryKey: ["voiceathon-teams", eventId],
    queryFn: () => customFetch<TeamRow[]>(`${API}/voiceathon/events/${eventId}/teams`),
    enabled: Number.isFinite(eventId),
    refetchInterval: tab === "registrations" ? 5000 : false,
  });

  const { data: submissions = [] } = useQuery({
    queryKey: ["voiceathon-subs", eventId],
    queryFn: () => customFetch<SubmissionRow[]>(`${API}/voiceathon/events/${eventId}/submissions`),
    enabled: Number.isFinite(eventId),
  });

  const { data: judges = [], refetch: refetchJudges } = useQuery({
    queryKey: ["voiceathon-judges", eventId],
    queryFn: () => customFetch<JudgeRow[]>(`${API}/voiceathon/events/${eventId}/judges`),
    enabled: Number.isFinite(eventId),
  });

  const { data: leaderboard } = useQuery({
    queryKey: ["voiceathon-lb", eventId],
    queryFn: () => customFetch<{ published: boolean; rows: Array<{ rank: number; teamName: string; averageScore: number | null; scoreCount: number; placement: string }> }>(
      `${API}/voiceathon/events/${eventId}/leaderboard`,
    ),
    enabled: Number.isFinite(eventId) && tab === "results",
  });

  const { data: announcements = [] } = useQuery({
    queryKey: ["voiceathon-ann", eventId],
    queryFn: () => customFetch<Array<{ id: number; subject: string; audience: string; status: string; sentCount: number; createdAt: string }>>(
      `${API}/voiceathon/events/${eventId}/announcements`,
    ),
    enabled: Number.isFinite(eventId) && tab === "comms",
  });

  const { data: certificates = [] } = useQuery({
    queryKey: ["voiceathon-certs", eventId],
    queryFn: () => customFetch<Array<{ id: number; recipientName: string; teamName: string; type: string; verificationCode: string }>>(
      `${API}/voiceathon/events/${eventId}/certificates`,
    ),
    enabled: Number.isFinite(eventId) && tab === "comms",
  });

  const patchMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      customFetch(`${API}/voiceathon/events/${eventId}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["voiceathon-event", eventId] });
      toast({ title: "Saved" });
    },
    onError: (err: Error) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: () => customFetch(`${API}/voiceathon/events/${eventId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "Event deleted" });
      setLocation("/app/events");
    },
  });

  const [draftTitle, setDraftTitle] = useState<string | null>(null);
  const [draftTagline, setDraftTagline] = useState<string | null>(null);
  const [draftDesc, setDraftDesc] = useState<string | null>(null);
  const [draftRules, setDraftRules] = useState<string | null>(null);
  const [draftEligibility, setDraftEligibility] = useState<string | null>(null);
  const [judgeName, setJudgeName] = useState("");
  const [judgeEmail, setJudgeEmail] = useState("");
  const [annSubject, setAnnSubject] = useState("");
  const [annBody, setAnnBody] = useState("");
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null);

  const origin = useMemo(() => (typeof window !== "undefined" ? window.location.origin : ""), []);

  if (!Number.isFinite(eventId) || isLoading || !event) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…
      </div>
    );
  }

  const title = draftTitle ?? event.title;
  const tagline = draftTagline ?? event.tagline ?? "";
  const description = draftDesc ?? event.description ?? "";
  const rules = draftRules ?? event.rules ?? "";
  const eligibility = draftEligibility ?? event.eligibility ?? "";

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-4 pb-2">
        <Button variant="ghost" size="sm" onClick={() => setLocation("/app/events")} className="-ml-2 mb-2">
          <ArrowLeft className="w-4 h-4 mr-1" /> Events
        </Button>
        <AppPageHeader
          title={event.title}
          description={event.tagline || "Voice-a-thon event workspace"}
          actions={
            <div className="flex flex-wrap gap-2 items-center">
              <Badge variant="secondary">{event.status}</Badge>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(`${origin}${event.shareUrl}`);
                  toast({ title: "Public link copied" });
                }}
              >
                <Copy className="w-3.5 h-3.5 mr-1" /> Copy registration link
              </Button>
              {event.status === "draft" && (
                <Button size="sm" onClick={() => patchMut.mutate({ status: "published" })}>
                  Publish
                </Button>
              )}
              {event.status === "published" && (
                <Button size="sm" variant="secondary" onClick={() => patchMut.mutate({ status: "registration_closed" })}>
                  Close registration
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => deleteMut.mutate()}>
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          }
        />
      </div>

      <div className="px-6 pb-10 overflow-auto">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-4 flex flex-wrap h-auto">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="registrations">Registrations ({teams.length})</TabsTrigger>
            <TabsTrigger value="submissions">Submissions ({submissions.length})</TabsTrigger>
            <TabsTrigger value="judging">Judging ({judges.length})</TabsTrigger>
            <TabsTrigger value="results">Results</TabsTrigger>
            <TabsTrigger value="comms">Announce & certs</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4 max-w-2xl">
            <div>
              <Label>Title</Label>
              <Input value={title} onChange={(e) => setDraftTitle(e.target.value)} />
            </div>
            <div>
              <Label>Tagline</Label>
              <Input value={tagline} onChange={(e) => setDraftTagline(e.target.value)} />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea value={description} onChange={(e) => setDraftDesc(e.target.value)} rows={4} />
            </div>
            <div>
              <Label>Eligibility</Label>
              <Textarea value={eligibility} onChange={(e) => setDraftEligibility(e.target.value)} rows={3} />
            </div>
            <div>
              <Label>Rules</Label>
              <Textarea value={rules} onChange={(e) => setDraftRules(e.target.value)} rows={5} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Min team size</Label>
                <Input
                  type="number"
                  defaultValue={event.minTeamSize}
                  onBlur={(e) => patchMut.mutate({ minTeamSize: parseInt(e.target.value, 10) || 1 })}
                />
              </div>
              <div>
                <Label>Max team size</Label>
                <Input
                  type="number"
                  defaultValue={event.maxTeamSize}
                  onBlur={(e) => patchMut.mutate({ maxTeamSize: parseInt(e.target.value, 10) || 4 })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Registration opens</Label>
                <Input
                  type="datetime-local"
                  defaultValue={toLocalInput(event.registrationOpensAt)}
                  onBlur={(e) => patchMut.mutate({ registrationOpensAt: fromLocalInput(e.target.value) })}
                />
              </div>
              <div>
                <Label>Registration closes</Label>
                <Input
                  type="datetime-local"
                  defaultValue={toLocalInput(event.registrationClosesAt)}
                  onBlur={(e) => patchMut.mutate({ registrationClosesAt: fromLocalInput(e.target.value) })}
                />
              </div>
              <div>
                <Label>Submission closes</Label>
                <Input
                  type="datetime-local"
                  defaultValue={toLocalInput(event.submissionClosesAt)}
                  onBlur={(e) => patchMut.mutate({ submissionClosesAt: fromLocalInput(e.target.value) })}
                />
              </div>
              <div>
                <Label>Judging closes</Label>
                <Input
                  type="datetime-local"
                  defaultValue={toLocalInput(event.judgingClosesAt)}
                  onBlur={(e) => patchMut.mutate({ judgingClosesAt: fromLocalInput(e.target.value) })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Judging rubric</Label>
              {(event.rubric ?? []).map((c, i) => (
                <div key={c.id} className="grid grid-cols-[1fr_80px_80px] gap-2 items-end">
                  <Input
                    defaultValue={c.label}
                    onBlur={(e) => {
                      const rubric = [...(event.rubric ?? [])];
                      rubric[i] = { ...rubric[i]!, label: e.target.value.trim() || c.label };
                      patchMut.mutate({ rubric });
                    }}
                  />
                  <Input
                    type="number"
                    defaultValue={c.maxScore}
                    title="Max score"
                    onBlur={(e) => {
                      const rubric = [...(event.rubric ?? [])];
                      rubric[i] = { ...rubric[i]!, maxScore: Math.max(1, parseInt(e.target.value, 10) || 10) };
                      patchMut.mutate({ rubric });
                    }}
                  />
                  <Input
                    type="number"
                    step="0.1"
                    defaultValue={c.weight}
                    title="Weight"
                    onBlur={(e) => {
                      const rubric = [...(event.rubric ?? [])];
                      rubric[i] = { ...rubric[i]!, weight: Math.max(0.1, parseFloat(e.target.value) || 1) };
                      patchMut.mutate({ rubric });
                    }}
                  />
                </div>
              ))}
              <p className="text-[11px] text-muted-foreground">Columns: label · max score · weight</p>
            </div>
            <Button
              onClick={() => patchMut.mutate({
                title: title.trim(),
                tagline: tagline.trim() || null,
                description: description.trim() || null,
                rules: rules.trim() || null,
                eligibility: eligibility.trim() || null,
              })}
              disabled={patchMut.isPending}
            >
              Save overview
            </Button>
            <p className="text-xs text-muted-foreground">
              Public page: <a className="underline" href={event.shareUrl} target="_blank" rel="noreferrer">{origin}{event.shareUrl}</a>
            </p>
          </TabsContent>

          <TabsContent value="registrations" className="space-y-3">
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    const blob = await customFetch<Blob>(
                      `${API}/voiceathon/events/${eventId}/teams/export.csv`,
                      { responseType: "blob" },
                    );
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `voiceathon-${event.slug}-teams.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                  } catch (err) {
                    toast({
                      title: "Export failed",
                      description: err instanceof Error ? err.message : "Could not download CSV",
                      variant: "destructive",
                    });
                  }
                }}
              >
                <Download className="w-3.5 h-3.5 mr-1" /> Export CSV
              </Button>
            </div>
            {teams.length === 0 && <p className="text-xs text-muted-foreground">No teams registered yet.</p>}
            <div className="space-y-2">
              {teams.map((t) => (
                <div key={t.id} className="rounded-lg border border-border/60 p-3">
                  <div className="flex flex-wrap justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{t.name} <span className="text-muted-foreground font-normal">({t.referenceCode})</span></p>
                      <p className="text-xs text-muted-foreground">
                        {t.leaderName} · {t.leaderEmail}
                        {t.institution ? ` · ${t.institution}` : ""}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        Members: {t.members.map((m) => m.name).join(", ")}
                      </p>
                    </div>
                    <div className="flex flex-col gap-1 items-end">
                      <Select
                        value={t.status}
                        onValueChange={(v) => {
                          void customFetch(`${API}/voiceathon/events/${eventId}/teams/${t.id}`, {
                            method: "PATCH",
                            body: JSON.stringify({ status: v }),
                          }).then(() => qc.invalidateQueries({ queryKey: ["voiceathon-teams", eventId] }));
                        }}
                      >
                        <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {["registered", "claimed", "submitted", "disqualified", "withdrawn"].map((s) => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Select
                        value={t.placement}
                        onValueChange={(v) => {
                          void customFetch(`${API}/voiceathon/events/${eventId}/teams/${t.id}`, {
                            method: "PATCH",
                            body: JSON.stringify({ placement: v }),
                          }).then(() => qc.invalidateQueries({ queryKey: ["voiceathon-teams", eventId] }));
                        }}
                      >
                        <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {["participant", "finalist", "winner", "runner_up"].map((s) => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="submissions" className="space-y-2">
            {submissions.length === 0 && <p className="text-xs text-muted-foreground">No submissions yet.</p>}
            {submissions.map((s) => (
              <div key={s.id} className="rounded-lg border border-border/60 p-3">
                <div className="flex justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{s.projectTitle || "Untitled"}</p>
                    <p className="text-xs text-muted-foreground">
                      {s.teamName} · {s.agentName || "no agent"} · {s.status}
                    </p>
                    {s.projectSummary && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{s.projectSummary}</p>
                    )}
                  </div>
                  {s.judgeJoinUrl && (
                    <a className="text-xs underline" href={s.judgeJoinUrl} target="_blank" rel="noreferrer">Demo</a>
                  )}
                </div>
              </div>
            ))}
          </TabsContent>

          <TabsContent value="judging" className="space-y-4 max-w-xl">
            <div className="rounded-lg border border-border/60 p-3 space-y-2">
              <p className="text-sm font-medium flex items-center gap-1"><UserPlus className="w-4 h-4" /> Invite judge</p>
              <Input placeholder="Name" value={judgeName} onChange={(e) => setJudgeName(e.target.value)} />
              <Input placeholder="Email" value={judgeEmail} onChange={(e) => setJudgeEmail(e.target.value)} />
              <Button
                size="sm"
                disabled={!judgeName.trim() || !judgeEmail.trim()}
                onClick={async () => {
                  const subIds = submissions.filter((s) => s.status === "submitted").map((s) => s.id);
                  const row = await customFetch<JudgeRow & { inviteUrl: string }>(
                    `${API}/voiceathon/events/${eventId}/judges`,
                    {
                      method: "POST",
                      body: JSON.stringify({
                        name: judgeName.trim(),
                        email: judgeEmail.trim(),
                        submissionIds: subIds,
                      }),
                    },
                  );
                  setLastInviteUrl(row.inviteUrl);
                  setJudgeName("");
                  setJudgeEmail("");
                  void refetchJudges();
                  toast({ title: "Judge invited" });
                }}
              >
                Invite & assign all submissions
              </Button>
              {lastInviteUrl && (
                <p className="text-xs break-all text-muted-foreground">
                  Invite link (also emailed): <button type="button" className="underline" onClick={() => void navigator.clipboard.writeText(lastInviteUrl.startsWith("http") ? lastInviteUrl : `${origin}${lastInviteUrl}`)}>{lastInviteUrl}</button>
                </p>
              )}
            </div>
            <div className="space-y-2">
              {judges.map((j) => (
                <div key={j.id} className="rounded-lg border border-border/50 p-3 flex justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{j.name}</p>
                    <p className="text-xs text-muted-foreground">{j.email} · {j.assignmentCount} assigned · {j.status}</p>
                  </div>
                  {j.status !== "revoked" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        await customFetch(`${API}/voiceathon/events/${eventId}/judges/${j.id}/revoke`, { method: "POST" });
                        void refetchJudges();
                      }}
                    >
                      Revoke
                    </Button>
                  )}
                </div>
              ))}
            </div>
            <div>
              <Label className="text-xs">Event status for judging</Label>
              <div className="flex gap-2 mt-1">
                <Button size="sm" variant="secondary" onClick={() => patchMut.mutate({ status: "judging" })}>Start judging</Button>
                <Button size="sm" variant="outline" onClick={() => patchMut.mutate({ status: "completed" })}>Mark completed</Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="results" className="space-y-3">
            <div className="flex gap-2 items-center">
              <Button
                size="sm"
                onClick={() => patchMut.mutate({ leaderboardPublished: !event.leaderboardPublished })}
              >
                {event.leaderboardPublished ? "Unpublish leaderboard" : "Publish leaderboard"}
              </Button>
              <span className="text-xs text-muted-foreground">
                {event.leaderboardPublished ? "Visible on public event page" : "Hidden from public page"}
              </span>
            </div>
            <div className="space-y-1">
              {(leaderboard?.rows ?? []).map((r) => (
                <div key={r.rank} className="flex justify-between text-sm border-b border-border/40 py-2">
                  <span>#{r.rank} {r.teamName}</span>
                  <span className="text-muted-foreground">
                    {r.averageScore ?? "—"} ({r.scoreCount} scores) · {r.placement}
                  </span>
                </div>
              ))}
              {!leaderboard?.rows?.length && (
                <p className="text-xs text-muted-foreground">No scored submissions yet.</p>
              )}
            </div>
          </TabsContent>

          <TabsContent value="comms" className="space-y-6 max-w-xl">
            <section className="space-y-2">
              <h3 className="text-sm font-semibold flex items-center gap-1"><Send className="w-4 h-4" /> Announcement</h3>
              <Input placeholder="Subject" value={annSubject} onChange={(e) => setAnnSubject(e.target.value)} />
              <Textarea placeholder="HTML or plain text body" value={annBody} onChange={(e) => setAnnBody(e.target.value)} rows={4} />
              <Button
                size="sm"
                disabled={!annSubject.trim() || !annBody.trim()}
                onClick={async () => {
                  await customFetch(`${API}/voiceathon/events/${eventId}/announcements`, {
                    method: "POST",
                    body: JSON.stringify({
                      subject: annSubject.trim(),
                      bodyHtml: `<p>${annBody.trim().replace(/\n/g, "<br/>")}</p>`,
                      audience: "all_teams",
                      send: true,
                    }),
                  });
                  setAnnSubject("");
                  setAnnBody("");
                  void qc.invalidateQueries({ queryKey: ["voiceathon-ann", eventId] });
                  toast({ title: "Announcement sent to team leaders" });
                }}
              >
                Send to all team leaders
              </Button>
              <ul className="text-xs text-muted-foreground space-y-1">
                {announcements.map((a) => (
                  <li key={a.id}>{a.subject} · {a.status} · {a.sentCount} sent</li>
                ))}
              </ul>
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold flex items-center gap-1"><Award className="w-4 h-4" /> Certificates</h3>
              <div className="flex flex-wrap gap-2">
                {(["participation", "finalist", "winner", "runner_up"] as const).map((type) => (
                  <Button
                    key={type}
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      await customFetch(`${API}/voiceathon/events/${eventId}/certificates/issue`, {
                        method: "POST",
                        body: JSON.stringify({ type }),
                      });
                      void qc.invalidateQueries({ queryKey: ["voiceathon-certs", eventId] });
                      toast({ title: `Issued ${type} certificates` });
                    }}
                  >
                    Issue {type}
                  </Button>
                ))}
              </div>
              <div className="space-y-1">
                {certificates.map((c) => (
                  <div key={c.id} className="flex justify-between text-xs border-b border-border/40 py-1.5">
                    <span>{c.recipientName} · {c.teamName} · {c.type}</span>
                    <button
                      type="button"
                      className="underline"
                      onClick={async () => {
                        try {
                          const blob = await customFetch<Blob>(
                            `${API}/voiceathon/certificates/${c.id}/pdf`,
                            { responseType: "blob" },
                          );
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement("a");
                          a.href = url;
                          a.download = `certificate-${c.verificationCode}.pdf`;
                          a.click();
                          URL.revokeObjectURL(url);
                        } catch (err) {
                          toast({
                            title: "Download failed",
                            description: err instanceof Error ? err.message : "Could not download PDF",
                            variant: "destructive",
                          });
                        }
                      }}
                    >
                      PDF
                    </button>
                  </div>
                ))}
              </div>
            </section>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}
