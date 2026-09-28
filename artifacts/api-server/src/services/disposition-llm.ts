import OpenAI from "openai";
import { db, platformSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { parseDispositionModelJson } from "../lib/disposition/parse-model-json.js";

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
    this.client = new OpenAI({ apiKey, timeout: 15_000 });
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
      timeout: 15_000,
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

/** Default analytics/disposition model — Indic-tuned flagship reasoning. */
export const DEFAULT_SARVAM_DISPOSITION_MODEL = "sarvam-105b";

function resolveSarvamDispositionModel(): string {
  const fromEnv = (process.env["DISPOSITION_MODEL"] ?? "").trim();
  if (fromEnv) return fromEnv;
  return DEFAULT_SARVAM_DISPOSITION_MODEL;
}

function isSarvamOpenSourceModel(model: string): boolean {
  return model === "gemma4" || model === "glm5.2";
}

class SarvamDispositionLLM implements DispositionLLM {
  private client: OpenAI;
  private model: string;

  /**
   * Default: sarvam-105b on /v1 (Indic reasoning). Open-source hosts (gemma4,
   * glm5.2) use /v2. Override with DISPOSITION_MODEL.
   */
  constructor(apiKey: string, model = resolveSarvamDispositionModel()) {
    const openSource = isSarvamOpenSourceModel(model);
    this.client = new OpenAI({
      apiKey,
      baseURL: openSource ? "https://api.sarvam.ai/v2" : "https://api.sarvam.ai/v1",
      // Docs require api-subscription-key; SDK also sends Authorization: Bearer.
      defaultHeaders: { "api-subscription-key": apiKey },
      timeout: 30_000,
    });
    this.model = model;
  }

  async extract(
    systemPrompt: string,
    schema: Record<string, unknown>,
    transcript: string,
  ): Promise<Record<string, unknown>> {
    // Sarvam json_object mode does not enforce a schema, so embed it in the prompt.
    // Disable native /v1 thinking (reasoning_effort: null) so disposition responses return
    // in 2-3 seconds without eating token limits or timing out.
    const openSource = isSarvamOpenSourceModel(this.model);
    const response = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: withSchemaInstruction(systemPrompt, schema) },
        { role: "user", content: `TRANSCRIPT:\n${transcript}` },
      ],
      ...(!openSource ? ({ reasoning_effort: null } as object) : {}),
    });
    const msg = response.choices[0]?.message as
      | { content?: string | null; reasoning_content?: string | null }
      | undefined;
    const pieces = [msg?.content, msg?.reasoning_content].filter(
      (part): part is string => typeof part === "string" && part.trim().length > 0,
    );
    if (pieces.length === 0) throw new Error("disposition json parse failed");
    let last: unknown = null;
    for (const piece of pieces) {
      try {
        return parseDispositionModelJson(piece);
      } catch (err) {
        last = err;
      }
    }
    throw last instanceof Error ? last : new Error("disposition json parse failed");
  }
}


/** Resolve a managed key for a provider, falling back to env where applicable. */
async function resolveManagedKey(provider: string): Promise<string | null> {
  if (provider === "openai") {
    return (await getSetting("managed_openai_key"))?.trim() || (process.env["OPENAI_API_KEY"] ?? "").trim() || null;
  }
  if (provider === "sarvam") {
    return (await getSetting("managed_sarvam_key"))?.trim() || (process.env["SARVAM_API_KEY"] ?? "").trim() || null;
  }
  // qwen / groq — checks managed_groq_key, managed_qwen_key, or GROQ_API_KEY env.
  return (
    (await getSetting("managed_groq_key"))?.trim() ||
    (await getSetting("managed_qwen_key"))?.trim() ||
    (process.env["GROQ_API_KEY"] ?? "").trim() ||
    null
  );
}

function buildClient(provider: string, key: string): DispositionLLM {
  if (provider === "openai") return new OpenAIDispositionLLM(key);
  if (provider === "sarvam") return new SarvamDispositionLLM(key);
  return new QwenDispositionLLM(key);
}

/** Qwen/Groq removed from chain — model access 404s at call time. */
const FALLBACK_ORDER = ["sarvam", "openai"] as const;

function normalizeProvider(preferred: string): string {
  // Remap groq/qwen to sarvam — Qwen/Groq model access was unreliable (404).
  if (preferred === "groq" || preferred === "qwen") return "sarvam";
  // Legacy gemini/google overrides map to Sarvam — Gemini is no longer used.
  if (preferred === "google" || preferred === "gemini") return "sarvam";
  return preferred;
}

/**
 * Returns the appropriate DispositionLLM instance.
 * Provider selection: agentCfgOverride > DISPOSITION_LLM env > "sarvam" default
 * (sarvam-105b via DISPOSITION_MODEL / managed Sarvam key). Gemini and Qwen/Groq
 * are not in the chain. Falls back to OpenAI gpt-4o-mini when Sarvam is unavailable.
 */
export async function getDispositionLLM(
  agentCfgOverride?: string | null,
): Promise<DispositionLLM | null> {
  const preferred = normalizeProvider(
    (agentCfgOverride ?? process.env["DISPOSITION_LLM"] ?? "sarvam").toLowerCase(),
  );

  const order = [preferred, ...FALLBACK_ORDER.filter((p) => p !== preferred)];

  for (const provider of order) {
    const key = await resolveManagedKey(provider);
    if (key) {
      if (provider !== preferred) {
        logger.info({ preferred, using: provider }, "disposition: preferred LLM key missing, falling back");
      }
      return buildClient(provider, key);
    }
  }

  logger.warn("disposition: no managed LLM key configured (sarvam/openai/qwen), skipping LLM pass");
  return null;
}

/**
 * Returns every available DispositionLLM in preference order, so callers can
 * fall back to the next provider when one fails at call time.
 */
export async function getDispositionLLMChain(
  agentCfgOverride?: string | null,
): Promise<Array<{ provider: string; client: DispositionLLM }>> {
  const preferred = normalizeProvider(
    (agentCfgOverride ?? process.env["DISPOSITION_LLM"] ?? "sarvam").toLowerCase(),
  );
  const order = [preferred, ...FALLBACK_ORDER.filter((p) => p !== preferred)];

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
    return status === 400 || status === 401 || status === 403 || status === 429 || status >= 500;
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
    msg.includes("overload") ||
    msg.includes("timed out") ||
    msg.includes("timeout") ||
    msg.includes("json parse failed")
  );
}
