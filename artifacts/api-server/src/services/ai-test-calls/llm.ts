/**
 * JSON generation for AI Test Calls briefs and personas. Reasoning-heavy and
 * long-context (prompts up to ~24k chars), so prefer general models over the
 * extraction-tuned disposition chain, which stays as the last fallback.
 *
 * Order: managed Gemini pool (DEFAULT_GOOGLE_LLM_MODEL) → managed OpenAI
 * (gpt-4.1-mini) → Sarvam 105B (platform chat) → disposition chain.
 */

import OpenAI from "openai";
import { GoogleGenAI } from "@google/genai";
import { db, platformSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../../lib/logger.js";
import { parseDispositionModelJson } from "../../lib/disposition/parse-model-json.js";
import {
  isGeminiQuotaError,
  loadManagedGeminiKeys,
  markGeminiKeyExhausted,
  pickGeminiKeyFromList,
} from "../../lib/gemini-key-pool.js";
import { DEFAULT_GOOGLE_LLM_MODEL } from "../../orchestration/adapters/llm/google.js";
import { platformChatText } from "../platform-chat-llm.js";
import { getDispositionLLMChain } from "../disposition-llm.js";

export interface TestJsonRequest {
  /** For logs only. */
  label: string;
  system: string;
  user: string;
  /** Embedded in the prompt (providers differ in schema enforcement). */
  schema: Record<string, unknown>;
  temperature: number;
  maxOutputTokens?: number;
}

export interface TestJsonResult {
  data: Record<string, unknown>;
  provider: string;
}

export class TestLlmUnavailableError extends Error {
  override name = "TestLlmUnavailableError";
}

const OPENAI_MODEL = "gpt-4.1-mini";
const SARVAM_MODEL = "sarvam-105b";
const REQUEST_TIMEOUT_MS = 90_000;
const MAX_GEMINI_KEY_TRIES = 3;

function systemWithSchema(req: TestJsonRequest): string {
  return `${req.system}\n\nRespond with ONE JSON object that conforms to this JSON Schema (exact keys, no extra keys, no prose, no code fences):\n${JSON.stringify(req.schema)}`;
}

async function setting(key: string): Promise<string | null> {
  try {
    const [row] = await db.select().from(platformSettingsTable).where(eq(platformSettingsTable.key, key));
    return row?.value?.trim() || null;
  } catch {
    return null;
  }
}

async function viaGemini(req: TestJsonRequest): Promise<Record<string, unknown> | null> {
  const pool = await loadManagedGeminiKeys();
  if (pool.length === 0) return null;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < Math.min(MAX_GEMINI_KEY_TRIES, pool.length); attempt++) {
    const key = pickGeminiKeyFromList(pool);
    if (!key) break;
    try {
      const ai = new GoogleGenAI({ apiKey: key, httpOptions: { timeout: REQUEST_TIMEOUT_MS } });
      const res = await ai.models.generateContent({
        model: DEFAULT_GOOGLE_LLM_MODEL,
        contents: req.user,
        config: {
          systemInstruction: systemWithSchema(req),
          temperature: req.temperature,
          responseMimeType: "application/json",
          maxOutputTokens: req.maxOutputTokens ?? 16_000,
        },
      });
      return parseDispositionModelJson(res.text ?? "");
    } catch (err) {
      lastErr = err;
      if (!isGeminiQuotaError(err)) throw err;
      markGeminiKeyExhausted(key);
    }
  }
  throw lastErr ?? new Error("gemini unavailable");
}

async function viaOpenAI(req: TestJsonRequest): Promise<Record<string, unknown> | null> {
  const key = (await setting("managed_openai_key")) || (process.env["OPENAI_API_KEY"] ?? "").trim();
  if (!key) return null;
  const client = new OpenAI({ apiKey: key, timeout: REQUEST_TIMEOUT_MS });
  const res = await client.chat.completions.create({
    model: OPENAI_MODEL,
    temperature: req.temperature,
    max_tokens: req.maxOutputTokens ?? 16_000,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemWithSchema(req) },
      { role: "user", content: req.user },
    ],
  });
  return parseDispositionModelJson(res.choices[0]?.message?.content ?? "");
}

async function viaSarvam(req: TestJsonRequest): Promise<Record<string, unknown> | null> {
  const text = await platformChatText({
    model: SARVAM_MODEL,
    system: systemWithSchema(req),
    messages: [{ role: "user", content: req.user }],
    temperature: req.temperature,
    json: true,
    reasoningEffort: null,
    timeoutMs: REQUEST_TIMEOUT_MS,
  });
  return parseDispositionModelJson(text);
}

/**
 * Try providers in order until one returns parseable JSON that `accept`
 * approves. Throws TestLlmUnavailableError when none do.
 */
export async function generateTestJson(
  req: TestJsonRequest,
  accept: (data: Record<string, unknown>) => boolean = () => true,
): Promise<TestJsonResult> {
  const providers: Array<[string, (r: TestJsonRequest) => Promise<Record<string, unknown> | null>]> = [
    ["gemini", viaGemini],
    ["openai", viaOpenAI],
    ["sarvam", viaSarvam],
  ];
  let tried = 0;
  for (const [provider, run] of providers) {
    try {
      const data = await run(req);
      if (data == null) continue;
      tried++;
      if (accept(data)) return { data, provider };
      logger.warn({ provider, label: req.label }, "ai-test-calls: model output rejected");
    } catch (err) {
      tried++;
      logger.warn({ provider, label: req.label, err: err instanceof Error ? err.message : String(err) }, "ai-test-calls: provider failed");
    }
  }
  for (const { provider, client } of await getDispositionLLMChain()) {
    tried++;
    try {
      const data = await client.extract(req.system, req.schema, req.user);
      if (accept(data)) return { data, provider: `${provider}-extract` };
    } catch (err) {
      logger.warn({ provider, label: req.label, err: err instanceof Error ? err.message : String(err) }, "ai-test-calls: fallback provider failed");
    }
  }
  throw new TestLlmUnavailableError(tried === 0 ? "no AI model configured" : "no model returned usable output");
}
