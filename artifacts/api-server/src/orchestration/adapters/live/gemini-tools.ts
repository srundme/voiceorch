import { Type, type Tool } from "@google/genai";
import type { ToolDefinition } from "../../types.js";

/** Convert pipeline ToolDefinition[] to Gemini Live / generateContent tool format. */
export function toGeminiLiveTools(tools: ToolDefinition[]): Tool[] | undefined {
  if (!tools.length) return undefined;
  return [{
    functionDeclarations: tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: {
        type: Type.OBJECT,
        properties: Object.fromEntries(
          Object.entries(t.parameters.properties).map(([key, val]) => [
            key,
            {
              type: (Type as Record<string, Type>)[val.type.toUpperCase()] ?? Type.STRING,
              description: val.description,
              ...(val.enum ? { enum: val.enum } : {}),
            },
          ]),
        ),
        required: t.parameters.required ?? [],
      },
    })),
  }];
}
