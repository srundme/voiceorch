import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import type { FunctionDeclarationSchema, FunctionDeclarationSchemaProperty } from "@google/generative-ai";
import type { ConversationTurn, LLMAdapter, LLMUsage, ToolDefinition } from "../../types.js";

/**
 * Google Gemini — streaming generative AI with function calling
 * Models: gemini-2.5-flash (recommended), gemini-2.0-flash, gemini-1.5-pro, gemini-1.5-flash
 *
 * Tool calling: supported on all Gemini 1.5+ and 2.x models.
 * Gemini uses its own FunctionDeclaration format (type values are uppercase).
 * Function calls are not streamed token-by-token — they arrive in the final
 * response after the stream completes, so we check response.functionCalls()
 * after draining the stream.
 */
export class GoogleLLM implements LLMAdapter {
  private genAI: GoogleGenerativeAI;
  private model: string;

  constructor(apiKey: string, model: string | null) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.model = model ?? "gemini-2.5-flash";
  }

  async chat(
    messages: ConversationTurn[],
    systemPrompt: string,
    onToken: (token: string) => void,
    onDone: (fullText: string, usage?: LLMUsage) => void,
    options?: {
      tools?: ToolDefinition[];
      onToolCall?: (name: string, args: Record<string, unknown>) => void;
      onUsage?: (usage: LLMUsage) => void;
    }
  ): Promise<void> {
    // Convert our ToolDefinition[] to Gemini's FunctionDeclaration format.
    // Gemini requires property types to be uppercase ("STRING", "NUMBER", etc.)
    // and uses "OBJECT" not "object" for the top-level parameters type.
    const geminiTools = options?.tools?.length
      ? [{
          functionDeclarations: options.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: {
              type: SchemaType.OBJECT,
              properties: Object.fromEntries(
                Object.entries(t.parameters.properties).map(([key, val]) => [
                  key,
                  {
                    type: (SchemaType as Record<string, SchemaType>)[val.type.toUpperCase()] ?? SchemaType.STRING,
                    description: val.description,
                  } as FunctionDeclarationSchemaProperty,
                ])
              ) as FunctionDeclarationSchema["properties"],
              required: t.parameters.required ?? [],
            } as FunctionDeclarationSchema,
          })),
        }]
      : undefined;

    const gemini = this.genAI.getGenerativeModel({
      model: this.model,
      systemInstruction: systemPrompt,
      ...(geminiTools ? { tools: geminiTools } : {}),
    });

    // Build chat history (all turns except the last user message)
    const rawHistory = messages.slice(0, -1).map((m) => ({
      role: m.role === "user" ? ("user" as const) : ("model" as const),
      parts: [{ text: m.content }],
    }));

    // Gemini requires history to start with 'user' role.
    // If the agent sent a greeting before any user turn, drop leading model
    // entries so startChat() doesn't throw.
    let firstUser = rawHistory.findIndex((h) => h.role === "user");
    const history = firstUser === -1 ? [] : rawHistory.slice(firstUser);

    const lastMessage = messages[messages.length - 1]?.content ?? "";

    const chat = gemini.startChat({ history });
    const result = await chat.sendMessageStream(lastMessage);

    // Drain the stream — collect text tokens as they arrive.
    // Function call parts don't emit text, so we skip them here and check
    // response.functionCalls() after the stream is fully consumed.
    let full = "";
    for await (const chunk of result.stream) {
      const parts = chunk.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        if (part.text) {
          full += part.text;
          onToken(part.text);
        }
        // part.functionCall is handled below via response.functionCalls()
      }
    }

    // After stream, resolve the final response and check for function calls
    const response = await result.response;
    const functionCalls = response.functionCalls();

    const meta = response.usageMetadata;
    const usage: LLMUsage | undefined = meta
      ? { inputTokens: meta.promptTokenCount ?? 0, outputTokens: meta.candidatesTokenCount ?? 0 }
      : undefined;

    if (usage) options?.onUsage?.(usage);

    if (functionCalls?.length && options?.onToolCall) {
      const fc = functionCalls[0];
      options.onToolCall(fc.name, (fc.args ?? {}) as Record<string, unknown>);
    } else {
      onDone(full, usage);
    }
  }
}
