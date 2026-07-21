import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { customFetch } from "@workspace/api-client-react";
import { AppPageHeader } from "@/components/app-page-header";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Loader2, Trophy } from "lucide-react";

const API = "/api";

export type VoiceathonEvent = {
  id: number;
  slug: string;
  title: string;
  tagline: string | null;
  status: string;
  mode: string;
  shareUrl: string;
  registrationOpen: boolean;
  submissionOpen: boolean;
  eventStartsAt: string | null;
};

export default function EventsListPage() {
  const [, setLocation] = useLocation();

  const { data: myEvents = [], isLoading } = useQuery({
    queryKey: ["voiceathon-my-events"],
    queryFn: () => customFetch<Array<{
      event: VoiceathonEvent;
      teamName: string;
      teamReference: string;
      claimed: boolean;
      teamStatus: string;
    }>>(`${API}/voiceathon/my-events`),
  });

  return (
    <div className="flex flex-col h-full">
      <AppPageHeader
        title="Events"
        description="Voice-a-thons you registered for — open your team portal to submit your agent."
      />

      <div className="px-6 pb-8 overflow-auto">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : myEvents.length === 0 ? (
          <EmptyState
            icon={<Trophy className="w-6 h-6" />}
            title="No event registrations"
            description="Register for a Voice-a-thon via its public event link using this account's email as the team leader, then your team will appear here."
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {myEvents.map((m) => (
              <button
                key={m.event.id}
                type="button"
                onClick={() => setLocation(`/app/events/${m.event.id}/team`)}
                className="text-left rounded-xl border border-border/60 bg-card/40 p-4 hover:border-foreground/20 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{m.event.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {m.teamName} · {m.teamReference}
                    </p>
                    {m.event.eventStartsAt && (
                      <p className="text-[11px] text-muted-foreground mt-1">
                        {new Date(m.event.eventStartsAt).toLocaleString()}
                      </p>
                    )}
                  </div>
                  <Badge variant="secondary" className="text-[10px]">
                    {m.claimed ? m.teamStatus : "claim"}
                  </Badge>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
