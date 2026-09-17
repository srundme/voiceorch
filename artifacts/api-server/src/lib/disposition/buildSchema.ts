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
    confidence: { type: "number" },
    evidence:   { type: "string" },
    summary:    { type: "string" },
  };

  for (const field of cfg.domainFields) {
    if (field.type === "boolean") {
      properties[field.key] = { type: ["boolean", "null"] };
    } else if (field.type === "number") {
      properties[field.key] = { type: ["number", "null"] };
    } else if (field.enum?.length) {
      properties[field.key] = {
        anyOf: [{ type: "string", enum: [...field.enum] }, { type: "null" }],
      };
    } else {
      properties[field.key] = { type: ["string", "null"] };
    }
  }

  // OpenAI structured-output strict mode requires every property key to be
  // listed in `required` (nullable fields express optionality via their type),
  // so include all keys — the core five plus any domain fields.
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}
