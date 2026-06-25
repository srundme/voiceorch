import { useState } from "react";
import { ChevronRight } from "lucide-react";
import {
  getProperties,
  MAX_DEPTH,
  normalizeType,
  resolveSchema,
  typeLabel,
  type PropertyEntry,
} from "../openapi/schema";
import type { RefObject, SchemaObject } from "../openapi/types";

function Meta({ schema }: { schema: SchemaObject }) {
  const bits: string[] = [];
  if (schema.enum && schema.enum.length) {
    bits.push(
      `Allowed: ${schema.enum.map((v) => JSON.stringify(v)).join(", ")}`,
    );
  }
  if (schema.default !== undefined) bits.push(`Default: ${JSON.stringify(schema.default)}`);
  if (typeof schema.minLength === "number") bits.push(`min length ${schema.minLength}`);
  if (typeof schema.maxLength === "number") bits.push(`max length ${schema.maxLength}`);
  if (typeof schema.minimum === "number") bits.push(`min ${schema.minimum}`);
  if (typeof schema.maximum === "number") bits.push(`max ${schema.maximum}`);
  if (!bits.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
      {bits.map((b) => (
        <span key={b} className="text-[11px] font-mono text-muted-foreground/60">
          {b}
        </span>
      ))}
    </div>
  );
}

function PropertyRow({
  entry,
  seenRefs,
  depth,
}: {
  entry: PropertyEntry;
  seenRefs: Set<string>;
  depth: number;
}) {
  const [open, setOpen] = useState(false);
  const resolved = resolveSchema(entry.node, seenRefs);
  const schema = resolved.schema;
  const nt = normalizeType(schema);

  let childSchema: SchemaObject | null = null;
  let childRef: string | undefined;
  if (schema.properties) {
    childSchema = schema;
    childRef = resolved.refId;
  } else if (nt.type === "array" && schema.items) {
    const item = resolveSchema(schema.items, seenRefs);
    if (item.schema.properties) {
      childSchema = item.schema;
      childRef = item.refId;
    }
  }

  const cyclicChild = childRef ? seenRefs.has(childRef) : false;
  const canExpand = Boolean(childSchema) && !cyclicChild && depth < MAX_DEPTH;
  const childSeen = childRef ? new Set(seenRefs).add(childRef) : seenRefs;

  return (
    <div className="py-3">
      <div className="flex items-baseline gap-2 flex-wrap">
        <code className="text-sm font-mono text-foreground font-medium">{entry.name}</code>
        <span className="text-xs font-mono text-violet-300/80">{typeLabel(entry.node)}</span>
        {entry.required ? (
          <span className="text-[10px] uppercase tracking-wide font-semibold text-rose-400/80">
            required
          </span>
        ) : null}
        {canExpand ? (
          <button
            onClick={() => setOpen((v) => !v)}
            className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronRight className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`} />
            {open ? "Hide" : "Show"} attributes
          </button>
        ) : null}
      </div>
      {schema.description ? (
        <p className="mt-1 text-sm text-muted-foreground leading-relaxed">{schema.description}</p>
      ) : null}
      <Meta schema={schema} />
      {cyclicChild ? (
        <p className="mt-1 text-[11px] font-mono text-muted-foreground/50">↻ circular reference</p>
      ) : null}
      {canExpand && open && childSchema ? (
        <div className="mt-3 ml-3 pl-4 border-l border-white/10">
          <SchemaProperties schema={childSchema} seenRefs={childSeen} depth={depth + 1} />
        </div>
      ) : null}
    </div>
  );
}

export function SchemaProperties({
  schema,
  seenRefs,
  depth = 0,
}: {
  schema: SchemaObject;
  seenRefs: Set<string>;
  depth?: number;
}) {
  const entries = getProperties(schema);
  if (!entries.length) return null;
  return (
    <div className="divide-y divide-white/5">
      {entries.map((entry) => (
        <PropertyRow key={entry.name} entry={entry} seenRefs={seenRefs} depth={depth} />
      ))}
    </div>
  );
}

/** Top-level renderer for a request body / response schema. */
export function SchemaView({ node }: { node: SchemaObject | RefObject }) {
  const top = resolveSchema(node);
  const schema = top.schema;
  const nt = normalizeType(schema);
  const seed = new Set<string>(top.refId ? [top.refId] : []);

  if (nt.type === "array" && schema.items) {
    const item = resolveSchema(schema.items, seed);
    const itemSeed = new Set(seed);
    if (item.refId) itemSeed.add(item.refId);
    return (
      <div>
        <p className="text-sm text-muted-foreground mb-2">
          Array of <code className="font-mono text-violet-300/80">{typeLabel(schema.items)}</code>
        </p>
        {item.schema.properties ? (
          <SchemaProperties schema={item.schema} seenRefs={itemSeed} />
        ) : null}
      </div>
    );
  }

  if (schema.properties) {
    return <SchemaProperties schema={schema} seenRefs={seed} />;
  }

  return (
    <p className="text-sm font-mono text-violet-300/80">{typeLabel(node)}</p>
  );
}
