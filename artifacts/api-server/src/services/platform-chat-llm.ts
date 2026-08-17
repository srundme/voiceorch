/**
 * Platform-wide text LLM for builders / planners / drafts.
 * Default: Sarvam-hosted Gemma 4 (`gemma4` on /v2) — fast, no thinking.
 * Quality-sensitive callers (Vibe) pass `sarvam-105b` + reasoningEffort.
 * Gemini is not used here.
 */
import OpenAI from "openai";
import { db, platformSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  normalizeSarvamLlmModel,
  sarvamChatCompletionsUrl,
} from "../orchestration/adapters/llm/sarvam.js";

export const PLATFORM_CHAT_PROVIDER = "sarvam" as const;
export const PLATFORM_CHAT_MODEL = "gemma4" as const;

export async function getSarvamManagedKey(): Promise<string | null> {
  try {
    const [row] = await db
      .select()
      .from(platformSettingsTable)
      .where(eq(platformSettingsTable.key, "managed_sarvam_key"));
    const fromDb = (row?.value ?? "").trim();
    if (fromDb) return fromDb;
  } catch {
    /* fall through to env */
  }
  return (process.env["SARVAM_API_KEY"] ?? "").trim() || null;
}

function baseUrlForModel(model: string): string {
  // OpenAI SDK appends `/chat/completions` to baseURL.
  const full = sarvamChatCompletionsUrl(model);
  return full.replace(/\/chat\/completions$/, "");
}

/**
 * Non-streaming chat completion that returns the assistant text.
 * Throws on missing key, HTTP errors, or empty content.
 */
export async function platformChatText(opts: {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  model?: string;
  /** When true, request JSON object mode (caller must still parse). */
  json?: boolean;
  /**
   * Native Sarvam /v1 thinking. Omit or pass null to keep thinking off
   * (journeys / drafts). Vibe passes "high" on sarvam-105b.
   * gemma4 never reasons — this field is ignored for that model.
   */
  reasoningEffort?: "low" | "medium" | "high" | null;
}): Promise<string> {
  const key = await getSarvamManagedKey();
  if (!key) {
    throw new Error("No Sarvam API key configured (managed_sarvam_key / SARVAM_API_KEY)");
  }

  const model = normalizeSarvamLlmModel(opts.model ?? PLATFORM_CHAT_MODEL);
  const client = new OpenAI({
    apiKey: key,
    baseURL: baseUrlForModel(model),
    timeout: opts.timeoutMs ?? 90_000,
  });

  const response = await client.chat.completions.create({
    model,
    temperature: opts.temperature ?? 0.3,
    ...(opts.maxTokens != null ? { max_tokens: opts.maxTokens } : {}),
    ...(opts.json ? { response_format: { type: "json_object" as const } } : {}),
    messages: [
      { role: "system", content: opts.system },
      ...opts.messages,
    ],
    // gemma4 never reasons. Native /v1 defaults thinking ON — send null unless
    // the caller opted in, otherwise drafts burn tokens on chain-of-thought.
    ...(model === "gemma4"
      ? {}
      : ({
          reasoning_effort:
            opts.reasoningEffort === "low"
            || opts.reasoningEffort === "medium"
            || opts.reasoningEffort === "high"
              ? opts.reasoningEffort
              : null,
        } as object)),
  });

  const msg = response.choices[0]?.message as
    | { content?: string | null; reasoning_content?: string | null }
    | undefined;
  const content = (msg?.content ?? msg?.reasoning_content ?? "").trim();
  if (!content) throw new Error("platform_chat_empty");
  return content;
}
