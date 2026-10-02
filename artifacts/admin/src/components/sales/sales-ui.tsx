import { cloneElement, isValidElement, useId, useState, type ReactNode } from "react";
import { AlertTriangle, Check, Copy, Lock, Mail, MapPin, MessageCircle, Phone, RefreshCw, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useDebounce } from "@/hooks/use-debounce";
import { useCompanies, useTeam, useTeamDirectory } from "@/hooks/use-sales-api";
import { useDemoFlag } from "@/components/sales/sales-context";
import { isSalesApiError, salesErrorMessages, salesErrorText } from "@/lib/sales-api";
import { formatPercent } from "@/lib/sales-format";
import { mailtoLink, mapsLink, telLink, whatsappIntro, whatsappLink } from "@/lib/sales-links";
import type { PilotStatus, Rate, Ratio, Stage } from "@/lib/sales-types";

/** Inputs and buttons get ≥44px touch targets on phones, compact on desktop. */
export const touch = "min-h-11 md:min-h-9";

export function SectionCard({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("rounded-lg border border-border bg-card", className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold">{title}</h2>}
            {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export function SalesPageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight md:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function LoadingBlock({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)} aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

export function ErrorBlock({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  const forbidden = isSalesApiError(error) && error.status === 403;
  return (
    <Alert variant={forbidden ? "default" : "destructive"} className={className}>
      {forbidden ? <Lock className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
      <AlertTitle>{forbidden ? "Not available for your role" : "Could not load"}</AlertTitle>
      <AlertDescription>
        <ul className="list-disc space-y-0.5 pl-4">
          {salesErrorMessages(error).map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
        {onRetry && !forbidden && (
          <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Retry
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

/** Server validation messages, shown verbatim. */
export function ServerErrors({ error, className }: { error: unknown; className?: string }) {
  if (!error) return null;
  const messages = salesErrorMessages(error);
  return (
    <Alert variant="destructive" className={className} role="alert">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>{isSalesApiError(error) && error.status === 403 ? "Not allowed" : "Please fix the following"}</AlertTitle>
      <AlertDescription>
        <ul className="list-disc space-y-0.5 pl-4">
          {messages.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

export function EmptyBlock({ title, description, action, className }: { title: string; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-md border border-dashed border-border px-4 py-6 text-center", className)}>
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
      {action && <div className="mt-3 flex justify-center">{action}</div>}
    </div>
  );
}

type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "muted";
const TONES: Record<Tone, string> = {
  neutral: "border-border bg-muted text-foreground",
  accent: "border-[hsl(var(--sales-accent)/0.4)] bg-[hsl(var(--sales-accent)/0.12)] text-[hsl(var(--sales-accent))]",
  success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  warning: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  danger: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
  muted: "border-border bg-transparent text-muted-foreground",
};

export function Pill({ tone = "neutral", children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] font-medium", TONES[tone], className)}>
      {children}
    </span>
  );
}

export function stageTone(stage: Stage | string | null | undefined): Tone {
  switch (stage) {
    case "Paid":
    case "Live":
      return "success";
    case "Lost":
      return "danger";
    case "Later":
      return "muted";
    case "Pilot running":
    case "Pilot ready":
    case "Results reviewed":
    case "Proposal":
      return "accent";
    default:
      return "neutral";
  }
}

export function StageBadge({ stage }: { stage: Stage | string | null | undefined }) {
  if (!stage) return <Pill tone="muted">No opportunity</Pill>;
  return <Pill tone={stageTone(stage)}>{stage}</Pill>;
}

export function PilotStatusBadge({ status }: { status: PilotStatus | string }) {
  const tone: Tone =
    status === "Calling" || status === "Setup" ? "accent" : status === "Review due" ? "warning" : status === "Completed" ? "success" : status === "Cancelled" ? "danger" : "neutral";
  return <Pill tone={tone}>{status}</Pill>;
}

export function StatusBadge({ status }: { status: string }) {
  const tone: Tone = ["verified", "accepted", "active", "done", "completed", "live", "upcoming"].includes(status)
    ? "success"
    : ["rejected", "declined", "cancelled", "overdue", "no_show"].includes(status)
      ? "danger"
      : ["recorded", "sent", "paused", "scheduled", "review"].includes(status)
        ? "warning"
        : "neutral";
  return <Pill tone={tone}>{status.replace(/_/g, " ")}</Pill>;
}

export function PriorityBadge({ priority }: { priority: string }) {
  return <Pill tone={priority === "high" ? "danger" : priority === "low" ? "muted" : "neutral"}>{priority}</Pill>;
}

export function DemoTag() {
  return <Pill tone="warning">DEMO</Pill>;
}

/** Progress bar for actual vs target. `value` is a 0..1 ratio or null when the denominator is 0. */
export function Meter({ value, className, tone = "accent" }: { value: number | null; className?: string; tone?: "accent" | "warning" | "danger" | "success" }) {
  const pct = value == null ? 0 : Math.max(0, Math.min(1, value)) * 100;
  const color =
    tone === "danger" ? "bg-red-500" : tone === "warning" ? "bg-amber-500" : tone === "success" ? "bg-emerald-500" : "bg-[hsl(var(--sales-accent))]";
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn("h-full rounded-full transition-all", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function RatioText({ ratio }: { ratio: Ratio }) {
  return <span title={ratio.label}>{ratio.value == null ? "n/a" : formatPercent(ratio.value)}</span>;
}

/** Rate with its denominator always visible; 0 denominators read "n/a". */
export function RateText({ rate, className }: { rate: Rate | null | undefined; className?: string }) {
  if (!rate) return <span className={className}>—</span>;
  return (
    <span className={className} title={rate.label}>
      {rate.value == null ? "n/a" : formatPercent(rate.value, 1)}{" "}
      <span className="text-muted-foreground">
        ({rate.numerator}/{rate.denominator})
      </span>
    </span>
  );
}

export function KindLabel({ kind }: { kind: "actual" | "target" | "forecast" }) {
  return (
    <span
      className={cn(
        "text-[10px] font-semibold uppercase tracking-wider",
        kind === "actual" ? "text-foreground" : kind === "target" ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400",
      )}
    >
      {kind}
    </span>
  );
}

const LABELLABLE_TAGS = new Set(["input", "textarea", "select"]);

/**
 * Labelled form row. A single input-like child is given an id (unless it has one) so the label
 * becomes its accessible name; wrappers such as plain divs are left alone.
 */
export function Field({ label, hint, children, className, htmlFor, required }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string; htmlFor?: string; required?: boolean }) {
  const autoId = useId();
  let control = children;
  let target = htmlFor;
  if (!target && isValidElement<{ id?: string }>(children)) {
    const labellable = typeof children.type !== "string" || LABELLABLE_TAGS.has(children.type);
    if (labellable) {
      target = children.props.id ?? autoId;
      if (!children.props.id) control = cloneElement(children, { id: autoId });
    }
  }
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={target} className="text-xs font-medium">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </Label>
      {control}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function useSalesToast() {
  const { toast } = useToast();
  return {
    success: (title: string, description?: string) => toast({ title, description }),
    error: (err: unknown, title = "Action failed") => toast({ title, description: salesErrorText(err), variant: "destructive" }),
  };
}

function ActionLink({ href, label, icon, compact, external }: { href: string; label: string; icon: ReactNode; compact?: boolean; external?: boolean }) {
  return (
    <Button asChild variant="outline" size={compact ? "icon" : "sm"} className={cn(compact ? "h-11 w-11 md:h-9 md:w-9" : "min-h-11 md:min-h-8")}>
      <a href={href} target={external ? "_blank" : undefined} rel={external ? "noopener noreferrer" : undefined} aria-label={label} title={label}>
        {icon}
        {!compact && <span className="ml-1.5">{label}</span>}
      </a>
    </Button>
  );
}

/** Call / WhatsApp / email links. WhatsApp opens the external app with a draft — it never sends anything. */
export function ContactActions({
  phone,
  email,
  contactName,
  senderName,
  compact,
}: {
  phone?: string | null;
  email?: string | null;
  contactName?: string | null;
  senderName?: string | null;
  compact?: boolean;
}) {
  const demo = useDemoFlag();
  const tel = telLink(phone);
  const wa = whatsappLink(phone, whatsappIntro(contactName, senderName));
  const mail = mailtoLink(email);
  if (!tel && !wa && !mail) return <span className="text-xs text-muted-foreground">No phone or email</span>;
  if (demo) return <span className="text-xs text-muted-foreground">Contact links are off in demo mode</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {tel && <ActionLink href={tel} label="Call" icon={<Phone className="h-4 w-4" />} compact={compact} />}
      {wa && <ActionLink href={wa} label="WhatsApp" icon={<MessageCircle className="h-4 w-4" />} compact={compact} external />}
      {mail && <ActionLink href={mail} label="Email" icon={<Mail className="h-4 w-4" />} compact={compact} />}
    </div>
  );
}

export function MapsAction({ company, compact }: { company: Parameters<typeof mapsLink>[0]; compact?: boolean }) {
  const href = mapsLink(company);
  if (!href) return null;
  return <ActionLink href={href} label="Map" icon={<MapPin className="h-4 w-4" />} compact={compact} external />;
}

export function useTeamNames() {
  const team = useTeamDirectory();
  const names = new Map(
    (team.data ?? []).map((u) => [u.id, `${u.name || u.email}${u.status && u.status !== "active" ? " (deactivated)" : ""}`]),
  );
  return (id: number | null | undefined) => (id == null ? "Unassigned" : names.get(id) ?? `User #${id}`);
}

export function OwnerSelect({
  value,
  onChange,
  allowUnassigned = true,
  placeholder = "Owner",
  className,
  disabled,
  id,
  "aria-label": ariaLabel,
}: {
  value: number | null | undefined;
  onChange: (id: number | null) => void;
  allowUnassigned?: boolean;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
}) {
  const team = useTeam();
  return (
    <Select
      value={value != null ? String(value) : allowUnassigned ? "none" : ""}
      onValueChange={(v) => onChange(v === "none" || v === "" ? null : Number(v))}
      disabled={disabled}
    >
      <SelectTrigger id={id} aria-label={ariaLabel} className={cn(touch, className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowUnassigned && <SelectItem value="none">Unassigned</SelectItem>}
        {(team.data ?? []).map((u) => (
          <SelectItem key={u.id} value={String(u.id)}>
            {u.name || u.email}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function SimpleSelect<T extends string>({
  value,
  onChange,
  options,
  placeholder,
  className,
  allowAll,
  allLabel = "All",
  disabled,
  id,
  "aria-label": ariaLabel,
}: {
  value: T | "" | undefined;
  onChange: (v: T | "") => void;
  options: ReadonlyArray<T | { value: T; label: string }>;
  placeholder?: string;
  className?: string;
  allowAll?: boolean;
  allLabel?: string;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
}) {
  return (
    <Select value={value ? value : allowAll ? "__all" : undefined} onValueChange={(v) => onChange(v === "__all" ? "" : (v as T))} disabled={disabled}>
      <SelectTrigger id={id} aria-label={ariaLabel} className={cn(touch, className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {allowAll && <SelectItem value="__all">{allLabel}</SelectItem>}
        {options.map((o) => {
          const opt = typeof o === "string" ? { value: o, label: o.replace(/_/g, " ") } : o;
          return (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

/** Search-as-you-type company chooser for quick-entry dialogs. */
export function CompanyPicker({
  value,
  onChange,
  autoFocus,
  id,
}: {
  value: { id: number; name: string } | null;
  onChange: (c: { id: number; name: string } | null) => void;
  autoFocus?: boolean;
  id?: string;
}) {
  const [q, setQ] = useState("");
  const debounced = useDebounce(q, 250);
  const results = useCompanies({ q: debounced, pageSize: 8 }, !value && debounced.trim().length >= 2);

  if (value) {
    return (
      <div className={cn("flex items-center justify-between gap-2 rounded-md border border-border px-3", touch)}>
        <span className="truncate text-sm font-medium">{value.name}</span>
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
          Change
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input id={id} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search company, area or phone…" className={cn("pl-8", touch)} autoFocus={autoFocus} />
      </div>
      {debounced.trim().length >= 2 && (
        <div className="max-h-56 overflow-y-auto rounded-md border border-border">
          {results.isLoading && <p className="p-3 text-xs text-muted-foreground">Searching…</p>}
          {results.error && <p className="p-3 text-xs text-red-500">{salesErrorText(results.error)}</p>}
          {results.data?.items.length === 0 && <p className="p-3 text-xs text-muted-foreground">No matches. Add the company first.</p>}
          {results.data?.items.map((c) => (
            <button
              key={c.id}
              type="button"
              className="flex w-full items-center justify-between gap-2 border-b border-border px-3 py-2.5 text-left text-sm last:border-0 hover:bg-muted"
              onClick={() => onChange({ id: c.id, name: c.name })}
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">{c.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{[c.area, c.city].filter(Boolean).join(", ") || "—"}</span>
              </span>
              <StageBadge stage={c.stage} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function MoneyInput({ value, onChange, id, placeholder, className }: { value: string; onChange: (v: string) => void; id?: string; placeholder?: string; className?: string }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">₹</span>
      <Input id={id} inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={cn("pl-7", touch, className)} />
    </div>
  );
}

export function CopyField({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2">
      <Input readOnly value={value} className={cn("font-mono text-xs", touch)} onFocus={(e) => e.currentTarget.select()} />
      <Button
        type="button"
        variant="outline"
        className={touch}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? <Check className="mr-1.5 h-4 w-4" /> : <Copy className="mr-1.5 h-4 w-4" />}
        {copied ? "Copied" : label}
      </Button>
    </div>
  );
}

/** Confirm dialog that collects a reason (required or optional) before running an action. */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  label = "Reason",
  required = true,
  confirmLabel = "Confirm",
  destructive,
  pending,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: ReactNode;
  label?: string;
  required?: boolean;
  confirmLabel?: string;
  destructive?: boolean;
  pending?: boolean;
  error?: unknown;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setReason("");
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (required && !reason.trim()) return;
            onConfirm(reason.trim());
          }}
        >
          <Field label={label} required={required}>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} autoFocus />
          </Field>
          <ServerErrors error={error} />
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" className={touch} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant={destructive ? "destructive" : "default"} className={touch} disabled={pending || (required && !reason.trim())}>
              {pending ? "Saving…" : confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function FounderOnlyNote({ children = "Founder only" }: { children?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
      <Lock className="h-3 w-3" /> {children}
    </span>
  );
}

export function DataTable({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("overflow-x-auto rounded-md border border-border", className)}>{children}</div>;
}
