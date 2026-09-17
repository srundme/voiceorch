/**
 * OpenAI structured outputs (`response_format.json_schema` + `strict: true`)
 * reject many ordinary JSON Schema keywords. A 400
 * "Invalid schema for response_format 'disposition'" trips the
 * call-intelligence breaker and pauses post-call analysis for 30 minutes.
 *
 * Convert a schema into the subset OpenAI accepts:
 *   - additionalProperties: false on every object
 *   - every property listed in required (optional fields become nullable)
 *   - no min/max/length/pattern/format constraints
 *   - enum+null rewritten as anyOf
 */

const UNSUPPORTED = new Set([
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "minContains",
  "maxContains",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "pattern",
  "format",
  "uniqueItems",
  "default",
  "examples",
  "title",
  "$schema",
  "$id",
  "$comment",
]);

export function isOpenAiInvalidSchemaError(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  const msg = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
  const param = String((err as { error?: { param?: string } })?.error?.param ?? "").toLowerCase();
  return (
    (status === 400 || msg.includes("400"))
    && (msg.includes("invalid schema") || param === "response_format")
  );
}

export function toOpenAiStrictSchema(input: Record<string, unknown>): Record<string, unknown> {
  const cloned = structuredClone(input) as unknown;
  const out = strictNode(cloned, true);
  if (!out || typeof out !== "object" || Array.isArray(out)) {
    return { type: "object", properties: {}, required: [], additionalProperties: false };
  }
  return out as Record<string, unknown>;
}

function stripUnsupported(node: Record<string, unknown>): void {
  for (const key of Object.keys(node)) {
    if (UNSUPPORTED.has(key)) delete node[key];
  }
}

function typesOf(node: Record<string, unknown>): string[] {
  if (Array.isArray(node.type)) return node.type.filter((t): t is string => typeof t === "string");
  if (typeof node.type === "string") return [node.type];
  return [];
}

function asNullable(schema: unknown): unknown {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return { anyOf: [schema, { type: "null" }] };
  }
  const obj = schema as Record<string, unknown>;
  if (Array.isArray(obj.anyOf)) {
    const hasNull = obj.anyOf.some(
      (branch) => branch && typeof branch === "object" && !Array.isArray(branch)
        && (branch as Record<string, unknown>).type === "null",
    );
    if (hasNull) return obj;
    return { anyOf: [...obj.anyOf, { type: "null" }] };
  }
  const types = typesOf(obj);
  if (types.includes("null")) return obj;
  if (types.length === 1) return { ...obj, type: [types[0], "null"] };
  if (types.length > 1) return { ...obj, type: [...types, "null"] };
  return { anyOf: [obj, { type: "null" }] };
}

function splitNullEnum(node: Record<string, unknown>): Record<string, unknown> | null {
  if (!Array.isArray(node.enum) || !node.enum.includes(null)) return null;
  const withoutNull = node.enum.filter((value) => value !== null);
  const rest = { ...node };
  delete rest.enum;
  delete rest.type;
  const valueType = withoutNull.every((v) => typeof v === "number") ? "number" : "string";
  return {
    anyOf: [
      strictNode({ ...rest, type: valueType, enum: withoutNull }, false) as Record<string, unknown>,
      { type: "null" },
    ],
  };
}

function strictNode(node: unknown, isRoot: boolean): unknown {
  if (!node || typeof node !== "object" || Array.isArray(node)) return node;
  const obj = node as Record<string, unknown>;
  stripUnsupported(obj);

  const nullEnum = splitNullEnum(obj);
  if (nullEnum) return nullEnum;

  if (Array.isArray(obj.anyOf)) {
    obj.anyOf = obj.anyOf.map((branch) => strictNode(branch, false));
    return obj;
  }
  if (Array.isArray(obj.oneOf)) {
    obj.oneOf = obj.oneOf.map((branch) => strictNode(branch, false));
    return obj;
  }
  if (obj.$defs && typeof obj.$defs === "object" && !Array.isArray(obj.$defs)) {
    const defs = obj.$defs as Record<string, unknown>;
    for (const [key, def] of Object.entries(defs)) {
      defs[key] = strictNode(def, false);
    }
  }

  const types = typesOf(obj);
  const hasProperties = obj.properties != null && typeof obj.properties === "object" && !Array.isArray(obj.properties);
  const isObject = types.includes("object") || hasProperties || isRoot;

  if (obj.items != null) obj.items = strictNode(obj.items, false);

  if (!isObject) return obj;

  const props = hasProperties ? { ...(obj.properties as Record<string, unknown>) } : {};
  const prevRequired = new Set(
    Array.isArray(obj.required)
      ? obj.required.filter((key): key is string => typeof key === "string")
      : [],
  );
  const nextProps: Record<string, unknown> = {};
  for (const [key, prop] of Object.entries(props)) {
    let child = strictNode(prop, false);
    if (prevRequired.size > 0 && !prevRequired.has(key)) {
      child = asNullable(child);
    }
    nextProps[key] = child;
  }
  obj.properties = nextProps;
  obj.additionalProperties = false;
  obj.required = Object.keys(nextProps);
  if (!types.includes("object")) {
    obj.type = types.length > 0 ? [...new Set([...types, "object"])] : "object";
  }
  return obj;
}
