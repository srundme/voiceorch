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

/**
 * Returns the appropriate DispositionLLM instance.
 * Provider selection: agentCfgOverride > DISPOSITION_LLM env > "sarvam" default.
 * Returns null if the API key is unavailable (never crashes the webhook).
 */
export async function getDispositionLLM(
  agentCfgOverride?: string | null,
): Promise<DispositionLLM | null> {
  const provider =
    agentCfgOverride ??
    (process.env["DISPOSITION_LLM"] ?? "sarvam");

  if (provider === "openai") {
    const key = await getSetting("managed_openai_key");
    if (!key) {
      logger.warn("disposition: managed_openai_key not set, skipping LLM pass");
      return null;
    }
    return new OpenAIDispositionLLM(key);
  }

  // default: sarvam
  const key = await getSetting("managed_sarvam_key");
  if (!key) {
    logger.warn("disposition: managed_sarvam_key not set, skipping LLM pass");
    return null;
  }
  return new SarvamDispositionLLM(key);
}
