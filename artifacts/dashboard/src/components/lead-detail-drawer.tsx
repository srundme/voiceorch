import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { LeadCrmWorkspaceContent } from "@/pages/campaigns/[id]/leads/[leadId]";

interface LeadDetailDrawerProps {
  open: boolean;
  onClose: () => void;
  campaignId: number;
  leadId: number | null;
  leadName?: string | null;
}

export function LeadDetailDrawer({
  open,
  onClose,
  campaignId,
  leadId,
  leadName,
}: LeadDetailDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent
        side="right"
        className="!p-0 w-[min(95vw,_980px)] sm:max-w-none flex flex-col overflow-hidden [&>button:first-child]:hidden bg-background border-l border-border shadow-2xl"
      >
        <SheetTitle className="sr-only">
          {leadName ? `Lead — ${leadName}` : "Lead Profile"}
        </SheetTitle>
        {leadId != null && (
          <div className="flex-1 overflow-hidden min-h-0 flex flex-col">
            <LeadCrmWorkspaceContent
              campaignId={campaignId}
              leadId={leadId}
              drawerMode
              onClose={onClose}
            />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
