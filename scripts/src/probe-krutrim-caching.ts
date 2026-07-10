/**
 * Standalone probe: does Krutrim Cloud's OpenAI-compatible API do implicit
 * prompt-prefix caching (like OpenAI/Anthropic's automatic prefix cache)?
 *
 * Method: send the SAME long (~8K-char) system prompt + a short user message
 * 3x per model, back-to-back. Record TTFT (time to first streamed token) for
 * each attempt and inspect `usage`/`prompt_tokens_details` for any
 * cached-token signal. If caching exists, request 2+ should show materially
 * lower TTFT than request 1 and/or an explicit cached-token field > 0.
 *
 * Usage: KRUTRIM_CLOUD_API_KEY=... tsx ./src/probe-krutrim-caching.ts
 */
import OpenAI from "openai";

const API_KEY = process.env["KRUTRIM_CLOUD_API_KEY"];
if (!API_KEY) {
  console.error("KRUTRIM_CLOUD_API_KEY is required.");
  process.exit(1);
}

const client = new OpenAI({ apiKey: API_KEY, baseURL: "https://cloud.olakrutrim.com/v1" });

// Models used in production voice agents (see krutrim.ts catalogue).
const MODELS = ["gpt-oss-20b", "gemma-4-E4B-it"];

const ATTEMPTS_PER_MODEL = 6;

// ~8K-char synthetic static prompt (mirrors a real baked-KB system prompt).
function buildLongPrompt(): string {
  const filler =
    "This is a detailed knowledge base entry describing product features, pricing tiers, support policies, and operational procedures relevant to customer inquiries. ";
  let s = "You are a helpful voice assistant. Use the following knowledge base to answer questions accurately.\n\n";
  while (s.length < 8000) s += filler;
  return s.slice(0, 8000);
}

async function probeOnce(model: string, systemPrompt: string, attempt: number) {
  const t0 = Date.now();
  let ttft: number | null = null;
  const stream = await client.chat.completions.create(
    {
      model,
      stream: true,
      max_tokens: 600, // thinking models (Qwen3.x) need >=500
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Attempt ${attempt}: In one sentence, what is this knowledge base about?` },
      ],
    },
    { timeout: 30000 },
  );

  let usage: unknown = null;
  for await (const chunk of stream) {
    if (ttft === null && chunk.choices?.[0]?.delta?.content) {
      ttft = Date.now() - t0;
    }
    if (chunk.usage) usage = chunk.usage;
  }
  return { ttft, usage };
}

async function main() {
  const systemPrompt = buildLongPrompt();
  console.log(`Prompt length: ${systemPrompt.length} chars\n`);

  for (const model of MODELS) {
    console.log(`\n=== Model: ${model} ===`);
    for (let i = 1; i <= ATTEMPTS_PER_MODEL; i++) {
      try {
        const { ttft, usage } = await probeOnce(model, systemPrompt, i);
        console.log(`  attempt ${i}: TTFT=${ttft}ms  usage=${JSON.stringify(usage)}`);
      } catch (err) {
        console.log(`  attempt ${i}: ERROR ${err instanceof Error ? err.message : String(err)}`);
      }
      // Small gap between requests, but well within any plausible cache TTL.
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
