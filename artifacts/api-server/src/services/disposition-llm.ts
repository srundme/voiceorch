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

class OpenAIDispositionLLM implements DispositionLLM {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model = "gpt-4o-mini") {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async extract(
    systemPrompt: string,
    _schema: Record<string, unknown>,
    transcript: string,
  ): Promise<Record<string, unknown>> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0,
      response_format: { type: "json_object" },
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
    _schema: Record<string, unknown>,
    transcript: string,
  ): Promise<Record<string, unknown>> {
    // Prepend /no_think to disable Qwen3 extended reasoning — we only need the
    // structured JSON, not a reasoning chain.
    const response = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `/no_think\n${systemPrompt}` },
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
    _schema: Record<string, unknown>,
    transcript: string,
  ): Promise<Record<string, unknown>> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
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
