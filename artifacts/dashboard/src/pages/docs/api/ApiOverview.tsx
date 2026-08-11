import { useEffect } from "react";
import { Link } from "wouter";
import { getApiTitle, getOperations, getServerUrl, getTagGroups, tagLabel } from "../openapi/spec";
import { MethodBadge } from "./MethodBadge";

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 id={id} className="scroll-mt-24 text-xl font-semibold tracking-tight">
        {title}
      </h2>
      <div className="space-y-3 text-[15px] text-muted-foreground leading-relaxed">{children}</div>
    </section>
  );
}

export function ApiOverview() {
  const baseUrl = getServerUrl();
  const opCount = getOperations().length;
  const groups = getTagGroups();

  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash) {
      requestAnimationFrame(() => {
        document.getElementById(hash)?.scrollIntoView({ behavior: "smooth" });
      });
    }
  }, []);

  return (
    <article className="space-y-12">
      <header className="space-y-4">
        <h1 className="text-3xl font-semibold tracking-tight">{getApiTitle()}</h1>
        <p className="text-[15px] text-muted-foreground leading-relaxed">
          Public builder API only: agents, calls (transcript &amp; summary), variables, webhooks,
          phone numbers, wallet, and knowledge base. {opCount} endpoints — campaigns, onboarding,
          CRM, providers, and other dashboard-internal APIs are not listed here.
        </p>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
          <span className="text-xs uppercase tracking-wider text-muted-foreground/60">Base URL</span>
          <code className="block mt-1 text-sm font-mono text-foreground/90">{baseUrl}</code>
        </div>
      </header>

      <Section id="introduction" title="Introduction">
        <p>
          Every endpoint accepts and returns JSON. Requests are made over HTTPS to the base URL
          above. Use the sidebar to browse endpoints by resource, or jump straight to a specific
          operation to see its parameters, request body, responses and a ready-to-run cURL example.
        </p>
      </Section>

      <Section id="authentication" title="Authentication">
        <p>
          Use a developer API key from{" "}
          <Link href="/docs/authentication">Authentication</Link> in the{" "}
          <code className="text-sky-700">Authorization</code> header:
        </p>
        <pre className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-[13px] font-mono text-slate-800 overflow-x-auto">
          <code>Authorization: Bearer sk_live_…</code>
        </pre>
        <p>
          Dashboard session JWTs work for the browser app only. Prefer{" "}
          <code className="text-sky-700">sk_live_</code> keys from your backend.
        </p>
      </Section>

      <Section id="pagination" title="Pagination">
        <p>
          List endpoints that can return large collections accept{" "}
          <code className="text-primary">page</code> and <code className="text-primary">limit</code>{" "}
          query parameters where applicable. Check each endpoint's Query Parameters section for the
          exact pagination it supports.
        </p>
      </Section>

      <Section id="rate-limiting" title="Rate Limiting">
        <p>
          Requests are subject to fair-use rate limiting. If you exceed the allowed rate you will
          receive a <code className="text-primary">429 Too Many Requests</code> response; retry
          after a short backoff.
        </p>
      </Section>

      <Section id="errors" title="Errors">
        <p>
          SnapServe uses conventional HTTP status codes. <code className="text-primary">2xx</code>{" "}
          indicates success, <code className="text-primary">4xx</code> indicates a client error
          (missing or invalid parameters, authentication failures), and{" "}
          <code className="text-primary">5xx</code> indicates a server error. Error responses include
          a JSON body describing what went wrong.
        </p>
      </Section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold tracking-tight">Resources</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          {groups.map((g) => {
            const first = g.operations[0];
            return (
              <Link
                key={g.tag}
                href={first ? `/docs/api-reference/${first.id}` : "/docs/api-reference"}
                className="group rounded-lg border border-slate-200 bg-slate-50 p-4 hover:border-primary/30 hover:bg-slate-100 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-foreground">{tagLabel(g.tag)}</span>
                  <span className="text-xs text-muted-foreground/50">{g.operations.length}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1">
                  {[...new Set(g.operations.map((o) => o.method))].map((m) => (
                    <MethodBadge key={m} method={m} />
                  ))}
                </div>
              </Link>
            );
          })}
        </div>
      </section>
    </article>
  );
}
