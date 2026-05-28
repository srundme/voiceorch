import { useState } from "react";
import { Bell } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { useAdminAlerts, useAcknowledgeAlert } from "@/hooks/use-usage-monitor";

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-red-500/15 text-red-400 border-red-500/30",
  high: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
  medium: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
  low: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
};

export function AlertsBell() {
  const [open, setOpen] = useState(false);
  const { data } = useAdminAlerts({ limit: 10, onlyUnacknowledged: true });
  const ack = useAcknowledgeAlert();
  const count = data?.unacknowledgedCount ?? 0;
  const alerts = data?.alerts ?? [];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-9 w-9" data-testid="button-alerts-bell">
          <Bell className="h-4 w-4" />
          {count > 0 && (
            <span className="absolute -top-1 -right-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
              {count > 99 ? "99+" : count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="end">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <p className="text-sm font-semibold">Alerts</p>
            <p className="text-xs text-muted-foreground">
              {count} unacknowledged
            </p>
          </div>
          <Link href="/usage/alerts" onClick={() => setOpen(false)}>
            <Button variant="link" size="sm" className="h-auto p-0 text-xs">View all</Button>
          </Link>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {alerts.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">No active alerts</div>
          ) : (
            alerts.map((a) => (
              <div key={a.id} className="border-b border-border px-4 py-3 last:border-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className={SEVERITY_COLORS[a.severity] ?? ""}>
                        {a.severity}
                      </Badge>
                      <span className="truncate text-xs font-medium">{a.title}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{a.message}</p>
                    <p className="mt-1 text-[10px] text-muted-foreground/70">
                      {new Date(a.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[10px]"
                    onClick={() => ack.mutate(a.id)}
                    disabled={ack.isPending}
                    data-testid={`button-ack-${a.id}`}
                  >
                    Ack
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
