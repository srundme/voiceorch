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
        "group relative flex h-full min-h-[7.25rem] w-full flex-col text-left rounded-xl border p-4 cursor-pointer transition-all duration-200",
        "bg-background hover:bg-muted/30",
        active
          ? "border-foreground/25 shadow-sm ring-1 ring-foreground/10"
          : "border-border hover:border-foreground/20",
        className
      )}
    >
      <Pencil className="absolute top-3.5 right-3.5 h-3.5 w-3.5 text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity duration-150" />
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70 mb-2.5">
        <span className="text-muted-foreground/60 [&_svg]:h-3.5 [&_svg]:w-3.5">{icon}</span>
        {label}
      </div>
      <div className="text-[15px] font-semibold text-foreground line-clamp-2 leading-snug tracking-tight">
        {value || "—"}
      </div>
      {subtext && (
        <div className="text-[11px] text-muted-foreground/75 mt-1.5 line-clamp-2">{subtext}</div>
      )}
    </button>
  );
}

/**
 * Shared inline configuration panel that opens beneath an AgentConfigCard.
 * Uses theme tokens so light and dark mode both render correctly.
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
        "rounded-2xl border border-border bg-card p-4 space-y-3 animate-in slide-in-from-top-1 duration-150",
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
 * radius, theme-aware surface, subtle border, soft shadow only, fade+scale
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
      <DialogContent className="p-0 gap-0 w-full sm:max-w-[680px] max-w-[720px] rounded-2xl border border-border bg-card shadow-2xl duration-150 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95 overflow-hidden">
        <DialogHeader className="px-6 py-5 border-b border-border space-y-1">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold text-foreground">
            {icon && <span className="text-muted-foreground/70 [&_svg]:h-4 [&_svg]:w-4">{icon}</span>}
            {title}
          </DialogTitle>
          {description && (
            <DialogDescription className="text-[12.5px]">{description}</DialogDescription>
          )}
        </DialogHeader>
        <div className="px-6 py-5 max-h-[60vh] overflow-y-auto space-y-4 bg-card">
          {children}
        </div>
        <DialogFooter className="px-6 py-4 border-t border-border bg-muted/30">
          <Button type="button" variant="outline" onClick={onRequestClose}>Cancel</Button>
          <Button type="button" onClick={onSave}>{saveLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
