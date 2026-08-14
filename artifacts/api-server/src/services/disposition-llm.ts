import OpenAI from "openai";
import { db, platformSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";

/**
 * Minimal interface for disposition LLM extraction.
 * Only JSON output needed — no streaming.
 */
export interface DispositionLLM {
  extract(systemPrompt: string, schema: Record<string, unknown>, transcript: string): Promise<Record<string, unknown>>;
}

async function getSetting(key: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(platformSettingsTable)
    .where(eq(platformSettingsTable.key, key));
  return row?.value ?? null;
}

/**
 * Appends the JSON Schema to the system prompt so providers that only support
 * `json_object` mode (Groq/Qwen, Sarvam) still emit the exact expected keys.
 */
function withSchemaInstruction(systemPrompt: string, schema: Record<string, unknown>): string {
  return `${systemPrompt}

Your JSON response MUST conform exactly to this JSON Schema (use these exact top-level keys, no others):
${JSON.stringify(schema)}`;
}

class OpenAIDispositionLLM implements DispositionLLM {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model = "gpt-4o-mini") {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async extract(
    systemPrompt: string,
    schema: Record<string, unknown>,
    transcript: string,
  ): Promise<Record<string, unknown>> {
    // OpenAI supports strict structured output — constrain the model to the
    // built JSON Schema so it must emit the exact `primary`/`sub` keys.
    const response = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0,
      response_format: {
        type: "json_schema",
        json_schema: { name: "disposition", strict: true, schema },
      },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `TRANSCRIPT:\n${transcript}` },
      ],
    });
    const content = response.choices[0]?.message?.content ?? "{}";
    return JSON.parse(content) as Record<string, unknown>;
  }
}

class QwenDispositionLLM implements DispositionLLM {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model = "qwen/qwen3-32b") {
    this.client = new OpenAI({
      apiKey,
      baseURL: "https://api.groq.com/openai/v1",
    });
    this.model = model;
  }

  async extract(
    systemPrompt: string,
    schema: Record<string, unknown>,
    transcript: string,
  ): Promise<Record<string, unknown>> {
    // Prepend /no_think to disable Qwen3 extended reasoning — we only need the
    // structured JSON, not a reasoning chain. Groq json_object mode does not
    // enforce a schema, so the schema is embedded in the prompt instead.
    const response = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `/no_think\n${withSchemaInstruction(systemPrompt, schema)}` },
        { role: "user", content: `TRANSCRIPT:\n${transcript}` },
      ],
    });
    const content = response.choices[0]?.message?.content ?? "{}";
    return JSON.parse(content) as Record<string, unknown>;
  }
}

class SarvamDispositionLLM implements DispositionLLM {
  private client: OpenAI;
  private model: string;

  /**
   * Default: Gemma 4 on Sarvam /v2 (open-source host). Native Sarvam models
   * use /v1 — route by model id so we can still fall back to sarvam-105b.
   */
  constructor(apiKey: string, model = "gemma4") {
    const openSource = model === "gemma4" || model === "glm5.2";
    this.client = new OpenAI({
      apiKey,
      baseURL: openSource ? "https://api.sarvam.ai/v2" : "https://api.sarvam.ai/v1",
    });
    this.model = model;
  }

  async extract(
    systemPrompt: string,
    schema: Record<string, unknown>,
    transcript: string,
  ): Promise<Record<string, unknown>> {
    // Sarvam json_object mode does not enforce a schema, so embed it in the prompt.
    // gemma4 never reasons — omit reasoning_effort. Native models default thinking
    // ON at "low"; disable so reasoning doesn't consume the token budget.
    const response = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: withSchemaInstruction(systemPrompt, schema) },
        { role: "user", content: `TRANSCRIPT:\n${transcript}` },
      ],
      ...(this.model !== "gemma4" ? ({ reasoning_effort: null } as object) : {}),
    });
    const msg = response.choices[0]?.message as
      | { content?: string | null; reasoning_content?: string | null }
      | undefined;
    const content = msg?.content ?? msg?.reasoning_content ?? "{}";
    return JSON.parse(content) as Record<string, unknown>;
  }
}

class GeminiDispositionLLM implements DispositionLLM {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model = "gemini-3.6-flash") {
    this.client = new OpenAI({
      apiKey,
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    });
    this.model = model;
  }

  async extract(
    systemPrompt: string,
    schema: Record<string, unknown>,
    transcript: string,
  ): Promise<Record<string, unknown>> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: withSchemaInstruction(systemPrompt, schema) },
        { role: "user", content: `TRANSCRIPT:\n${transcript}` },
      ],
    });
    const rawContent = response.choices[0]?.message?.content ?? "{}";
    // Strip codeblock markdown if present
    const cleaned = rawContent.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
    return JSON.parse(cleaned) as Record<string, unknown>;
  }
}

/** Resolve a managed key for a provider, falling back to env where applicable. */
async function resolveManagedKey(provider: string): Promise<string | null> {
  if (provider === "gemini" || provider === "google") {
    return (
      (await getSetting("managed_gemini_key"))?.trim() ||
      (process.env["GEMINI_API_KEY"] ?? "").trim() ||
      (process.env["GOOGLE_API_KEY"] ?? "").trim() ||
      null
    );
  }
  if (provider === "openai") {
    return (await getSetting("managed_openai_key"))?.trim() || (process.env["OPENAI_API_KEY"] ?? "").trim() || null;
  }
  if (provider === "sarvam") {
    return (await getSetting("managed_sarvam_key"))?.trim() || (process.env["SARVAM_API_KEY"] ?? "").trim() || null;
  }
  // qwen / groq — both share managed_qwen_key (Groq-hosted Qwen), with the
  // GROQ_API_KEY env as a runtime fallback.
  return (
    (await getSetting("managed_qwen_key"))?.trim() ||
    (process.env["GROQ_API_KEY"] ?? "").trim() ||
    null
  );
}

function buildClient(provider: string, key: string): DispositionLLM {
  if (provider === "gemini" || provider === "google") return new GeminiDispositionLLM(key);
  if (provider === "openai") return new OpenAIDispositionLLM(key);
  if (provider === "sarvam") return new SarvamDispositionLLM(key);
  return new QwenDispositionLLM(key);
}

/**
 * Returns the appropriate DispositionLLM instance.
 * Provider selection: agentCfgOverride > DISPOSITION_LLM env > "sarvam" default
 * (Gemma 4 via managed Sarvam key — Gemini is still available as a fallback).
 * Falls back to any other provider whose managed key is configured, so
 * classification still runs as long as ONE managed key exists.
 * Returns null only if no managed key is available (never crashes the caller).
 */
export async function getDispositionLLM(
  agentCfgOverride?: string | null,
): Promise<DispositionLLM | null> {
  const preferred = (
    agentCfgOverride ??
    process.env["DISPOSITION_LLM"] ??
    "sarvam"
  ).toLowerCase();

  const normalized = (preferred === "groq" || preferred === "qwen") ? "qwen" : (preferred === "google" ? "gemini" : preferred);

  // Prefer Sarvam Gemma 4 first; Gemini / OpenAI / Groq remain as fallbacks.
  const order = [normalized, ...["sarvam", "openai", "qwen", "gemini"].filter((p) => p !== normalized)];

  for (const provider of order) {
    const key = await resolveManagedKey(provider);
    if (key) {
      if (provider !== normalized) {
        logger.info({ preferred: normalized, using: provider }, "disposition: preferred LLM key missing, falling back");
      }
      return buildClient(provider, key);
    }
  }

  logger.warn("disposition: no managed LLM key configured (sarvam/openai/qwen/gemini), skipping LLM pass");
  return null;
}

/**
 * Returns every available DispositionLLM in preference order, so callers can
 * fall back to the next provider when one fails at call time (e.g. Gemini 403
 * from a billing/permission issue). Empty when no managed key is configured.
 */
export async function getDispositionLLMChain(
  agentCfgOverride?: string | null,
): Promise<Array<{ provider: string; client: DispositionLLM }>> {
  const preferred = (agentCfgOverride ?? process.env["DISPOSITION_LLM"] ?? "sarvam").toLowerCase();
  const normalized =
    preferred === "groq" || preferred === "qwen" ? "qwen" : preferred === "google" ? "gemini" : preferred;
  const order = [normalized, ...["sarvam", "openai", "qwen", "gemini"].filter((p) => p !== normalized)];

  const chain: Array<{ provider: string; client: DispositionLLM }> = [];
  for (const provider of order) {
    const key = await resolveManagedKey(provider);
    if (key) chain.push({ provider, client: buildClient(provider, key) });
  }
  return chain;
}

/** True when an LLM error is provider-level (auth/quota/overload) and worth retrying on another provider. */
export function isRetryableProviderError(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  if (typeof status === "number") {
    return status === 401 || status === 403 || status === 429 || status >= 500;
  }
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("403") ||
    msg.includes("401") ||
    msg.includes("429") ||
    msg.includes("quota") ||
    msg.includes("permission") ||
    msg.includes("billing") ||
    msg.includes("unavailable") ||
    msg.includes("overload")
  );
}
