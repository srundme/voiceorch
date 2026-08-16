import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  NAV_GROUPS,
  groupForLocation,
  isNavActive,
  type NavGroupId,
} from "@/lib/nav-config";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

const STORAGE_KEY = "admin-nav-open-v1";

function loadOpen(): Record<NavGroupId, boolean> {
  const defaults = Object.fromEntries(
    NAV_GROUPS.map((g) => [g.id, g.defaultOpen]),
  ) as Record<NavGroupId, boolean>;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return defaults;
  }
}

export function NavTree({ onNavigate }: { onNavigate?: () => void }) {
  const [location] = useLocation();
  const [openMap, setOpenMap] = useState<Record<NavGroupId, boolean>>(loadOpen);
  const activeGroup = groupForLocation(location);

  useEffect(() => {
    if (!activeGroup) return;
    setOpenMap((prev) => {
      if (prev[activeGroup]) return prev;
      const next = { ...prev, [activeGroup]: true };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, [activeGroup]);

  function toggle(id: NavGroupId, next: boolean) {
    setOpenMap((prev) => {
      const value = { ...prev, [id]: next };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      return value;
    });
  }

  return (
    <div className="space-y-3">
      {NAV_GROUPS.map((group) => (
        <Collapsible
          key={group.id}
          open={openMap[group.id]}
          onOpenChange={(next) => toggle(group.id, next)}
        >
          <CollapsibleTrigger
            className={cn(
              "flex w-full items-center justify-between px-3 py-1.5 rounded-md cursor-pointer",
              "text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground",
              "hover:text-foreground hover:bg-muted/50 transition-colors duration-200",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            <span>{group.label}</span>
            <ChevronDown
              className={cn(
                "h-3.5 w-3.5 transition-transform duration-200",
                openMap[group.id] ? "rotate-0" : "-rotate-90",
              )}
              aria-hidden
            />
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-0.5 space-y-0.5">
            {group.items.map((item) => {
              const active = isNavActive(location, item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  className={cn(
                    "flex items-center px-3 py-1.5 rounded-md text-[13px] font-medium cursor-pointer transition-colors duration-200",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                  data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                  aria-current={active ? "page" : undefined}
                >
                  <Icon
                    className={cn("h-4 w-4 mr-2.5 shrink-0", active ? "opacity-100 text-primary" : "opacity-70")}
                    aria-hidden
                  />
                  {item.label}
                </Link>
              );
            })}
          </CollapsibleContent>
        </Collapsible>
      ))}
    </div>
  );
}
