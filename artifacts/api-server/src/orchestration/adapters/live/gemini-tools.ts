import { Type, type Schema, type Tool } from "@google/genai";
import type { ToolDefinition, ToolPropertySchema } from "../../types.js";

function geminiType(type: string | undefined): Type {
  return (Type as Record<string, Type>)[(type || "string").toUpperCase()] ?? Type.STRING;
}

/**
 * Gemini rejects ARRAY properties without `items` (400 INVALID_ARGUMENT).
 * Always emit items for arrays; default to STRING when the source omitted them.
 */
export function toGeminiPropertySchema(val: ToolPropertySchema): Schema {
  const type = geminiType(val.type);
  const schema: Schema = {
    type,
    ...(val.description ? { description: val.description } : {}),
    ...(val.enum ? { enum: val.enum, format: "enum" } : {}),
  };
  if (type === Type.ARRAY) {
    schema.items = val.items ? toGeminiPropertySchema(val.items) : { type: Type.STRING };
  }
  if (type === Type.OBJECT && val.properties) {
    schema.properties = Object.fromEntries(
      Object.entries(val.properties).map(([key, child]) => [key, toGeminiPropertySchema(child)]),
    );
    if (val.required?.length) schema.required = val.required;
  }
  return schema;
}

/** Convert pipeline ToolDefinition[] to Gemini Live / generateContent tool format. */
export function toGeminiLiveTools(tools?: ToolDefinition[]): Tool[] | undefined {
  if (!tools?.length) return undefined;
  return [{
    functionDeclarations: tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: {
        type: Type.OBJECT,
        properties: Object.fromEntries(
          Object.entries(t.parameters.properties).map(([key, val]) => [
            key,
            toGeminiPropertySchema(val),
          ]),
        ),
        required: t.parameters.required ?? [],
      },
    })),
  }];
}
