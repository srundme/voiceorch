import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { adminFetch } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft, ExternalLink } from "lucide-react";

type Detail = {
  event: {
    id: number;
    slug: string;
    title: string;
    tagline: string | null;
    status: string;
    mode: string;
    venue: string | null;
    shareUrl: string;
    ownerEmail: string | null;
    ownerName: string | null;
    minTeamSize: number;
    maxTeamSize: number;
    leaderboardPublished: boolean;
    registrationClosesAt: string | null;
    submissionClosesAt: string | null;
    judgingClosesAt: string | null;
    eventStartsAt: string | null;
  };
  teams: Array<{
    id: number;
    name: string;
    referenceCode: string;
    institution: string | null;
    leaderName: string;
    leaderEmail: string;
    status: string;
    placement: string;
    claimed: boolean;
    members: Array<{ name: string; email: string | null; role: string }>;
    submission: {
      status: string;
      agentName: string | null;
      projectTitle: string | null;
      submittedAt: string | null;
    } | null;
    createdAt: string;
  }>;
  judges: Array<{
    id: number;
    name: string;
    email: string;
    status: string;
    assignmentCount: number;
    finalizedScores: number;
    lastAccessAt: string | null;
  }>;
  leaderboard: Array<{
    rank: number;
    teamName: string;
    averageScore: number | null;
    scoreCount: number;
    placement: string;
  }>;
};

export default function VoiceathonEventDetailPage({ params }: { params: { id: string } }) {
  const id = parseInt(params.id, 10);
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "voiceathon-events", id],
    queryFn: () => adminFetch<Detail>(`/voiceathon/events/${id}`),
    enabled: Number.isFinite(id),
    refetchInterval: 60_000,
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error || !data) return <p className="text-sm text-destructive">Failed to load event.</p>;

  const { event, teams, judges, leaderboard } = data;

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
        <p className="text-sm text-muted-foreground mt-1">
          Organizer: {event.ownerName || "—"} ({event.ownerEmail || "unknown"}) · {event.mode}
          {event.venue ? ` · ${event.venue}` : ""} · team size {event.minTeamSize}–{event.maxTeamSize}
        </p>
        <Button asChild variant="outline" size="sm" className="mt-2">
          <a href={event.shareUrl} target="_blank" rel="noreferrer">
            Public page <ExternalLink className="h-3.5 w-3.5 ml-1" />
          </a>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Teams ({teams.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {teams.length === 0 ? (
            <p className="text-sm text-muted-foreground">No registrations yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Team</TableHead>
                  <TableHead>Leader</TableHead>
                  <TableHead>Members</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Submission</TableHead>
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
                    </TableCell>
                    <TableCell className="text-sm">{t.members.map((m) => m.name).join(", ")}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{t.status}</Badge>
                      {t.placement !== "participant" && (
                        <Badge variant="outline" className="ml-1">{t.placement}</Badge>
                      )}
                      {!t.claimed && <div className="text-[11px] text-muted-foreground mt-1">unclaimed</div>}
                    </TableCell>
                    <TableCell className="text-sm">
                      {t.submission ? (
                        <>
                          <div>{t.submission.projectTitle || "Untitled"}</div>
                          <div className="text-xs text-muted-foreground">
                            {t.submission.agentName || "agent"} ·{" "}
                            {t.submission.submittedAt
                              ? new Date(t.submission.submittedAt).toLocaleString()
                              : t.submission.status}
                          </div>
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Judges ({judges.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {judges.length === 0 ? (
              <p className="text-sm text-muted-foreground">No judges invited.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Judge</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Assigned</TableHead>
                    <TableHead className="text-right">Finalized</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {judges.map((j) => (
                    <TableRow key={j.id}>
                      <TableCell>
                        <div className="text-sm">{j.name}</div>
                        <div className="text-xs text-muted-foreground">{j.email}</div>
                      </TableCell>
                      <TableCell><Badge variant="secondary">{j.status}</Badge></TableCell>
                      <TableCell className="text-right">{j.assignmentCount}</TableCell>
                      <TableCell className="text-right">{j.finalizedScores}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Leaderboard</CardTitle>
            <CardDescription>
              Average of finalized judge scores. {event.leaderboardPublished ? "Published publicly." : "Not published."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {leaderboard.length === 0 ? (
              <p className="text-sm text-muted-foreground">No eligible teams.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Team</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                    <TableHead>Placement</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leaderboard.map((r) => (
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
