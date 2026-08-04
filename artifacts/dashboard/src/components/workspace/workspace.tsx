import type { ElementType, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type WorkspaceNavItem<T extends string = string> = {
  id: T;
  label: string;
  icon?: ElementType;
  badge?: string | number;
};

export type WorkspaceNavGroup<T extends string = string> = {
  label: string;
  items: WorkspaceNavItem<T>[];
};

export function StatusDot({
  tone = "neutral",
  className,
}: {
  tone?: "neutral" | "success" | "warning" | "danger";
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-full",
        tone === "success" && "bg-emerald-500",
        tone === "warning" && "bg-amber-500",
        tone === "danger" && "bg-rose-500",
        tone === "neutral" && "bg-muted-foreground/45",
        className,
      )}
    />
  );
}

export function WorkspaceHeader({
  eyebrow,
  title,
  description,
  meta,
  actions,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex min-h-14 shrink-0 items-center justify-between gap-4 border-b border-border/70 bg-background px-4 sm:px-5",
        className,
      )}
    >
      <div className="min-w-0 py-2.5">
        {eyebrow && (
          <div className="mb-0.5 text-[10px] font-medium uppercase tracking-[0.13em] text-muted-foreground">
            {eyebrow}
          </div>
        )}
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate text-sm font-semibold tracking-[-0.01em]">{title}</h1>
          {meta}
        </div>
        {description && (
          <p className="mt-0.5 max-w-2xl truncate text-[11px] text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
    </header>
  );
}

export function WorkspaceSectionNav<T extends string>({
  groups,
  activeId,
  onSelect,
  footer,
  className,
}: {
  groups: WorkspaceNavGroup<T>[];
  activeId: T;
  onSelect: (id: T) => void;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <nav
      aria-label="Workspace sections"
      className={cn(
        "flex h-full w-[208px] shrink-0 flex-col border-r border-border/70 bg-muted/[0.12]",
        className,
      )}
    >
      <div className="flex-1 overflow-y-auto px-2 py-3">
        {groups.map((group, groupIndex) => (
          <div key={group.label} className={cn(groupIndex > 0 && "mt-4")}>
            <p className="mb-1 px-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/65">
              {group.label}
            </p>
            <div className="space-y-px">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = item.id === activeId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelect(item.id)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] transition-colors",
                      active
                        ? "bg-foreground/[0.065] font-medium text-foreground"
                        : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground",
                    )}
                  >
                    {Icon && (
                      <Icon
                        className={cn(
                          "size-3.5 shrink-0",
                          active ? "text-foreground" : "text-muted-foreground/75 group-hover:text-foreground",
                        )}
                      />
                    )}
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.badge != null && (
                      <span className="text-[9px] tabular-nums text-muted-foreground">
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {footer && <div className="border-t border-border/70 p-2">{footer}</div>}
    </nav>
  );
}

/** Flat horizontal section strip — one row, no nested side rail. */
export function WorkspaceSegmentNav<T extends string>({
  items,
  activeId,
  onSelect,
  className,
}: {
  items: WorkspaceNavItem<T>[];
  activeId: T;
  onSelect: (id: T) => void;
  className?: string;
}) {
  return (
    <nav
      aria-label="Editor sections"
      className={cn(
        "flex h-10 shrink-0 items-stretch gap-0 overflow-x-auto border-b border-border/70 px-3 sm:px-5",
        className,
      )}
    >
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative shrink-0 px-3 text-[12px] transition-colors",
              active
                ? "font-medium text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
            {active && (
              <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-foreground" />
            )}
          </button>
        );
      })}
    </nav>
  );
}

export function WorkspaceInspector({
  title,
  children,
  footer,
  className,
}: {
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <aside
      className={cn(
        "flex h-full w-[296px] shrink-0 flex-col border-l border-border/70 bg-muted/[0.1]",
        className,
      )}
    >
      {title && (
        <div className="flex h-11 shrink-0 items-center border-b border-border/70 px-3.5 text-[10px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">
          {title}
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-3.5">{children}</div>
      {footer && <div className="border-t border-border/70 p-3">{footer}</div>}
    </aside>
  );
}

export function SectionGroup({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("border-b border-border/60 py-5 last:border-b-0", className)}>
      {(title || description || actions) && (
        <div className="mb-3 flex items-start justify-between gap-4">
          <div className="min-w-0">
            {title && <h2 className="text-[12px] font-semibold">{title}</h2>}
            {description && (
              <p className="mt-0.5 max-w-xl text-[11px] leading-relaxed text-muted-foreground">
                {description}
              </p>
            )}
          </div>
          {actions && <div className="shrink-0">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function PropertyRow({
  label,
  description,
  children,
  className,
}: {
  label: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-2 border-b border-border/50 py-3 last:border-b-0 sm:grid-cols-[minmax(150px,0.42fr)_minmax(240px,1fr)] sm:gap-6",
        className,
      )}
    >
      <div>
        <div className="text-[11px] font-medium">{label}</div>
        {description && (
          <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
