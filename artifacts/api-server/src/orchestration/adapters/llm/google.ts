import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import type { FunctionDeclarationSchema, FunctionDeclarationSchemaProperty } from "@google/generative-ai";
import type { ConversationTurn, LLMAdapter, LLMUsage, ToolDefinition } from "../../types.js";

// ── Gemini-scoped reasoning/preamble backstop (GEMINI ONLY) ──────────────────
// Defense-in-depth for the rare case where Gemini emits its planning narration as
// plain UNTAGGED content (i.e. NOT flagged `thought:true` and NOT wrapped in any
// <think>/<reasoning> tag), so neither the adapter's thought-part discard nor the
// shared pipeline reasoning filters catch it. These helpers strip the leading
// planning preamble Gemini 2.5 tends to leak — bracketed state/context lines and a
// "New response …:" planning→reply handoff — before it reaches TTS/transcript.
//
// This MUST stay scoped to the Gemini adapter. Do NOT move it into the shared
// reasoningFilter used by every provider. It is deliberately conservative: it only
// touches a LEADING preamble and never holds back or truncates real reply text.

/** A COMPLETE leading bracketed state/context line, e.g. "[DATE/TIME CONTEXT] …\n". */
const GEMINI_BRACKET_LINE_RE = /^[ \t]*\[[^\]\n]+\][^\n]*\r?\n/;
/** Planning→reply handoff marker, matched AT the phrase so planning narration before it is captured. */
const GEMINI_HANDOFF_RE = /\bnew response\b[^:\n]*:[ \t]*/i;
/** First-person planning cues that gate the handoff cut (so a normal reply is never cut). */
const GEMINI_PLANNING_CUE_RE =
  /\b(the user|the caller|i should|i will|i'?ll|let me|based on|acknowledge|i need to|i'?m going to)\b/i;

/**
 * Whole-string strip used for the final assembled reply (transcript/history). Removes
 * leading bracketed state/context lines and, when planning narration precedes it, cuts
 * everything up to and including a "New response …:" handoff. Conservative: a bracketed
 * token or the phrase appearing inside a genuine reply is never touched.
 */
export function stripGeminiThinkingPreamble(text: string): string {
  if (!text) return text;
  let out = text;
  for (;;) {
    const m = out.match(GEMINI_BRACKET_LINE_RE);
    if (!m) break;
    out = out.slice(m[0].length);
  }
  const h = out.match(GEMINI_HANDOFF_RE);
  if (h && h.index !== undefined) {
    const before = out.slice(0, h.index);
    const after = out.slice(h.index + h[0].length);
    if (after.trim() && GEMINI_PLANNING_CUE_RE.test(before)) {
      out = after;
    }
  }
  return out.replace(/^\s+/, "");
}

/**
 * Streaming counterpart of stripGeminiThinkingPreamble. Returns the visible (spoken)
 * portion of each token. State is retained across calls; create one per generation.
 *
 * Safety contract — it NEVER holds back or truncates real reply text:
 *   • Strips COMPLETE leading bracketed lines as they finish.
 *   • If a "New response …:" handoff is ALREADY visible (with planning cues before it),
 *     drops the preamble up to it, then passes the rest through.
 *   • Otherwise releases reply text immediately and switches to pass-through. It never
 *     waits for a handoff that may not arrive, so a legitimate reply is never delayed.
 */
export function makeGeminiPreambleGuard(): (token: string) => string {
  let committed = false;
  let buf = "";
  // Bound on how long we wait for an unterminated leading bracket line to close.
  const OPEN_BRACKET_WAIT_LIMIT = 200;
  return function guard(token: string): string {
    if (committed) return token;
    buf += token;
    // Strip any COMPLETE leading bracketed lines as they finish.
    for (;;) {
      const m = buf.match(GEMINI_BRACKET_LINE_RE);
      if (!m) break;
      buf = buf.slice(m[0].length);
    }
    const lead = buf.replace(/^\s+/, "");
    // Only whitespace / stripped brackets so far → wait for more.
    if (lead === "") return "";
    // Still building an unterminated leading bracket line → wait so we can strip it,
    // but give up (release as-is) past the bound so a reply can never be truncated.
    if (lead.startsWith("[") && !lead.includes("\n") && buf.length < OPEN_BRACKET_WAIT_LIMIT) {
      return "";
    }
    // A handoff marker is already visible and planning narration precedes it → drop it.
    const h = buf.match(GEMINI_HANDOFF_RE);
    if (h && h.index !== undefined && GEMINI_PLANNING_CUE_RE.test(buf.slice(0, h.index))) {
      const after = buf.slice(h.index + h[0].length);
      committed = true;
      buf = "";
      return after.replace(/^\s+/, "");
    }
    // Real reply text — release now and pass everything through from here on.
    committed = true;
    buf = "";
    return lead;
  };
}

/**
 * Google Gemini — streaming generative AI with function calling
 * Models: gemini-2.5-flash-lite (fastest), gemini-2.5-flash (recommended), gemini-2.5-pro, gemini-1.5-flash
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
                    ...(val.enum ? { enum: val.enum, format: "enum" } : {}),
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
      // Disable thinking for voice — adds 2–5 s TTFT with no benefit for short
      // conversational turns. thinkingBudget:0 turns thinking off; includeThoughts:
      // false guarantees the API never returns reasoning ("thought") parts. Both are
      // passed through to the REST endpoint by the legacy SDK (which does not type them).
      generationConfig: {
        thinkingConfig: { thinkingBudget: 0, includeThoughts: false },
      } as any,
    });

    // Build chat history (all turns except the last) — map tool turns to
    // Gemini's functionCall/functionResponse format so chained tool calls work.
    const rawHistory = messages.slice(0, -1).map((m) => {
      if (m.role === "tool") {
        return {
          role: "user" as const,
          parts: [{ functionResponse: { name: m.toolName ?? "tool", response: { result: m.content } } }],
        };
      }
      if (m.role === "assistant" && m.toolCalls?.length) {
        return {
          role: "model" as const,
          parts: m.toolCalls.map((tc) => ({
            functionCall: {
              name: tc.name,
              args: (() => { try { return JSON.parse(tc.args || "{}") as Record<string, unknown>; } catch { return {}; } })(),
            },
          })),
        };
      }
      return {
        role: m.role === "user" ? ("user" as const) : ("model" as const),
        parts: [{ text: m.content }],
      };
    });

    // Gemini requires history to start with 'user' role.
    // If the agent sent a greeting before any user turn, drop leading model
    // entries so startChat() doesn't throw.
    let firstUser = rawHistory.findIndex((h) => h.role === "user");
    const history = firstUser === -1 ? [] : rawHistory.slice(firstUser);

    // Build the "current" message — if it's a tool result, send as a FunctionResponse part.
    const lastTurn = messages[messages.length - 1];
    const lastMessage: string | import("@google/generative-ai").Part[] =
      lastTurn?.role === "tool"
        ? [{ functionResponse: { name: lastTurn.toolName ?? "tool", response: { result: lastTurn.content } } }]
        : (lastTurn?.content ?? "");

    const chat = gemini.startChat({ history });
    const result = await chat.sendMessageStream(lastMessage);

    // Drain the stream — collect text tokens as they arrive.
    // Function call parts don't emit text, so we skip them here and check
    // response.functionCalls() after the stream is fully consumed.
    let full = "";
    const preambleGuard = makeGeminiPreambleGuard();
    for await (const chunk of result.stream) {
      const parts = chunk.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        // Gemini returns reasoning as parts flagged `thought:true`. They are NOT
        // reply text — never accumulate them and never forward them to onToken, or
        // the model's chain-of-thought gets spoken and shown in the transcript.
        // (The SDK type omits `thought`, so read it defensively.)
        if ((part as { thought?: boolean }).thought === true) continue;
        if (part.text) {
          full += part.text;
          // Gemini-scoped backstop for untagged planning narration leaking as plain
          // content. Yields nothing while suppressing a leading preamble.
          const visible = preambleGuard(part.text);
          if (visible) onToken(visible);
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
      // Strip any leading planning preamble from the final assembled reply so the
      // stored transcript/history matches the (already-guarded) spoken stream.
      onDone(stripGeminiThinkingPreamble(full), usage);
    }
  }
}
