import doc from "virtual:openapi-spec";
import type {
  HttpMethod,
  OpenApiDocument,
  OperationObject,
  ParameterObject,
  PathItemObject,
  RefObject,
} from "./types";

export const spec: OpenApiDocument = doc;

export const METHODS: HttpMethod[] = ["get", "post", "put", "patch", "delete"];

export interface IndexedOperation {
  id: string;
  method: HttpMethod;
  path: string;
  tag: string;
  summary: string;
  description?: string;
  deprecated?: boolean;
  operation: OperationObject;
  pathParameters: (ParameterObject | RefObject)[];
}

export interface TagGroup {
  tag: string;
  description?: string;
  operations: IndexedOperation[];
}

/** Resolve a local JSON pointer ($ref) like "#/components/schemas/Agent". */
export function resolveRef(ref: string): unknown {
  if (!ref.startsWith("#/")) return undefined;
  const segments = ref
    .slice(2)
    .split("/")
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
  let cur: unknown = spec;
  for (const seg of segments) {
    if (cur && typeof cur === "object" && seg in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[seg];
    } else {
      return undefined;
    }
  }
  return cur;
}

export function getRefName(ref: string): string {
  return ref.split("/").pop() ?? ref;
}

function slugify(method: string, path: string): string {
  return `${method}-${path}`
    .toLowerCase()
    .replace(/[{}]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

let cachedOps: IndexedOperation[] | null = null;

export function getOperations(): IndexedOperation[] {
  if (cachedOps) return cachedOps;
  const ops: IndexedOperation[] = [];
  const paths = spec.paths ?? {};
  for (const [path, pathItem] of Object.entries(paths)) {
    if (!pathItem) continue;
    const item = pathItem as PathItemObject;
    const sharedParams = item.parameters ?? [];
    for (const method of METHODS) {
      const op = item[method];
      if (!op) continue;
      const tag = op.tags?.[0] ?? "default";
      ops.push({
        id: op.operationId ?? slugify(method, path),
        method,
        path,
        tag,
        summary: op.summary ?? `${method.toUpperCase()} ${path}`,
        description: op.description,
        deprecated: op.deprecated,
        operation: op,
        pathParameters: sharedParams,
      });
    }
  }
  cachedOps = ops;
  return ops;
}

export function getOperationById(id: string): IndexedOperation | undefined {
  return getOperations().find((o) => o.id === id);
}

/** Group operations by tag, preserving the tag order declared at the top of the spec. */
export function getTagGroups(): TagGroup[] {
  const ops = getOperations();
  const declaredOrder = (spec.tags ?? []).map((t) => t.name);
  const descByTag = new Map((spec.tags ?? []).map((t) => [t.name, t.description]));

  const byTag = new Map<string, IndexedOperation[]>();
  for (const op of ops) {
    const list = byTag.get(op.tag) ?? [];
    list.push(op);
    byTag.set(op.tag, list);
  }

  const orderedTags = [
    ...declaredOrder.filter((t) => byTag.has(t)),
    ...[...byTag.keys()].filter((t) => !declaredOrder.includes(t)).sort(),
  ];

  return orderedTags.map((tag) => ({
    tag,
    description: descByTag.get(tag),
    operations: byTag.get(tag) ?? [],
  }));
}

export function getServerUrl(): string {
  const url = spec.servers?.[0]?.url;
  if (url && /^https?:\/\//.test(url)) return url.replace(/\/$/, "");
  return "https://app.snapserve.ai/api";
}

export function getApiTitle(): string {
  return spec.info?.title ?? "API";
}

/** Tidy a tag id (e.g. "phone-numbers") into a display label ("Phone Numbers"). */
export function tagLabel(tag: string): string {
  return tag
    .split(/[-_\s]+/)
    .map((w) => (w.length <= 3 && w === w.toLowerCase() ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}
