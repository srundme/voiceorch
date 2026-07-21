import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { adminFetch, BASE, formatAdminError } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Copy, Download, Send, Award, UserPlus, Trash2, ExternalLink } from "lucide-react";

type EventDetail = {
  id: number;
  slug: string;
  title: string;
  tagline: string | null;
  description: string | null;
  status: string;
  mode: string;
  venue: string | null;
  shareUrl: string;
  rules: string | null;
  eligibility: string | null;
  rubric: Array<{ id: string; label: string; maxScore: number; weight: number; description?: string }>;
  minTeamSize: number;
  maxTeamSize: number;
  maxTeams: number | null;
  leaderboardPublished: boolean;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  submissionClosesAt: string | null;
  judgingClosesAt: string | null;
  eventStartsAt: string | null;
  eventEndsAt: string | null;
  teamCount: number;
};

type TeamRow = {
  id: number;
  name: string;
  referenceCode: string;
  institution: string | null;
  city: string | null;
  leaderName: string;
  leaderEmail: string;
  leaderPhone: string;
  leaderLinkedinUrl: string;
  status: string;
  placement: string;
  rejectionReason: string | null;
  ticketCode: string | null;
  members: Array<{
    id: number;
    name: string;
    email: string | null;
    phone: string | null;
    linkedinUrl: string | null;
    role: string;
  }>;
  submission: { id: number; status: string; projectTitle: string | null; submittedAt: string | null } | null;
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
};

async function adminDownload(path: string, filename: string): Promise<void> {
  const token = localStorage.getItem("adminToken") ?? "";
  const res = await fetch(`${BASE}${path}`, { headers: { "X-Admin-Token": token } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function VoiceathonEventDetailPage({ params }: { params: { id: string } }) {
  const eventId = parseInt(params.id, 10);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState("overview");

  const { data: event, isLoading } = useQuery({
    queryKey: ["admin", "voiceathon-events", eventId],
    queryFn: () => adminFetch<EventDetail>(`/voiceathon/events/${eventId}`),
    enabled: Number.isFinite(eventId),
  });

  const { data: teams = [] } = useQuery({
    queryKey: ["admin", "voiceathon-teams", eventId],
    queryFn: () => adminFetch<TeamRow[]>(`/voiceathon/events/${eventId}/teams`),
    enabled: Number.isFinite(eventId),
    refetchInterval: tab === "registrations" ? 10_000 : false,
  });

  const { data: submissions = [] } = useQuery({
    queryKey: ["admin", "voiceathon-subs", eventId],
    queryFn: () => adminFetch<SubmissionRow[]>(`/voiceathon/events/${eventId}/submissions`),
    enabled: Number.isFinite(eventId),
  });

  const { data: judges = [], refetch: refetchJudges } = useQuery({
    queryKey: ["admin", "voiceathon-judges", eventId],
    queryFn: () => adminFetch<JudgeRow[]>(`/voiceathon/events/${eventId}/judges`),
    enabled: Number.isFinite(eventId),
  });

  const { data: leaderboard } = useQuery({
    queryKey: ["admin", "voiceathon-lb", eventId],
    queryFn: () =>
      adminFetch<{ published: boolean; rows: Array<{ rank: number; teamName: string; averageScore: number | null; scoreCount: number; placement: string }> }>(
        `/voiceathon/events/${eventId}/leaderboard`,
      ),
    enabled: Number.isFinite(eventId) && tab === "results",
  });

  const { data: announcements = [] } = useQuery({
    queryKey: ["admin", "voiceathon-ann", eventId],
    queryFn: () =>
      adminFetch<Array<{ id: number; subject: string; audience: string; status: string; sentCount: number }>>(
        `/voiceathon/events/${eventId}/announcements`,
      ),
    enabled: Number.isFinite(eventId) && tab === "comms",
  });

  const { data: certificates = [] } = useQuery({
    queryKey: ["admin", "voiceathon-certs", eventId],
    queryFn: () =>
      adminFetch<Array<{ id: number; recipientName: string; teamName: string; type: string; verificationCode: string }>>(
        `/voiceathon/events/${eventId}/certificates`,
      ),
    enabled: Number.isFinite(eventId) && tab === "comms",
  });

  const patchMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      adminFetch(`/voiceathon/events/${eventId}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "voiceathon-events", eventId] });
      void qc.invalidateQueries({ queryKey: ["admin", "voiceathon-events"] });
      toast({ title: "Saved" });
    },
    onError: (err) => toast({ title: "Update failed", description: formatAdminError(err), variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: () => adminFetch(`/voiceathon/events/${eventId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "Event deleted" });
      setLocation("/voiceathon");
    },
    onError: (err) => toast({ title: "Delete failed", description: formatAdminError(err), variant: "destructive" }),
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
  const [annAudience, setAnnAudience] = useState("all_teams");
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null);

  if (!Number.isFinite(eventId) || isLoading || !event) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const title = draftTitle ?? event.title;
  const tagline = draftTagline ?? event.tagline ?? "";
  const description = draftDesc ?? event.description ?? "";
  const rules = draftRules ?? event.rules ?? "";
  const eligibility = draftEligibility ?? event.eligibility ?? "";
  const publicUrl = `${window.location.origin}/events/${event.slug}`;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/voiceathon" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-2">
          <ArrowLeft className="h-4 w-4 mr-1" /> Voice-a-thons
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">{event.title}</h1>
          <Badge>{event.status}</Badge>
          {event.leaderboardPublished && <Badge variant="outline">leaderboard live</Badge>}
        </div>
        <div className="flex flex-wrap gap-2 mt-3">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void navigator.clipboard.writeText(publicUrl);
              toast({ title: "Public registration link copied" });
            }}
          >
            <Copy className="h-3.5 w-3.5 mr-1" /> Copy registration link
          </Button>
          <Button asChild size="sm" variant="outline">
            <a href={publicUrl} target="_blank" rel="noreferrer">
              Open public page <ExternalLink className="h-3.5 w-3.5 ml-1" />
            </a>
          </Button>
          {event.status === "draft" && (
            <Button size="sm" onClick={() => patchMut.mutate({ status: "published" })}>Publish</Button>
          )}
          {event.status === "published" && (
            <Button size="sm" variant="secondary" onClick={() => patchMut.mutate({ status: "registration_closed" })}>
              Close registration
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="text-destructive"
            onClick={() => {
              if (window.confirm(`Delete "${event.title}" and all its teams, submissions, and scores?`)) {
                deleteMut.mutate();
              }
            }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="registrations">Registrations ({teams.length})</TabsTrigger>
          <TabsTrigger value="submissions">Submissions ({submissions.length})</TabsTrigger>
          <TabsTrigger value="judging">Judging ({judges.length})</TabsTrigger>
          <TabsTrigger value="results">Results</TabsTrigger>
          <TabsTrigger value="comms">Announce & certs</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4 max-w-2xl mt-4">
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input value={title} onChange={(e) => setDraftTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Tagline</Label>
            <Input value={tagline} onChange={(e) => setDraftTagline(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDraftDesc(e.target.value)} rows={4} />
          </div>
          <div className="space-y-1.5">
            <Label>Eligibility</Label>
            <Textarea value={eligibility} onChange={(e) => setDraftEligibility(e.target.value)} rows={3} />
          </div>
          <div className="space-y-1.5">
            <Label>Rules</Label>
            <Textarea value={rules} onChange={(e) => setDraftRules(e.target.value)} rows={5} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Min team size</Label>
              <Input
                type="number"
                defaultValue={event.minTeamSize}
                onBlur={(e) => patchMut.mutate({ minTeamSize: parseInt(e.target.value, 10) || 1 })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Max team size</Label>
              <Input
                type="number"
                defaultValue={event.maxTeamSize}
                onBlur={(e) => patchMut.mutate({ maxTeamSize: parseInt(e.target.value, 10) || 4 })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Venue</Label>
              <Input
                defaultValue={event.venue ?? ""}
                placeholder="Required before team approval"
                onBlur={(e) => patchMut.mutate({ venue: e.target.value.trim() || null })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Mode</Label>
              <Select value={event.mode} onValueChange={(mode) => patchMut.mutate({ mode })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="offline">Offline</SelectItem>
                  <SelectItem value="online">Online</SelectItem>
                  <SelectItem value="hybrid">Hybrid</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Event starts</Label>
              <Input
                type="datetime-local"
                defaultValue={toLocalInput(event.eventStartsAt)}
                onBlur={(e) => patchMut.mutate({ eventStartsAt: fromLocalInput(e.target.value) })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Event ends</Label>
              <Input
                type="datetime-local"
                defaultValue={toLocalInput(event.eventEndsAt)}
                onBlur={(e) => patchMut.mutate({ eventEndsAt: fromLocalInput(e.target.value) })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Registration opens</Label>
              <Input
                type="datetime-local"
                defaultValue={toLocalInput(event.registrationOpensAt)}
                onBlur={(e) => patchMut.mutate({ registrationOpensAt: fromLocalInput(e.target.value) })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Registration closes</Label>
              <Input
                type="datetime-local"
                defaultValue={toLocalInput(event.registrationClosesAt)}
                onBlur={(e) => patchMut.mutate({ registrationClosesAt: fromLocalInput(e.target.value) })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Submission closes</Label>
              <Input
                type="datetime-local"
                defaultValue={toLocalInput(event.submissionClosesAt)}
                onBlur={(e) => patchMut.mutate({ submissionClosesAt: fromLocalInput(e.target.value) })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Judging closes</Label>
              <Input
                type="datetime-local"
                defaultValue={toLocalInput(event.judgingClosesAt)}
                onBlur={(e) => patchMut.mutate({ judgingClosesAt: fromLocalInput(e.target.value) })}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Judging rubric <span className="text-muted-foreground font-normal">(label · max score · weight)</span></Label>
            {(event.rubric ?? []).map((c, i) => (
              <div key={c.id} className="grid grid-cols-[1fr_80px_80px] gap-2">
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
          </div>
          <Button
            onClick={() =>
              patchMut.mutate({
                title: title.trim(),
                tagline: tagline.trim() || null,
                description: description.trim() || null,
                rules: rules.trim() || null,
                eligibility: eligibility.trim() || null,
              })
            }
            disabled={patchMut.isPending}
          >
            Save overview
          </Button>
        </TabsContent>

        <TabsContent value="registrations" className="space-y-3 mt-4">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              adminDownload(`/voiceathon/events/${eventId}/teams/export.csv`, `voiceathon-${event.slug}-teams.csv`)
                .catch((err) => toast({ title: "Export failed", description: formatAdminError(err), variant: "destructive" }))
            }
          >
            <Download className="h-3.5 w-3.5 mr-1" /> Export CSV
          </Button>
          {teams.length === 0 ? (
            <p className="text-sm text-muted-foreground">No teams registered yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Team</TableHead>
                  <TableHead>Leader</TableHead>
                  <TableHead>Members</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Placement</TableHead>
                  <TableHead>Review</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {teams.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>
                      <div className="font-medium">{t.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {t.referenceCode}
                        {t.institution ? ` · ${t.institution}` : ""}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{t.leaderName}</div>
                      <div className="text-xs text-muted-foreground">{t.leaderEmail}</div>
                      <div className="text-xs text-muted-foreground">{t.leaderPhone}</div>
                      <a
                        href={t.leaderLinkedinUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs underline"
                      >
                        LinkedIn
                      </a>
                    </TableCell>
                    <TableCell className="text-sm max-w-64">
                      {t.members.map((member) => (
                        <div key={member.id} className="mb-2 last:mb-0">
                          <div>{member.name} <span className="text-xs text-muted-foreground">({member.role})</span></div>
                          <div className="text-xs text-muted-foreground">{member.email} · {member.phone}</div>
                          {member.linkedinUrl && (
                            <a href={member.linkedinUrl} target="_blank" rel="noreferrer" className="text-xs underline">
                              LinkedIn profile
                            </a>
                          )}
                        </div>
                      ))}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={t.status}
                        disabled={t.status === "pending" || t.status === "rejected"}
                        onValueChange={(v) => {
                          void adminFetch(`/voiceathon/events/${eventId}/teams/${t.id}`, {
                            method: "PATCH",
                            body: JSON.stringify({ status: v }),
                          }).then(() => qc.invalidateQueries({ queryKey: ["admin", "voiceathon-teams", eventId] }));
                        }}
                      >
                        <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {[
                            "pending", "approved", "rejected", "registered", "claimed",
                            "submitted", "disqualified", "withdrawn",
                          ].map((s) => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      {t.status === "pending" ? (
                        <div className="flex flex-col gap-1.5 min-w-24">
                          <Button
                            size="sm"
                            onClick={async () => {
                              try {
                                await adminFetch(`/voiceathon/events/${eventId}/teams/${t.id}`, {
                                  method: "PATCH",
                                  body: JSON.stringify({ status: "approved" }),
                                });
                                void qc.invalidateQueries({ queryKey: ["admin", "voiceathon-teams", eventId] });
                                toast({ title: "Approved — ticket emailed" });
                              } catch (err) {
                                toast({
                                  title: "Approval failed",
                                  description: formatAdminError(err),
                                  variant: "destructive",
                                });
                              }
                            }}
                          >
                            Approve + ticket
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-destructive"
                            onClick={async () => {
                              const reason = window.prompt("Why is this registration being rejected?");
                              if (!reason?.trim()) return;
                              try {
                                await adminFetch(`/voiceathon/events/${eventId}/teams/${t.id}`, {
                                  method: "PATCH",
                                  body: JSON.stringify({ status: "rejected", rejectionReason: reason.trim() }),
                                });
                                void qc.invalidateQueries({ queryKey: ["admin", "voiceathon-teams", eventId] });
                                toast({ title: "Registration rejected" });
                              } catch (err) {
                                toast({
                                  title: "Rejection failed",
                                  description: formatAdminError(err),
                                  variant: "destructive",
                                });
                              }
                            }}
                          >
                            Reject
                          </Button>
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground max-w-36">
                          {t.ticketCode ? (
                            <button
                              type="button"
                              className="underline"
                              onClick={() => adminDownload(
                                `/voiceathon/events/${eventId}/teams/${t.id}/ticket.pdf`,
                                `${t.ticketCode}.pdf`,
                              )}
                            >
                              Ticket {t.ticketCode}
                            </button>
                          ) : t.rejectionReason || "Reviewed"}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <Select
                        value={t.placement}
                        onValueChange={(v) => {
                          void adminFetch(`/voiceathon/events/${eventId}/teams/${t.id}`, {
                            method: "PATCH",
                            body: JSON.stringify({ placement: v }),
                          }).then(() => qc.invalidateQueries({ queryKey: ["admin", "voiceathon-teams", eventId] }));
                        }}
                      >
                        <SelectTrigger className="w-[140px] h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {["participant", "finalist", "winner", "runner_up"].map((s) => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        <TabsContent value="submissions" className="space-y-2 mt-4">
          {submissions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No submissions yet.</p>
          ) : (
            submissions.map((s) => (
              <Card key={s.id}>
                <CardContent className="pt-4 flex justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{s.projectTitle || "Untitled"}</p>
                    <p className="text-xs text-muted-foreground">
                      {s.teamName} ({s.teamReference}) · {s.agentName || "no agent"} · {s.status}
                      {s.submittedAt ? ` · ${new Date(s.submittedAt).toLocaleString()}` : ""}
                    </p>
                    {s.projectSummary && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{s.projectSummary}</p>
                    )}
                  </div>
                  {s.judgeJoinUrl && (
                    <a className="text-xs underline shrink-0" href={s.judgeJoinUrl} target="_blank" rel="noreferrer">
                      Live demo
                    </a>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="judging" className="space-y-4 max-w-xl mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-1.5">
                <UserPlus className="h-4 w-4" /> Invite judge
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Input placeholder="Name" value={judgeName} onChange={(e) => setJudgeName(e.target.value)} />
              <Input placeholder="Email" value={judgeEmail} onChange={(e) => setJudgeEmail(e.target.value)} />
              <Button
                size="sm"
                disabled={!judgeName.trim() || !judgeEmail.trim()}
                onClick={async () => {
                  try {
                    const subIds = submissions.filter((s) => s.status === "submitted").map((s) => s.id);
                    const row = await adminFetch<JudgeRow & { inviteUrl: string }>(
                      `/voiceathon/events/${eventId}/judges`,
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
                    toast({ title: "Judge invited and emailed" });
                  } catch (err) {
                    toast({ title: "Invite failed", description: formatAdminError(err), variant: "destructive" });
                  }
                }}
              >
                Invite & assign all submissions
              </Button>
              {lastInviteUrl && (
                <p className="text-xs break-all text-muted-foreground">
                  Invite link (also emailed):{" "}
                  <button
                    type="button"
                    className="underline"
                    onClick={() => void navigator.clipboard.writeText(lastInviteUrl)}
                  >
                    {lastInviteUrl}
                  </button>
                </p>
              )}
            </CardContent>
          </Card>

          {judges.map((j) => (
            <Card key={j.id}>
              <CardContent className="pt-4 flex justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">{j.name}</p>
                  <p className="text-xs text-muted-foreground">{j.email} · {j.assignmentCount} assigned · {j.status}</p>
                </div>
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      try {
                        const result = await adminFetch<{ inviteUrl: string }>(
                          `/voiceathon/events/${eventId}/judges/${j.id}/regenerate`,
                          { method: "POST" },
                        );
                        setLastInviteUrl(result.inviteUrl);
                        await navigator.clipboard.writeText(result.inviteUrl);
                        void refetchJudges();
                        toast({ title: "New judge link emailed and copied" });
                      } catch (err) {
                        toast({ title: "Could not generate link", description: formatAdminError(err), variant: "destructive" });
                      }
                    }}
                  >
                    New link
                  </Button>
                  {j.status !== "revoked" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        await adminFetch(`/voiceathon/events/${eventId}/judges/${j.id}/revoke`, { method: "POST" });
                        void refetchJudges();
                      }}
                    >
                      Revoke
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}

          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => patchMut.mutate({ status: "judging" })}>
              Start judging
            </Button>
            <Button size="sm" variant="outline" onClick={() => patchMut.mutate({ status: "completed" })}>
              Mark completed
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="results" className="space-y-3 mt-4">
          <div className="flex gap-2 items-center">
            <Button size="sm" onClick={() => patchMut.mutate({ leaderboardPublished: !event.leaderboardPublished })}>
              {event.leaderboardPublished ? "Unpublish leaderboard" : "Publish leaderboard"}
            </Button>
            <span className="text-xs text-muted-foreground">
              {event.leaderboardPublished ? "Visible on the public event page" : "Hidden from the public page"}
            </span>
          </div>
          {(leaderboard?.rows ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No scored submissions yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead className="text-right">Avg score</TableHead>
                  <TableHead>Placement</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(leaderboard?.rows ?? []).map((r) => (
                  <TableRow key={r.rank}>
                    <TableCell>{r.rank}</TableCell>
                    <TableCell>{r.teamName}</TableCell>
                    <TableCell className="text-right">
                      {r.averageScore ?? "—"}
                      <span className="text-xs text-muted-foreground"> ({r.scoreCount})</span>
                    </TableCell>
                    <TableCell>{r.placement}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        <TabsContent value="comms" className="space-y-6 max-w-xl mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-1.5">
                <Send className="h-4 w-4" /> Announcement
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Input placeholder="Subject" value={annSubject} onChange={(e) => setAnnSubject(e.target.value)} />
              <Textarea placeholder="Message body" value={annBody} onChange={(e) => setAnnBody(e.target.value)} rows={4} />
              <Select value={annAudience} onValueChange={setAnnAudience}>
                <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all_teams">All team leaders</SelectItem>
                  <SelectItem value="finalists">Finalists</SelectItem>
                  <SelectItem value="winners">Winners</SelectItem>
                </SelectContent>
              </Select>
              <Button
                size="sm"
                disabled={!annSubject.trim() || !annBody.trim()}
                onClick={async () => {
                  try {
                    await adminFetch(`/voiceathon/events/${eventId}/announcements`, {
                      method: "POST",
                      body: JSON.stringify({
                        subject: annSubject.trim(),
                        bodyHtml: `<p>${annBody.trim().replace(/\n/g, "<br/>")}</p>`,
                        audience: annAudience,
                        send: true,
                      }),
                    });
                    setAnnSubject("");
                    setAnnBody("");
                    void qc.invalidateQueries({ queryKey: ["admin", "voiceathon-ann", eventId] });
                    toast({ title: "Announcement sent" });
                  } catch (err) {
                    toast({ title: "Send failed", description: formatAdminError(err), variant: "destructive" });
                  }
                }}
              >
                Send
              </Button>
              <ul className="text-xs text-muted-foreground space-y-1 pt-1">
                {announcements.map((a) => (
                  <li key={a.id}>{a.subject} · {a.audience} · {a.status} · {a.sentCount} sent</li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-1.5">
                <Award className="h-4 w-4" /> Certificates
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {(["participation", "finalist", "winner", "runner_up"] as const).map((type) => (
                  <Button
                    key={type}
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      try {
                        const out = await adminFetch<{ issued: number }>(
                          `/voiceathon/events/${eventId}/certificates/issue`,
                          { method: "POST", body: JSON.stringify({ type }) },
                        );
                        void qc.invalidateQueries({ queryKey: ["admin", "voiceathon-certs", eventId] });
                        toast({ title: `Issued ${out.issued} ${type} certificates` });
                      } catch (err) {
                        toast({ title: "Issue failed", description: formatAdminError(err), variant: "destructive" });
                      }
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
                      onClick={() =>
                        adminDownload(`/voiceathon/certificates/${c.id}/pdf`, `certificate-${c.verificationCode}.pdf`)
                          .catch((err) => toast({ title: "Download failed", description: formatAdminError(err), variant: "destructive" }))
                      }
                    >
                      PDF
                    </button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
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
