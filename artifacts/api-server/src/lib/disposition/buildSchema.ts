import type { DispositionConfig } from "./types.js";

/**
 * Builds a strict JSON Schema from the agent's disposition config.
 * Used to constrain LLM structured output.
 */
export function buildSchema(cfg: DispositionConfig): Record<string, unknown> {
  const allSubs = Object.values(cfg.taxonomy).flat();

  const properties: Record<string, unknown> = {
    primary:    { type: "string", enum: Object.keys(cfg.taxonomy) },
    sub:        { type: "string", enum: allSubs },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    evidence:   { type: "string" },
    summary:    { type: "string" },
  };

  for (const field of cfg.domainFields) {
    if (field.type === "boolean") {
      properties[field.key] = { type: ["boolean", "null"] };
    } else if (field.type === "number") {
      properties[field.key] = { type: ["number", "null"] };
    } else if (field.enum?.length) {
      properties[field.key] = { type: ["string", "null"], enum: [...field.enum, null] };
    } else {
      properties[field.key] = { type: ["string", "null"] };
    }
  }

  return {
    type: "object",
    properties,
    required: ["primary", "sub", "confidence", "evidence", "summary"],
    additionalProperties: false,
  };
}
