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

  constructor(apiKey: string, model = "sarvam-30b") {
    this.client = new OpenAI({
      apiKey,
      baseURL: "https://api.sarvam.ai/v1",
    });
    this.model = model;
  }

  async extract(
    systemPrompt: string,
    schema: Record<string, unknown>,
    transcript: string,
  ): Promise<Record<string, unknown>> {
    // Sarvam json_object mode does not enforce a schema, so embed it in the prompt.
    const response = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: withSchemaInstruction(systemPrompt, schema) },
        { role: "user", content: `TRANSCRIPT:\n${transcript}` },
      ],
    });
    const content = response.choices[0]?.message?.content ?? "{}";
    return JSON.parse(content) as Record<string, unknown>;
  }
}

/** Resolve a managed key for a provider, falling back to env where applicable. */
async function resolveManagedKey(provider: string): Promise<string | null> {
  if (provider === "openai") {
    return (await getSetting("managed_openai_key"))?.trim() || null;
  }
  if (provider === "sarvam") {
    return (await getSetting("managed_sarvam_key"))?.trim() || null;
  }
  // qwen / groq — both share managed_qwen_key (Groq-hosted Qwen), with the
  // GROQ_API_KEY env as a runtime fallback (matches wizard.ts behaviour).
  return (
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

/**
 * Returns the appropriate DispositionLLM instance.
 * Provider selection: agentCfgOverride > DISPOSITION_LLM env > "qwen" default.
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
    "qwen"
  ).toLowerCase();

  const normalized = preferred === "groq" ? "qwen" : preferred;

  // Try the preferred provider first, then fall back to the others so a
  // single configured managed key is enough to run classification.
  const order = [normalized, ...["qwen", "openai", "sarvam"].filter((p) => p !== normalized)];

  for (const provider of order) {
    const key = await resolveManagedKey(provider);
    if (key) {
      if (provider !== normalized) {
        logger.info({ preferred: normalized, using: provider }, "disposition: preferred LLM key missing, falling back");
      }
      return buildClient(provider, key);
    }
  }

  logger.warn("disposition: no managed LLM key configured (qwen/openai/sarvam), skipping LLM pass");
  return null;
}
