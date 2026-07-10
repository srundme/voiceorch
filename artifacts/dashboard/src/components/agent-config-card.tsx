import React from "react";
import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";

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
