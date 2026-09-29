import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { CallDetailContent } from "@/pages/calls/[id]";
import { Button } from "@/components/ui/button";
import { PhoneOff, X, Phone } from "lucide-react";

interface CallDetailDrawerProps {
  open: boolean;
  onClose: () => void;
  callId: number | null;
  leadName?: string | null;
  leadPhone?: string | null;
  onRetry?: () => void;
  currentIndex?: number;
  totalCount?: number;
  onPrev?: () => void;
  onNext?: () => void;
  prevLabel?: string | null;
  nextLabel?: string | null;
}

export function CallDetailDrawer({
  open,
  onClose,
  callId,
  leadName,
  leadPhone,
  onRetry,
  currentIndex,
  totalCount,
  onPrev,
  onNext,
  prevLabel,
  nextLabel,
}: CallDetailDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent
        side="right"
        className="!p-0 w-[min(95vw,_940px)] sm:max-w-none flex flex-col overflow-hidden [&>button:first-child]:hidden bg-background border-l border-border shadow-2xl"
      >
        <SheetTitle className="sr-only">
          {leadName ? `Call — ${leadName}` : "Call Detail"}
        </SheetTitle>
        {callId != null ? (
          <div className="flex-1 overflow-auto min-h-0">
            <CallDetailContent
              callId={callId}
              drawerMode
              onClose={onClose}
              onPrev={onPrev ?? undefined}
              onNext={onNext ?? undefined}
              prevLabel={prevLabel ?? undefined}
              nextLabel={nextLabel ?? undefined}
              currentIndex={currentIndex}
              totalCount={totalCount}
            />
          </div>
        ) : (
          <div className="flex-1 flex flex-col h-full bg-background overflow-hidden">
            <div className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                  <PhoneOff className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-foreground">
                    {leadName && leadName !== "Unknown" ? leadName : leadPhone ? leadPhone : "Call Details"}
                  </h2>
                  {leadPhone && leadName && leadName !== "Unknown" && (
                    <p className="text-xs font-mono text-muted-foreground">{leadPhone}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {onRetry && (
                  <Button size="sm" variant="outline" className="h-8 text-xs gap-1.5" onClick={onRetry}>
                    <Phone className="h-3.5 w-3.5" /> Retry
                  </Button>
                )}
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={onClose}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center gap-3">
              <div className="h-12 w-12 rounded-full bg-muted/60 border border-border flex items-center justify-center text-muted-foreground/60">
                <PhoneOff className="h-6 w-6" />
              </div>
              <h3 className="text-sm font-semibold text-foreground">No call attempts recorded yet</h3>
              <p className="text-xs text-muted-foreground max-w-sm leading-relaxed">
                This contact has not been connected or no call session transcript/logs have been recorded yet.
              </p>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
