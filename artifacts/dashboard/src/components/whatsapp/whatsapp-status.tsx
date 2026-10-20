/**
 * After-call WhatsApp result per call (sent / failed / skipped), read from
 * GET /api/calls/whatsapp-status. Used by the History list and the call drawer.
 */
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { CheckCheck, MessageCircle, MinusCircle, XCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const _DASH_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = `${_DASH_BASE}/api`;

export type CallWhatsappStatus = {
  status: "sent" | "failed" | "skipped" | string;
  reason: string | null;
  template: string | null;
  provider: string | null;
  params: string[];
  at: string;
};

/** Latest WhatsApp result for each of `callIds` (calls with no attempt are absent). */
export function useCallWhatsappStatuses(callIds: number[]) {
  const ids = [...new Set(callIds)].filter((n) => Number.isSafeInteger(n) && n > 0).sort((a, b) => a - b);
  return useQuery({
    queryKey: ["call-whatsapp-status", ids.join(",")],
    enabled: ids.length > 0,
    staleTime: 15_000,
    // Post-call sends land a few seconds after the call ends; keep the badge fresh.
    refetchInterval: 30_000,
    queryFn: async () => {
      const r = await customFetch<{ statuses: Record<string, CallWhatsappStatus> }>(
        `${API}/calls/whatsapp-status?ids=${ids.join(",")}`,
      );
      return r.statuses ?? {};
    },
  });
}

const STYLE: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  sent: {
    label: "Sent",
    cls: "bg-emerald-500/10 text-emerald-500 border-emerald-500/25",
    icon: <CheckCheck className="h-3 w-3" />,
  },
  failed: {
    label: "Failed",
    cls: "bg-red-500/10 text-red-500 border-red-500/25",
    icon: <XCircle className="h-3 w-3" />,
  },
  skipped: {
    label: "Not sent",
    cls: "bg-muted/50 text-muted-foreground border-border",
    icon: <MinusCircle className="h-3 w-3" />,
  },
};

function styleFor(status: string) {
  return STYLE[status] ?? STYLE.skipped!;
}

function providerLabel(p: string | null): string {
  if (p === "meta") return "Meta WhatsApp";
  if (p === "vobiz") return "SnapServe WhatsApp";
  if (p === "byo") return "Your provider's webhook";
  return "WhatsApp";
}

/** Compact badge for the History list; tooltip carries the reason. */
export function WhatsappStatusBadge({ value }: { value: CallWhatsappStatus | undefined }) {
  if (!value) return <span className="text-[10px] text-muted-foreground/35">—</span>;
  const s = styleFor(value.status);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          // The row opens the call; hovering the badge shouldn't.
          onClick={(e) => e.stopPropagation()}
          className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-semibold ${s.cls}`}
        >
          {s.icon}
          {s.label}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs text-xs">
        <p className="font-medium">
          WhatsApp {s.label.toLowerCase()}{value.template ? ` · ${value.template}` : ""}
        </p>
        {value.reason && <p className="mt-0.5 text-muted-foreground">{value.reason}</p>}
      </TooltipContent>
    </Tooltip>
  );
}

/** Drawer card: what was sent (or why not), with the exact template values. */
export function WhatsappStatusCard({ value, loading }: { value: CallWhatsappStatus | undefined; loading?: boolean }) {
  const s = value ? styleFor(value.status) : null;
  return (
    <div className="rounded-xl border border-border/60 bg-card/30">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[13px] font-semibold text-foreground">After-call WhatsApp</span>
        </div>
        {s && (
          <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold ${s.cls}`}>
            {s.icon}
            {s.label}
          </span>
        )}
      </div>
      <div className="space-y-2 px-3.5 py-3 text-[11px]">
        {loading ? (
          <p className="text-muted-foreground">Checking…</p>
        ) : !value ? (
          <p className="text-muted-foreground">
            No WhatsApp message was attempted for this call. Turn it on under Agent → After call → After-call messages.
          </p>
        ) : (
          <>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Template</span>
              <span className="font-mono text-foreground">{value.template ?? "—"}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Sent via</span>
              <span className="text-foreground">{providerLabel(value.provider)}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">When</span>
              <span className="text-foreground">{new Date(value.at).toLocaleString()}</span>
            </div>
            {value.reason && (
              <p
                className={`rounded-md px-2 py-1.5 ${
                  value.status === "failed" ? "bg-red-500/10 text-red-500" : "bg-muted/50 text-muted-foreground"
                }`}
              >
                {value.reason}
              </p>
            )}
            {value.params.length > 0 && (
              <div className="space-y-1">
                <p className="text-muted-foreground">Values sent</p>
                {value.params.map((p, i) => (
                  <div key={i} className="flex gap-2">
                    <span className="shrink-0 font-mono text-muted-foreground">{`{{${i + 1}}}`}</span>
                    <span className="break-words text-foreground">{p}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
