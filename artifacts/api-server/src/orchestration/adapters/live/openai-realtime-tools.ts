import type { ToolDefinition, ToolPropertySchema } from "../../types.js";

export interface OpenAIRealtimeFunctionTool {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** Realtime rejects array properties without `items`; default them to string. */
function toJsonSchema(val: ToolPropertySchema): Record<string, unknown> {
  const type = (val.type || "string").toLowerCase();
  const schema: Record<string, unknown> = { type };
  if (val.description) schema["description"] = val.description;
  if (val.enum) schema["enum"] = val.enum;
  if (type === "array") {
    schema["items"] = val.items ? toJsonSchema(val.items) : { type: "string" };
  }
  if (type === "object" && val.properties) {
    schema["properties"] = Object.fromEntries(
      Object.entries(val.properties).map(([key, child]) => [key, toJsonSchema(child)]),
    );
    if (val.required?.length) schema["required"] = val.required;
  }
  return schema;
}

/** Convert pipeline ToolDefinition[] to OpenAI Realtime session tools. */
export function toOpenAIRealtimeTools(tools?: ToolDefinition[]): OpenAIRealtimeFunctionTool[] {
  if (!tools?.length) return [];
  return tools.map((t) => ({
    type: "function" as const,
    name: t.name,
    description: t.description,
    parameters: {
      type: "object",
      properties: Object.fromEntries(
        Object.entries(t.parameters.properties).map(([key, val]) => [key, toJsonSchema(val)]),
      ),
      required: t.parameters.required ?? [],
    },
  }));
}
