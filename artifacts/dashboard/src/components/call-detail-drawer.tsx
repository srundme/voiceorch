import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { CallDetailContent } from "@/pages/calls/[id]";

interface CallDetailDrawerProps {
  open: boolean;
  onClose: () => void;
  callId: number | null;
  leadName?: string | null;
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
  currentIndex,
  totalCount,
  onPrev,
  onNext,
  prevLabel,
  nextLabel,
}: CallDetailDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <SheetContent
        side="right"
        className="!p-0 w-[min(95vw,_940px)] sm:max-w-none flex flex-col overflow-hidden [&>button:first-child]:hidden"
      >
        <SheetTitle className="sr-only">
          {leadName ? `Call — ${leadName}` : "Call Detail"}
        </SheetTitle>
        {callId != null && (
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
        )}
      </SheetContent>
    </Sheet>
  );
}
