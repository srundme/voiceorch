import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { AppPageHeader } from "@/components/app-page-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Trophy, Plus, Loader2, Copy, ExternalLink } from "lucide-react";

const API = "/api";

export type VoiceathonEvent = {
  id: number;
  slug: string;
  title: string;
  tagline: string | null;
  description: string | null;
  status: string;
  mode: string;
  shareUrl: string;
  teamCount?: number;
  registrationOpen: boolean;
  submissionOpen: boolean;
  judgingOpen: boolean;
  leaderboardPublished: boolean;
  minTeamSize: number;
  maxTeamSize: number;
  registrationOpensAt: string | null;
  registrationClosesAt: string | null;
  eventStartsAt: string | null;
  eventEndsAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function statusColor(status: string) {
  if (["published", "judging", "completed"].includes(status)) {
    return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
  }
  if (status === "draft") return "bg-muted text-muted-foreground";
  if (status === "archived") return "bg-red-500/15 text-red-700 dark:text-red-300";
  return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
}

export default function EventsListPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [tagline, setTagline] = useState("");

  const { data: events = [], isLoading } = useQuery({
    queryKey: ["voiceathon-events"],
    queryFn: () => customFetch<VoiceathonEvent[]>(`${API}/voiceathon/events`),
  });

  const { data: myEvents = [] } = useQuery({
    queryKey: ["voiceathon-my-events"],
    queryFn: () => customFetch<Array<{
      event: VoiceathonEvent;
      teamName: string;
      teamReference: string;
      claimed: boolean;
      teamStatus: string;
    }>>(`${API}/voiceathon/my-events`),
  });

  const createMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      customFetch<VoiceathonEvent>(`${API}/voiceathon/events`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: (ev) => {
      void qc.invalidateQueries({ queryKey: ["voiceathon-events"] });
      setCreateOpen(false);
      toast({ title: "Event created" });
      setLocation(`/app/events/${ev.id}`);
    },
    onError: (err: Error) => toast({ title: "Create failed", description: err.message, variant: "destructive" }),
  });

  const origin = useMemo(() => (typeof window !== "undefined" ? window.location.origin : ""), []);

  return (
    <div className="flex flex-col h-full">
      <AppPageHeader
        title="Events"
        description="Run Voice-a-thons: share a registration link, collect teams, judge SnapServe agents, and publish results."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="w-4 h-4 mr-1.5" /> New event
          </Button>
        }
      />

      <div className="px-6 pb-8 space-y-8 overflow-auto">
        {myEvents.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm font-semibold">Your team registrations</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              {myEvents.map((m) => (
                <button
                  key={m.event.id}
                  type="button"
                  onClick={() => setLocation(`/app/events/${m.event.id}/team`)}
                  className="text-left rounded-xl border border-border/60 bg-card/40 p-4 hover:border-foreground/20"
                >
                  <div className="flex justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">{m.event.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {m.teamName} · {m.teamReference}
                      </p>
                    </div>
                    <Badge variant="secondary" className="text-[10px]">
                      {m.claimed ? m.teamStatus : "claim"}
                    </Badge>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading events…
          </div>
        ) : events.length === 0 ? (
          <EmptyState
            icon={<Trophy className="w-6 h-6" />}
            title="No Voice-a-thons yet"
            description="Create an event, publish a shareable registration link, and teams can register and submit SnapServe agents."
            action={{
              label: "Create event",
              onClick: () => setCreateOpen(true),
              icon: <Plus className="w-4 h-4" />,
            }}
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {events.map((ev) => (
              <button
                key={ev.id}
                type="button"
                onClick={() => setLocation(`/app/events/${ev.id}`)}
                className="text-left rounded-xl border border-border/60 bg-card/40 p-4 hover:border-foreground/20 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-medium text-sm">{ev.title}</h3>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                      {ev.tagline || `${ev.teamCount ?? 0} teams · ${ev.mode}`}
                    </p>
                  </div>
                  <Badge className={statusColor(ev.status)} variant="secondary">{ev.status}</Badge>
                </div>
                <div className="mt-3 flex gap-2 text-[11px] text-muted-foreground">
                  <span>{ev.teamCount ?? 0} teams</span>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 underline"
                    onClick={(e) => {
                      e.stopPropagation();
                      void navigator.clipboard.writeText(`${origin}${ev.shareUrl}`);
                      toast({ title: "Registration link copied" });
                    }}
                  >
                    <Copy className="w-3 h-3" /> Copy link
                  </button>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Voice-a-thon</DialogTitle>
            <DialogDescription>
              Start with a title. You can set dates, team size, rules, and judging rubric next.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Campus Voice-a-thon 2026" />
            </div>
            <div>
              <Label>Tagline (optional)</Label>
              <Textarea value={tagline} onChange={(e) => setTagline(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              disabled={!title.trim() || createMut.isPending}
              onClick={() => createMut.mutate({
                title: title.trim(),
                tagline: tagline.trim() || null,
                status: "draft",
              })}
            >
              {createMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
