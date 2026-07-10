import React from "react";
import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

/**
 * Shared "premium" configuration card used for Transcriber / Model / Voice
 * (and any equivalent configuration summary) across the Agent pages.
 *
 * Visual language: monochrome icon + uppercase type label, provider name as
 * a subtext, and the selected value as the large bold focal point. Editing
 * is a low-emphasis icon button that only appears on hover.
 */
export function AgentConfigCard({
  icon,
  label,
  value,
  subtext,
  active = false,
  onClick,
  className,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  subtext?: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative text-left rounded-2xl border p-5 cursor-pointer transition-colors duration-150 bg-[#111111]",
        active
          ? "border-white/25"
          : "border-white/10 hover:border-white/20",
        className
      )}
    >
      <Pencil className="absolute top-4 right-4 h-3.5 w-3.5 text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity duration-150" />
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2.5">
        <span className="text-muted-foreground/70 [&_svg]:h-3.5 [&_svg]:w-3.5">{icon}</span>
        {label}
      </div>
      <div className="text-base font-semibold text-foreground truncate leading-snug">
        {value || "—"}
      </div>
      {subtext && (
        <div className="text-[11px] text-muted-foreground mt-1 truncate">{subtext}</div>
      )}
    </button>
  );
}

/**
 * Shared inline configuration panel that opens beneath an AgentConfigCard.
 * Neutral background/border to match the card's monochrome language.
 */
export function AgentConfigPanel({
  icon,
  title,
  children,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-white/10 bg-[#111111] p-4 space-y-3 animate-in slide-in-from-top-1 duration-150",
        className
      )}
    >
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {icon && <span className="text-muted-foreground/70 [&_svg]:h-3.5 [&_svg]:w-3.5">{icon}</span>}
        {title}
      </div>
      {children}
    </div>
  );
}

/**
 * Premium centered edit dialog shell shared by the Transcriber / Model /
 * Voice configuration modals. Matches an enterprise dashboard aesthetic
 * (Stripe/Linear/Vercel/GitHub Settings style): centered ~680px card, 16px
 * radius, dark neutral surface, subtle border, soft shadow only, fade+scale
 * entrance, header + scrollable body + sticky footer.
 *
 * Dismissal (outside click, ESC, close icon) always routes through
 * `onRequestClose` so the caller can guard against discarding unsaved
 * changes; "Save Changes" calls `onSave` directly.
 */
export function EditConfigDialog({
  open,
  onRequestClose,
  title,
  description,
  icon,
  children,
  onSave,
  saveLabel = "Save Changes",
}: {
  open: boolean;
  onRequestClose: () => void;
  title: string;
  description?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  onSave: () => void;
  saveLabel?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onRequestClose(); }}>
      <DialogContent className="p-0 gap-0 w-full sm:max-w-[680px] max-w-[720px] rounded-2xl border border-white/10 bg-[#111111] shadow-2xl duration-150 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95 overflow-hidden">
        <DialogHeader className="px-6 py-5 border-b border-white/10 space-y-1">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            {icon && <span className="text-muted-foreground/70 [&_svg]:h-4 [&_svg]:w-4">{icon}</span>}
            {title}
          </DialogTitle>
          {description && (
            <DialogDescription className="text-[12.5px]">{description}</DialogDescription>
          )}
        </DialogHeader>
        <div className="px-6 py-5 max-h-[60vh] overflow-y-auto space-y-4">
          {children}
        </div>
        <DialogFooter className="px-6 py-4 border-t border-white/10 bg-[#111111]">
          <Button type="button" variant="outline" onClick={onRequestClose}>Cancel</Button>
          <Button type="button" onClick={onSave}>{saveLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
