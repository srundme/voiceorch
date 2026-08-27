import type { ToolDefinition } from "../types.js";

/** Map pipeline toolChoice into OpenAI chat-completions tool_choice. */
export function toOpenAiToolChoice(
  choice: "auto" | "required" | { name: string } | undefined,
  tools: ToolDefinition[] | undefined,
): "auto" | "required" | { type: "function"; function: { name: string } } | undefined {
  if (!tools?.length) return undefined;
  if (!choice || choice === "auto") return "auto";
  if (choice === "required") return "required";
  const allowed = new Set(tools.map((t) => t.name));
  if (!allowed.has(choice.name)) return "auto";
  return { type: "function", function: { name: choice.name } };
}
