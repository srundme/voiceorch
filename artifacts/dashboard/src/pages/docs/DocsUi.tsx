import { useState, type ReactNode } from "react";
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
}: {
  breadcrumb?: string;
  title: string;
  description?: ReactNode;
  copyText?: string;
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
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-white m-0">
          {title}
        </h1>
        {copyText ? (
          <button
            type="button"
            onClick={onCopy}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-colors"
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
    info: "border-sky-500/30 bg-sky-500/5 text-sky-100/90",
    warn: "border-amber-500/35 bg-amber-500/10 text-amber-50/90",
    tip: "border-emerald-500/30 bg-emerald-500/5 text-emerald-50/90",
  }[variant];

  return (
    <div className={`not-prose my-6 rounded-xl border px-4 py-3.5 text-sm leading-relaxed ${styles}`}>
      {title ? <p className="font-semibold text-foreground mb-1.5">{title}</p> : null}
      <div className="[&_a]:underline [&_a]:underline-offset-2 [&_code]:rounded [&_code]:bg-black/30 [&_code]:px-1 [&_code]:py-0.5">
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
      className="group relative flex flex-col items-center text-center gap-3 rounded-xl border border-white/10 bg-[#111114]/80 p-6 hover:border-sky-400/40 hover:bg-[#16161a] transition-all overflow-hidden"
    >
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-[radial-gradient(circle_at_50%_0%,rgba(56,189,248,0.12),transparent_60%)]" />
      <div className="relative text-sky-300/90 [&_svg]:h-6 [&_svg]:w-6">{icon}</div>
      <div className="relative">
        <p className="font-semibold text-white group-hover:text-sky-200 transition-colors">{title}</p>
        <p className="mt-1.5 text-sm text-muted-foreground leading-snug">{description}</p>
      </div>
    </Link>
  );
}

export function ParamsTable({
  rows,
}: {
  rows: { name: string; type: string; required?: boolean; description: string }[];
}) {
  return (
    <div className="not-prose my-5 overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full text-sm text-left">
        <thead className="text-[11px] uppercase tracking-wider bg-white/[0.03] text-muted-foreground border-b border-white/10">
          <tr>
            <th className="px-4 py-2.5 font-semibold">Parameter</th>
            <th className="px-4 py-2.5 font-semibold">Type</th>
            <th className="px-4 py-2.5 font-semibold">Description</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name} className="border-b border-white/5 last:border-0">
              <td className="px-4 py-3 align-top">
                <code className="text-xs text-sky-300">{row.name}</code>
                {row.required ? (
                  <span className="ml-2 text-[10px] uppercase text-rose-400/90">required</span>
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
        <h2 id={id} className="text-xl font-semibold text-white m-0">
          {title}
        </h2>
        {opId ? (
          <Link
            href={`/docs/api-reference/${opId}`}
            className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-sky-300 transition-colors"
          >
            Full schema <ChevronRight className="h-3 w-3" />
          </Link>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onCopy}
        className="group flex w-full items-center gap-2 rounded-lg border border-white/10 bg-[#0c0c0f] px-3 py-2.5 text-left hover:border-white/20 transition-colors"
        title="Copy method + URL"
      >
        <code className="text-[13px] font-mono text-zinc-200 truncate">
          <span className="text-muted-foreground">{method.toUpperCase()}</span>{" "}
          {full}
        </code>
        <span className="ml-auto shrink-0 text-muted-foreground group-hover:text-foreground">
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </span>
      </button>
      {children ? (
        <div className="mt-4 space-y-1 [&_p]:text-sm [&_p]:text-zinc-400 [&_p]:leading-relaxed [&_ul]:text-sm [&_ul]:text-zinc-400">
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
      <div className="flex gap-1 rounded-t-xl border border-b-0 border-white/10 bg-white/[0.03] px-2 pt-2">
        {tabs.map((tab, i) => (
          <button
            key={tab.label}
            type="button"
            onClick={() => setActive(i)}
            className={`rounded-t-md px-3 py-1.5 text-xs font-medium transition-colors ${
              active === i
                ? "bg-[#0c0c0f] text-white border border-white/10 border-b-transparent -mb-px"
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
      className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-muted-foreground hover:text-foreground hover:bg-white/[0.04] transition-colors"
    >
      {icon}
      <span className="flex-1">{children}</span>
      <ExternalLink className="h-3 w-3 opacity-50" />
    </a>
  );
}
