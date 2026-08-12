import { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import {
  collectParameters,
  buildCurl,
  getRequestBody,
  getResponses,
  type ResolvedResponse,
} from "../openapi/curl";
import { typeLabel } from "../openapi/schema";
import type { IndexedOperation } from "../openapi/spec";
import type { ParameterObject } from "../openapi/types";
import { MethodBadge } from "./MethodBadge";
import { SchemaView } from "./SchemaTable";
import { CodePanel } from "./CodePanel";

export interface EndpointSection {
  id: string;
  label: string;
}

function hasAdminAuth(params: ParameterObject[]): boolean {
  return params.some((p) => p.in === "header" && p.name.toLowerCase() === "x-admin-token");
}

export function endpointSections(op: IndexedOperation): EndpointSection[] {
  const params = collectParameters(op);
  const sections: EndpointSection[] = [{ id: "authorizations", label: "Authorizations" }];
  if (params.some((p) => p.in === "path")) sections.push({ id: "path-parameters", label: "Path Parameters" });
  if (params.some((p) => p.in === "query")) sections.push({ id: "query-parameters", label: "Query Parameters" });
  const headerParams = params.filter(
    (p) => p.in === "header" && p.name.toLowerCase() !== "x-admin-token",
  );
  if (headerParams.length) sections.push({ id: "headers", label: "Headers" });
  if (getRequestBody(op)) sections.push({ id: "body", label: "Body" });
  if (Object.keys(op.operation.responses ?? {}).length) {
    sections.push({ id: "responses", label: "Responses" });
  }
  return sections;
}

function SectionHeading({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2
      id={id}
      className="scroll-mt-24 text-sm font-semibold uppercase tracking-wider text-foreground/90 mb-4 pb-2 border-b border-slate-200"
    >
      {children}
    </h2>
  );
}

function ParamRow({ param }: { param: ParameterObject }) {
  return (
    <div className="py-3">
      <div className="flex items-baseline gap-2 flex-wrap">
        <code className="text-sm font-mono text-foreground font-medium">{param.name}</code>
        <span className="text-xs font-mono text-violet-300/80">
          {param.schema ? typeLabel(param.schema) : "string"}
        </span>
        {param.required ? (
          <span className="text-[10px] uppercase tracking-wide font-semibold text-rose-400/80">
            required
          </span>
        ) : (
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground/50">optional</span>
        )}
      </div>
      {param.description ? (
        <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{param.description}</p>
      ) : null}
    </div>
  );
}

function ParamList({ params }: { params: ParameterObject[] }) {
  return (
    <div className="divide-y divide-slate-100">
      {params.map((p) => (
        <ParamRow key={`${p.in}:${p.name}`} param={p} />
      ))}
    </div>
  );
}

function Authorizations({ admin }: { admin: boolean }) {
  return (
    <div className="divide-y divide-slate-100">
      <div className="py-3">
        <div className="flex items-baseline gap-2 flex-wrap">
          <code className="text-sm font-mono text-foreground font-medium">
            {admin ? "X-Admin-Token" : "Authorization"}
          </code>
          <span className="text-xs font-mono text-violet-300/80">string · header</span>
          <span className="text-[10px] uppercase tracking-wide font-semibold text-rose-400/80">
            required
          </span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
          {admin
            ? "Platform admin token. Send it in the X-Admin-Token request header."
            : "Bearer authentication. Provide your session token as Authorization: Bearer <token>."}
        </p>
      </div>
    </div>
  );
}

function statusTone(status: string): string {
  if (status.startsWith("2")) return "text-emerald-400 border-emerald-400/40 bg-emerald-400/5";
  if (status.startsWith("3")) return "text-sky-400 border-sky-400/40 bg-sky-400/5";
  if (status.startsWith("4")) return "text-amber-400 border-amber-400/40 bg-amber-400/5";
  if (status.startsWith("5")) return "text-rose-400 border-rose-400/40 bg-rose-400/5";
  return "text-muted-foreground border-slate-300";
}

function ResponsesSection({ responses }: { responses: ResolvedResponse[] }) {
  const [activeStatus, setActiveStatus] = useState(
    () => responses.find((r) => r.status.startsWith("2"))?.status ?? responses[0]?.status,
  );
  const active = responses.find((r) => r.status === activeStatus) ?? responses[0];

  return (
    <section>
      <SectionHeading id="responses">Responses</SectionHeading>
      <div className="flex items-center gap-1.5 flex-wrap mb-4">
        {responses.map((r) => (
          <button
            key={r.status}
            onClick={() => setActiveStatus(r.status)}
            className={`rounded-md border px-2.5 py-1 text-xs font-mono font-semibold transition-colors ${
              r.status === active?.status
                ? statusTone(r.status)
                : "text-muted-foreground/60 border-slate-200 hover:text-foreground"
            }`}
          >
            {r.status}
          </button>
        ))}
      </div>
      {active ? (
        <div>
          {active.description ? (
            <p className="text-sm text-muted-foreground mb-3">{active.description}</p>
          ) : null}
          {active.schema ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <SchemaView node={active.schema} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No response body.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}

export function EndpointAside({ op, baseUrl }: { op: IndexedOperation; baseUrl: string }) {
  const sections = useMemo(() => endpointSections(op), [op]);
  return (
    <div className="space-y-6">
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 mb-3">
          On this page
        </h4>
        <ul className="flex flex-col gap-1.5 border-l border-slate-200 pl-3">
          {sections.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className="text-[13px] text-muted-foreground hover:text-foreground transition-colors"
              >
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </div>
      <CodePanel op={op} baseUrl={baseUrl} />
    </div>
  );
}

export function EndpointPage({ op, baseUrl }: { op: IndexedOperation; baseUrl: string }) {
  const [copied, setCopied] = useState(false);
  const params = useMemo(() => collectParameters(op), [op]);
  const pathParams = params.filter((p) => p.in === "path");
  const queryParams = params.filter((p) => p.in === "query");
  const headerParams = params.filter(
    (p) => p.in === "header" && p.name.toLowerCase() !== "x-admin-token",
  );
  const admin = hasAdminAuth(params);
  const body = getRequestBody(op);
  const responses = useMemo(() => getResponses(op), [op]);

  const copyCurl = () => {
    navigator.clipboard?.writeText(buildCurl(op, { baseUrl })).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <article className="space-y-10">
      <header className="space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-semibold tracking-tight">{op.summary}</h1>
          {op.deprecated ? (
            <span className="rounded-md bg-amber-400/10 border border-amber-400/20 px-2 py-0.5 text-[11px] font-medium text-amber-400">
              Deprecated
            </span>
          ) : null}
        </div>

        <div className="flex items-stretch gap-3 flex-wrap">
          <div className="flex items-center gap-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 min-w-0 flex-1">
            <MethodBadge method={op.method} size="md" />
            <code className="text-sm font-mono text-foreground/90 truncate">
              <span className="text-muted-foreground/60">{baseUrl}</span>
              {op.path}
            </code>
          </div>
          <button
            onClick={copyCurl}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors shrink-0"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied cURL" : "Try it"}
          </button>
        </div>

        {op.description ? (
          <p className="text-[15px] text-muted-foreground leading-relaxed">{op.description}</p>
        ) : null}
      </header>

      <section>
        <SectionHeading id="authorizations">Authorizations</SectionHeading>
        <Authorizations admin={admin} />
      </section>

      {pathParams.length ? (
        <section>
          <SectionHeading id="path-parameters">Path Parameters</SectionHeading>
          <ParamList params={pathParams} />
        </section>
      ) : null}

      {queryParams.length ? (
        <section>
          <SectionHeading id="query-parameters">Query Parameters</SectionHeading>
          <ParamList params={queryParams} />
        </section>
      ) : null}

      {headerParams.length ? (
        <section>
          <SectionHeading id="headers">Headers</SectionHeading>
          <ParamList params={headerParams} />
        </section>
      ) : null}

      {body?.schema ? (
        <section>
          <SectionHeading id="body">
            Body <span className="font-normal normal-case text-muted-foreground/60">application/json{body.required ? " · required" : ""}</span>
          </SectionHeading>
          <SchemaView node={body.schema} />
        </section>
      ) : null}

      {responses.length ? <ResponsesSection responses={responses} /> : null}

      <div className="xl:hidden pt-4 border-t border-slate-200">
        <EndpointAside op={op} baseUrl={baseUrl} />
      </div>
    </article>
  );
}
