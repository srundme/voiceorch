import { useState, type MouseEvent, type ReactNode } from "react";
import { Link } from "wouter";
import { Check, ChevronRight, Copy, ExternalLink } from "lucide-react";
import { MethodBadge } from "./api/MethodBadge";
import type { HttpMethod } from "./openapi/types";
import { CodeBlock } from "./CodeBlock";

export function PageHeader({
  breadcrumb,
  title,
  description,
  copyText,
  updated,
}: {
  breadcrumb?: string;
  title: string;
  description?: ReactNode;
  copyText?: string;
  updated?: string;
}) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    if (!copyText) return;
    await navigator.clipboard.writeText(copyText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mb-10 not-prose">
      {breadcrumb ? (
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground/80 mb-3">
          {breadcrumb}
        </p>
      ) : null}
      <div className="flex items-start justify-between gap-4">
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-slate-900 m-0">
          {title}
        </h1>
        {copyText ? (
          <button
            type="button"
            onClick={onCopy}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-slate-100 transition-colors"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy page"}
          </button>
        ) : null}
      </div>
      {description ? (
        <p className="mt-4 text-base leading-relaxed text-muted-foreground max-w-2xl">
          {description}
        </p>
      ) : null}
      {updated ? (
        <p className="mt-3 text-xs text-slate-500">Last updated {updated}</p>
      ) : null}
    </div>
  );
}

export function Callout({
  variant = "info",
  title,
  children,
}: {
  variant?: "info" | "warn" | "tip";
  title?: string;
  children: ReactNode;
}) {
  const styles = {
    info: "border-slate-200 bg-slate-50 text-slate-800",
    warn: "border-amber-200 bg-amber-50 text-amber-900",
    tip: "border-emerald-200 bg-emerald-50 text-emerald-900",
  }[variant];

  return (
    <div className={`not-prose my-6 rounded-xl border px-4 py-3.5 text-sm leading-relaxed ${styles}`}>
      {title ? <p className="font-semibold text-slate-900 mb-1.5">{title}</p> : null}
      <div className="[&_a]:underline [&_a]:underline-offset-2 [&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1 [&_code]:py-0.5">
        {children}
      </div>
    </div>
  );
}

export function DocCard({
  href,
  title,
  description,
  icon,
}: {
  href: string;
  title: string;
  description: string;
  icon: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-400 hover:bg-slate-50 transition-colors"
    >
      <div className="mt-0.5 text-slate-700 [&_svg]:h-5 [&_svg]:w-5 shrink-0">{icon}</div>
      <div className="min-w-0">
        <p className="font-semibold text-slate-900">{title}</p>
        <p className="mt-1 text-sm text-slate-600 leading-snug">{description}</p>
      </div>
    </Link>
  );
}

const PLATFORM_URLS = [
  {
    n: "1",
    label: "App",
    url: "https://app.snapserve.ai",
    href: "https://app.snapserve.ai",
    hint: "Dashboard login & product",
    external: true,
  },
  {
    n: "2",
    label: "Docs",
    url: "https://app.snapserve.ai/docs",
    href: "https://app.snapserve.ai/docs",
    hint: "Guides & this documentation",
    external: true,
  },
  {
    n: "3",
    label: "API base URL",
    url: "https://app.snapserve.ai/api",
    // Bare /api is not a webpage — open the reference instead.
    href: "/docs/api-reference",
    hint: "For Bearer sk_live_… requests — not a browser page",
    external: false,
  },
] as const;

function PlatformUrlCard({
  n,
  label,
  url,
  href,
  hint,
  external,
}: (typeof PLATFORM_URLS)[number]) {
  const [copied, setCopied] = useState(false);

  const onCopy = async (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const className =
    "group relative flex h-full min-w-0 flex-col rounded-xl border border-slate-200/90 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all hover:border-slate-300 hover:shadow-[0_4px_12px_rgba(15,23,42,0.06)]";

  const body = (
    <>
      <div className="flex items-center gap-2.5">
        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 text-[11px] font-semibold tabular-nums text-slate-600">
          {n}
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
          {label}
        </span>
      </div>
      <div className="mt-3 flex items-start gap-1.5">
        <p className="min-w-0 flex-1 break-all font-mono text-[12.5px] leading-relaxed tracking-tight text-slate-900">
          {url}
        </p>
        <button
          type="button"
          onClick={onCopy}
          className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-800"
          aria-label={`Copy ${url}`}
          title={copied ? "Copied" : "Copy this URL"}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
      <p className="mt-auto pt-3 text-[12px] leading-snug text-slate-500">{hint}</p>
    </>
  );

  if (external) {
    return (
      <a href={href} target="_blank" rel="noreferrer" title={url} className={className}>
        {body}
      </a>
    );
  }

  return (
    <Link href={href} title={`${url} — open API reference`} className={className}>
      {body}
    </Link>
  );
}

/** Three host cards — full URLs, no horizontal scroll, per-URL + copy-all. */
export function PlatformUrls() {
  const [copiedAll, setCopiedAll] = useState(false);

  const onCopyAll = async () => {
    const text = PLATFORM_URLS.map((h) => h.url).join("\n");
    await navigator.clipboard.writeText(text);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  };

  return (
    <div className="not-prose my-6 overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-slate-50/40 p-4 sm:p-5">
      <div className="mb-4 flex items-center gap-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
          Platform URLs
        </p>
        <button
          type="button"
          onClick={onCopyAll}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-white hover:text-slate-800"
          aria-label="Copy all platform URLs"
          title={copiedAll ? "Copied all" : "Copy all URLs"}
        >
          {copiedAll ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-3.5">
        {PLATFORM_URLS.map((host) => (
          <PlatformUrlCard key={host.url} {...host} />
        ))}
      </div>
    </div>
  );
}

export function ParamsTable({
  rows,
}: {
  rows: { name: string; type: string; required?: boolean; description: string }[];
}) {
  return (
    <div className="not-prose my-5 overflow-x-auto rounded-xl border border-slate-200">
      <table className="w-full text-sm text-left">
        <thead className="text-[11px] uppercase tracking-wider bg-slate-50 text-muted-foreground border-b border-slate-200">
          <tr>
            <th className="px-4 py-2.5 font-semibold">Parameter</th>
            <th className="px-4 py-2.5 font-semibold">Type</th>
            <th className="px-4 py-2.5 font-semibold">Description</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name} className="border-b border-slate-100 last:border-0">
              <td className="px-4 py-3 align-top">
                <code className="text-xs text-slate-800">{row.name}</code>
                {row.required ? (
                  <span className="ml-2 text-[10px] uppercase text-rose-600">required</span>
                ) : null}
              </td>
              <td className="px-4 py-3 align-top font-mono text-xs text-muted-foreground">
                {row.type}
              </td>
              <td className="px-4 py-3 align-top text-muted-foreground">{row.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Endpoint({
  id,
  method,
  path,
  title,
  opId,
  children,
}: {
  id: string;
  method: HttpMethod;
  path: string;
  title: string;
  opId?: string;
  children?: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const full = `https://app.snapserve.ai/api${path.startsWith("/") ? path : `/${path}`}`;

  const onCopy = async () => {
    await navigator.clipboard.writeText(`${method.toUpperCase()} ${full}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="not-prose my-10 scroll-mt-24">
      <div className="flex flex-wrap items-center gap-3 mb-2">
        <MethodBadge method={method} size="md" />
        <h2 id={id} className="text-xl font-semibold text-slate-900 m-0">
          {title}
        </h2>
        {opId ? (
          <Link
            href={`/docs/api-reference/${opId}`}
            className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-slate-900 transition-colors"
          >
            Full schema <ChevronRight className="h-3 w-3" />
          </Link>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onCopy}
        className="group flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-left hover:border-slate-300 transition-colors"
        title="Copy method + URL"
      >
        <code className="text-[13px] font-mono text-slate-800 truncate">
          <span className="text-muted-foreground">{method.toUpperCase()}</span>{" "}
          {full}
        </code>
        <span className="ml-auto shrink-0 text-muted-foreground group-hover:text-foreground">
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </span>
      </button>
      {children ? (
        <div className="mt-4 space-y-1 [&_p]:text-sm [&_p]:text-slate-600 [&_p]:leading-relaxed [&_ul]:text-sm [&_ul]:text-slate-600">
          {children}
        </div>
      ) : null}
    </section>
  );
}

export function LanguageTabs({
  tabs,
}: {
  tabs: { label: string; language: string; code: string }[];
}) {
  const [active, setActive] = useState(0);
  return (
    <div className="not-prose my-6">
      <div className="flex gap-1 rounded-t-xl border border-b-0 border-slate-200 bg-slate-50 px-2 pt-2">
        {tabs.map((tab, i) => (
          <button
            key={tab.label}
            type="button"
            onClick={() => setActive(i)}
            className={`rounded-t-md px-3 py-1.5 text-xs font-medium transition-colors ${
              active === i
                ? "bg-white text-slate-900 border border-slate-200 border-b-transparent -mb-px"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="[&>div]:mt-0 [&>div]:rounded-t-none">
        <CodeBlock code={tabs[active].code} language={tabs[active].language} />
      </div>
    </div>
  );
}

export function ExternalFooterLink({
  href,
  children,
  icon,
}: {
  href: string;
  children: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-muted-foreground hover:text-foreground hover:bg-slate-100 transition-colors"
    >
      {icon}
      <span className="flex-1">{children}</span>
      <ExternalLink className="h-3 w-3 opacity-50" />
    </a>
  );
}
