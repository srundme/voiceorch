import { resolveRef, getRefName } from "./spec";
import { isRef, type RefObject, type SchemaObject } from "./types";

export const MAX_DEPTH = 8;

export interface NormalizedType {
  type?: string;
  nullable: boolean;
}

/** Collapse `type: ["string", "null"]` style unions into a base type + nullability. */
export function normalizeType(schema: SchemaObject): NormalizedType {
  let nullable = Boolean(schema.nullable);
  let type: string | undefined;
  if (Array.isArray(schema.type)) {
    const nonNull = schema.type.filter((t) => t !== "null");
    if (schema.type.includes("null")) nullable = true;
    type = nonNull[0];
  } else {
    type = schema.type;
  }
  return { type, nullable };
}

/** Human-readable type label for a property (does not deeply resolve $refs). */
export function typeLabel(node: SchemaObject | RefObject): string {
  if (isRef(node)) return getRefName(node.$ref);
  const schema = node;
  const { type, nullable } = normalizeType(schema);
  let base: string;
  if (type === "array") {
    base = `${schema.items ? typeLabel(schema.items) : "any"}[]`;
  } else if (schema.enum && schema.enum.length) {
    base = "enum";
  } else if (type === "object" || schema.properties) {
    base = "object";
  } else if (!type && (schema.allOf || schema.oneOf || schema.anyOf)) {
    base = "object";
  } else {
    base = type ?? "any";
  }
  if (schema.format) base += ` · ${schema.format}`;
  return nullable ? `${base} | null` : base;
}

export interface ResolvedSchema {
  schema: SchemaObject;
  /** Short display name of the first `$ref` followed (e.g. `Agent`). */
  refName?: string;
  /** Full `$ref` string of the first ref followed, used for cycle tracking. */
  refId?: string;
  cyclic: boolean;
}

/**
 * Resolve a schema node: follow `$ref` chains and shallow-merge `allOf` into a
 * single object schema. `seenRefs` carries ancestor `$ref` strings (full ids)
 * so we can flag a cycle instead of recursing forever.
 */
export function resolveSchema(
  node: SchemaObject | RefObject,
  seenRefs: Set<string> = new Set(),
): ResolvedSchema {
  let refName: string | undefined;
  let refId: string | undefined;
  let cur: SchemaObject | RefObject = node;
  const localSeen = new Set(seenRefs);

  while (isRef(cur)) {
    const name = cur.$ref;
    refName = refName ?? getRefName(name);
    refId = refId ?? name;
    if (localSeen.has(name)) {
      return { schema: {}, refName, refId, cyclic: true };
    }
    localSeen.add(name);
    const resolved = resolveRef(name) as SchemaObject | undefined;
    if (!resolved) return { schema: {}, refName, refId, cyclic: false };
    cur = resolved;
  }

  let schema = cur;

  const compositions = schema.allOf;
  if (compositions && compositions.length) {
    const merged: SchemaObject = {
      type: "object",
      properties: {},
      required: [],
      description: schema.description,
    };
    for (const sub of compositions) {
      const r = resolveSchema(sub, localSeen);
      if (r.schema.properties) Object.assign(merged.properties!, r.schema.properties);
      if (r.schema.required) merged.required!.push(...r.schema.required);
      if (!merged.description && r.schema.description) merged.description = r.schema.description;
    }
    if (schema.properties) Object.assign(merged.properties!, schema.properties);
    if (schema.required) merged.required!.push(...schema.required);
    schema = merged;
  }

  return { schema, refName, refId, cyclic: false };
}

export interface PropertyEntry {
  name: string;
  node: SchemaObject | RefObject;
  required: boolean;
}

export function getProperties(schema: SchemaObject): PropertyEntry[] {
  const props = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  return Object.entries(props).map(([name, node]) => ({
    name,
    node,
    required: required.has(name),
  }));
}

function pickType(schema: SchemaObject): string | undefined {
  if (Array.isArray(schema.type)) return schema.type.filter((t) => t !== "null")[0];
  return schema.type;
}

function primitiveExample(schema: SchemaObject, type: string | undefined): unknown {
  switch (type) {
    case "string":
      switch (schema.format) {
        case "date-time":
          return "2026-06-25T09:30:00.000Z";
        case "date":
          return "2026-06-25";
        case "email":
          return "user@example.com";
        case "uri":
        case "url":
          return "https://example.com";
        case "uuid":
          return "3fa85f64-5717-4562-b3fc-2c963f66afa6";
        default:
          return "string";
      }
    case "integer":
      return 0;
    case "number":
      return 0;
    case "boolean":
      return true;
    case "null":
      return null;
    default:
      return null;
  }
}

/** Generate a representative example JSON value for a schema (cycle-safe). */
export function schemaToExample(
  node: SchemaObject | RefObject,
  seenRefs: Set<string> = new Set(),
  depth = 0,
): unknown {
  if (depth > MAX_DEPTH) return null;

  if (isRef(node)) {
    if (seenRefs.has(node.$ref)) return null;
    const next = new Set(seenRefs);
    next.add(node.$ref);
    const resolved = resolveRef(node.$ref) as SchemaObject | undefined;
    if (!resolved) return null;
    return schemaToExample(resolved, next, depth);
  }

  const schema = node;
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (schema.enum && schema.enum.length) return schema.enum[0];

  if (schema.allOf && schema.allOf.length) {
    const merged: Record<string, unknown> = {};
    for (const sub of schema.allOf) {
      const v = schemaToExample(sub, seenRefs, depth);
      if (v && typeof v === "object" && !Array.isArray(v)) {
        Object.assign(merged, v as Record<string, unknown>);
      }
    }
    return merged;
  }
  if (schema.oneOf && schema.oneOf.length) return schemaToExample(schema.oneOf[0], seenRefs, depth);
  if (schema.anyOf && schema.anyOf.length) return schemaToExample(schema.anyOf[0], seenRefs, depth);

  const type = pickType(schema);

  if (type === "array") {
    return [schemaToExample(schema.items ?? {}, seenRefs, depth + 1)];
  }

  if (type === "object" || schema.properties) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema.properties ?? {})) {
      out[k] = schemaToExample(v, seenRefs, depth + 1);
    }
    if (
      Object.keys(out).length === 0 &&
      schema.additionalProperties &&
      typeof schema.additionalProperties === "object"
    ) {
      out["key"] = schemaToExample(schema.additionalProperties as SchemaObject, seenRefs, depth + 1);
    }
    return out;
  }

  return primitiveExample(schema, type);
}

export { getRefName };
