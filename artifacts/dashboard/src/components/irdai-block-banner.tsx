import { ShieldAlert } from "lucide-react";
import { IRDAI_BLOCKED_MESSAGE, type IrdaiMissingItem } from "@/lib/irdai-block";

/**
 * Banner shown on call-initiation surfaces when an agent is blocked by IRDAI
 * non-compliance. Displays the standard message followed by the specific
 * missing-disclosure items.
 */
export function IrdaiBlockBanner({
  missingItems,
  message = IRDAI_BLOCKED_MESSAGE,
  compact = false,
  className = "",
}: {
  missingItems: IrdaiMissingItem[];
  message?: string;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`rounded-lg border border-destructive/30 bg-destructive/10 ${compact ? "px-3 py-2" : "px-4 py-3"} space-y-1.5 ${className}`}
      role="alert"
    >
      <div className="flex items-start gap-2">
        <ShieldAlert className={`${compact ? "h-3.5 w-3.5" : "h-4 w-4"} text-destructive shrink-0 mt-0.5`} />
        <p className={`${compact ? "text-[11.5px]" : "text-sm"} font-medium text-destructive`}>{message}</p>
      </div>
      {missingItems.length > 0 && (
        <ul className={`list-disc ${compact ? "pl-7 text-[11px]" : "pl-9 text-[12.5px]"} space-y-0.5 text-destructive/90`}>
          {missingItems.map((m) => (
            <li key={m.requirement || m.detail}>{m.detail}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
