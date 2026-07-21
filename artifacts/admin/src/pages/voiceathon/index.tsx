import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { adminFetch } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Trophy } from "lucide-react";

export interface AdminVoiceathonEvent {
  id: number;
  slug: string;
  title: string;
  status: string;
  mode: string;
  shareUrl: string;
  ownerEmail: string | null;
  ownerName: string | null;
  teamCount: number;
  submissionCount: number;
  judgeCount: number;
  certificateCount: number;
  registrationOpen: boolean;
  leaderboardPublished: boolean;
  eventStartsAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (["published", "judging"].includes(status)) return "default";
  if (status === "archived") return "destructive";
  if (status === "draft") return "outline";
  return "secondary";
}

export default function VoiceathonEventsPage() {
  const { data: events = [], isLoading, error } = useQuery({
    queryKey: ["admin", "voiceathon-events"],
    queryFn: () => adminFetch<AdminVoiceathonEvent[]>("/voiceathon/events"),
    refetchInterval: 60_000,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Trophy className="h-5 w-5" /> Voice-a-thons
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          All Voice-a-thon competitions across organizers — registrations, submissions, judging, and certificates.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Events ({events.length})</CardTitle>
          <CardDescription>Read-only oversight. Organizers manage their own events in the dashboard.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : error ? (
            <p className="text-sm text-destructive">Failed to load events.</p>
          ) : events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No Voice-a-thon events created yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>Organizer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Teams</TableHead>
                  <TableHead className="text-right">Submissions</TableHead>
                  <TableHead className="text-right">Judges</TableHead>
                  <TableHead className="text-right">Certificates</TableHead>
                  <TableHead>Starts</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((ev) => (
                  <TableRow key={ev.id}>
                    <TableCell>
                      <Link href={`/voiceathon/${ev.id}`} className="font-medium hover:underline">
                        {ev.title}
                      </Link>
                      <div className="text-xs text-muted-foreground">/{ev.slug}</div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{ev.ownerName || "—"}</div>
                      <div className="text-xs text-muted-foreground">{ev.ownerEmail || ev.slug}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(ev.status)}>{ev.status}</Badge>
                      {ev.leaderboardPublished && (
                        <Badge variant="outline" className="ml-1">leaderboard live</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{ev.teamCount}</TableCell>
                    <TableCell className="text-right">{ev.submissionCount}</TableCell>
                    <TableCell className="text-right">{ev.judgeCount}</TableCell>
                    <TableCell className="text-right">{ev.certificateCount}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {ev.eventStartsAt ? new Date(ev.eventStartsAt).toLocaleDateString() : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
