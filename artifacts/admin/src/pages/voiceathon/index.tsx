import { useState } from "react";
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
import { Trophy, Plus, Copy, Check } from "lucide-react";

export interface AdminVoiceathonEvent {
  id: number;
  slug: string;
  title: string;
  tagline: string | null;
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

function ShareLink({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/events/${slug}`;
  const copy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <Button variant="ghost" size="sm" onClick={copy} className="h-7 px-2 text-xs font-mono">
      {copied ? <Check className="h-3.5 w-3.5 mr-1 text-emerald-500" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
      /events/{slug}
    </Button>
  );
}

export default function VoiceathonEventsPage() {
  const { data: events = [], isLoading, error } = useQuery({
    queryKey: ["admin", "voiceathon-events"],
    queryFn: () => adminFetch<AdminVoiceathonEvent[]>("/voiceathon/events"),
    refetchInterval: 60_000,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Trophy className="h-5 w-5" /> Voice-a-thons
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Create and run Voice-a-thon competitions: registration, submissions, judging, results, certificates.
          </p>
        </div>
        <Button asChild>
          <Link href="/voiceathon/new"><Plus className="h-4 w-4 mr-1.5" /> Create event form</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Events ({events.length})</CardTitle>
          <CardDescription>
            Share <span className="font-mono">/events/&lt;slug&gt;</span> — teams register without logging in.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : error ? (
            <p className="text-sm text-destructive">Failed to load events.</p>
          ) : events.length === 0 ? (
            <p className="text-sm text-muted-foreground">No Voice-a-thon events yet — create one to get started.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Teams</TableHead>
                  <TableHead className="text-right">Submissions</TableHead>
                  <TableHead className="text-right">Judges</TableHead>
                  <TableHead className="text-right">Certs</TableHead>
                  <TableHead>Public link</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((ev) => (
                  <TableRow key={ev.id}>
                    <TableCell>
                      <Link href={`/voiceathon/${ev.id}`} className="font-medium hover:underline">
                        {ev.title}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {ev.tagline || (ev.eventStartsAt ? new Date(ev.eventStartsAt).toLocaleDateString() : "no date set")}
                        {ev.ownerEmail && ev.ownerEmail !== "admin panel" ? ` · by ${ev.ownerEmail}` : ""}
                      </div>
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
                    <TableCell><ShareLink slug={ev.slug} /></TableCell>
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
