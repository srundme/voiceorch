import { Link } from "wouter";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { adjacentDocsPages, hrefForSlug } from "./docs-nav";

export function DocsPager({ slug }: { slug: string }) {
  const { prev, next } = adjacentDocsPages(slug);
  if (!prev && !next) return null;

  return (
    <nav
      aria-label="Docs pagination"
      className="not-prose mt-16 grid gap-3 border-t border-slate-200 pt-8 @[480px]/docs:grid-cols-2"
    >
      {prev ? (
        <Link
          href={hrefForSlug(prev.slug)}
          className="group flex flex-col rounded-xl border border-slate-200 bg-white px-4 py-3.5 transition-colors hover:border-slate-300 hover:bg-slate-50"
        >
          <span className="inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-slate-500">
            <ArrowLeft className="h-3 w-3" /> Previous
          </span>
          <span className="mt-1 text-sm font-semibold text-slate-900 group-hover:text-slate-700">
            {prev.title}
          </span>
        </Link>
      ) : (
        <div className="hidden @[480px]/docs:block" />
      )}
      {next ? (
        <Link
          href={hrefForSlug(next.slug)}
          className="group flex flex-col items-end rounded-xl border border-slate-200 bg-white px-4 py-3.5 text-right transition-colors hover:border-slate-300 hover:bg-slate-50"
        >
          <span className="inline-flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-slate-500">
            Next <ArrowRight className="h-3 w-3" />
          </span>
          <span className="mt-1 text-sm font-semibold text-slate-900 group-hover:text-slate-700">
            {next.title}
          </span>
        </Link>
      ) : null}
    </nav>
  );
}
