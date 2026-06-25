import { schemaToExample } from "./schema";
import { resolveRef, type IndexedOperation } from "./spec";
import {
  isRef,
  type ParameterObject,
  type RefObject,
  type RequestBodyObject,
  type ResponseObject,
  type SchemaObject,
} from "./types";

function resolveParams(
  params: (ParameterObject | RefObject)[] | undefined,
): ParameterObject[] {
  if (!params) return [];
  const out: ParameterObject[] = [];
  for (const p of params) {
    if (isRef(p)) {
      const resolved = resolveRef(p.$ref) as ParameterObject | undefined;
      if (resolved) out.push(resolved);
    } else {
      out.push(p);
    }
  }
  return out;
}

export function collectParameters(op: IndexedOperation): ParameterObject[] {
  const merged = new Map<string, ParameterObject>();
  for (const p of resolveParams(op.pathParameters)) merged.set(`${p.in}:${p.name}`, p);
  for (const p of resolveParams(op.operation.parameters)) merged.set(`${p.in}:${p.name}`, p);
  return [...merged.values()];
}

export function getRequestBody(op: IndexedOperation): {
  schema?: SchemaObject | RefObject;
  required: boolean;
} | null {
  const body = op.operation.requestBody;
  if (!body || isRef(body)) return null;
  const rb = body as RequestBodyObject;
  const json = rb.content?.["application/json"];
  if (!json) return null;
  return { schema: json.schema, required: Boolean(rb.required) };
}

export interface ResolvedResponse {
  status: string;
  description?: string;
  schema?: SchemaObject | RefObject;
}

export function getResponses(op: IndexedOperation): ResolvedResponse[] {
  const entries = Object.entries(op.operation.responses ?? {});
  return entries.map(([status, response]) => {
    const resolved = isRef(response)
      ? (resolveRef(response.$ref) as ResponseObject | undefined)
      : response;
    const json = resolved?.content?.["application/json"];
    return { status, description: resolved?.description, schema: json?.schema };
  });
}

function paramExample(param: ParameterObject): string {
  if (param.schema && !isRef(param.schema)) {
    const ex = schemaToExample(param.schema);
    if (ex !== null && ex !== undefined && typeof ex !== "object") return String(ex);
  }
  return `:${param.name}`;
}

export interface CurlOptions {
  baseUrl: string;
  token?: string;
}

export function buildCurl(op: IndexedOperation, opts: CurlOptions): string {
  const token = opts.token?.trim() || "<token>";
  const params = collectParameters(op);

  let pathStr = op.path;
  for (const p of params.filter((p) => p.in === "path")) {
    pathStr = pathStr.replace(`{${p.name}}`, encodeURIComponent(paramExample(p)));
  }

  const query = params.filter((p) => p.in === "query");
  let url = `${opts.baseUrl}${pathStr}`;
  if (query.length) {
    const qs = query
      .map((p) => `${encodeURIComponent(p.name)}=${encodeURIComponent(paramExample(p))}`)
      .join("&");
    url += `?${qs}`;
  }

  const method = op.method.toUpperCase();
  const lines: string[] = [`curl --request ${method} \\`, `  --url '${url}' \\`];

  const headerParams = params.filter((p) => p.in === "header");
  const hasAdminHeader = headerParams.some(
    (p) => p.name.toLowerCase() === "x-admin-token",
  );

  if (hasAdminHeader) {
    lines.push(`  --header 'X-Admin-Token: <admin-token>' \\`);
  } else {
    lines.push(`  --header 'Authorization: Bearer ${token}' \\`);
  }

  const body = getRequestBody(op);
  if (body?.schema) {
    lines.push(`  --header 'Content-Type: application/json' \\`);
    const example = schemaToExample(body.schema);
    const json = JSON.stringify(example, null, 2)
      .split("\n")
      .map((l, i) => (i === 0 ? l : `  ${l}`))
      .join("\n");
    lines.push(`  --data '${json}'`);
  } else {
    // drop the trailing backslash from the last header line
    lines[lines.length - 1] = lines[lines.length - 1].replace(/ \\$/, "");
  }

  return lines.join("\n");
}
