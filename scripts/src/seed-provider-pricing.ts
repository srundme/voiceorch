import { db, providerPricingTable } from "@workspace/db";
import { sql } from "drizzle-orm";

// All prices stored as USD micros (1 USD = 1_000_000 micros).
// Token prices are per 1,000,000 tokens. Audio is per second. Characters is per character.
// Sources: public list prices as of mid-2025. Update via /admin/usage/pricing UI as needed.
//
// Rule of thumb: 1 USD per million tokens = 1_000_000 micros per million.
// e.g. $0.50 / 1M tokens = 500_000 micros per million.

type Row = {
  service: "stt" | "tts" | "llm";
  provider: string;
  model: string;
  inputTokenPricePerMillionMicros?: number;
  outputTokenPricePerMillionMicros?: number;
  audioSecondPriceMicros?: number;
  characterPriceMicros?: number;
};

// helper: dollars-per-million-tokens -> micros-per-million-tokens
const dpmt = (usd: number) => Math.round(usd * 1_000_000);
// helper: dollars-per-minute audio -> micros-per-second
const audMin = (usdPerMin: number) => Math.round((usdPerMin / 60) * 1_000_000);
// helper: dollars-per-1k characters -> micros-per-character
const charK = (usdPer1k: number) => Math.round((usdPer1k / 1000) * 1_000_000);
// helper: dollars-per-1M characters -> micros-per-character
const charM = (usdPer1M: number) => Math.round((usdPer1M / 1_000_000) * 1_000_000);

const ROWS: Row[] = [
  // ── STT (per audio second) ────────────────────────────────────────────────
  // Deepgram Nova-2 / Nova-3 streaming: ~$0.0043/min
  { service: "stt", provider: "deepgram", model: "default", audioSecondPriceMicros: audMin(0.0043) },
  { service: "stt", provider: "deepgram", model: "nova-2", audioSecondPriceMicros: audMin(0.0043) },
  { service: "stt", provider: "deepgram", model: "nova-3", audioSecondPriceMicros: audMin(0.0058) },
  // Azure Speech: $1/hour ≈ $0.01667/min
  { service: "stt", provider: "azure", model: "default", audioSecondPriceMicros: audMin(0.01667) },
  // AssemblyAI streaming: ~$0.15/hour ≈ $0.0025/min; nano async ~$0.12/hour
  { service: "stt", provider: "assemblyai", model: "default", audioSecondPriceMicros: audMin(0.0025) },
  // Sarvam ASR ~$0.006/min (public pricing)
  { service: "stt", provider: "sarvam", model: "default", audioSecondPriceMicros: audMin(0.006) },
  { service: "stt", provider: "sarvam", model: "saaras:v2", audioSecondPriceMicros: audMin(0.006) },
  { service: "stt", provider: "sarvam", model: "saaras:v3", audioSecondPriceMicros: audMin(0.006) },
  { service: "stt", provider: "sarvam", model: "saarika:v2", audioSecondPriceMicros: audMin(0.006) },
  { service: "stt", provider: "sarvam", model: "saarika:v2.5", audioSecondPriceMicros: audMin(0.006) },
  // Cartesia STT (Ink): ~$0.0035/min
  { service: "stt", provider: "cartesia", model: "default", audioSecondPriceMicros: audMin(0.0035) },
  // Whisper (OpenAI) batch: $0.006/min
  { service: "stt", provider: "whisper", model: "default", audioSecondPriceMicros: audMin(0.006) },
  { service: "stt", provider: "openai", model: "whisper-1", audioSecondPriceMicros: audMin(0.006) },

  // ── LLM (per million tokens, input / output) ──────────────────────────────
  // OpenAI
  { service: "llm", provider: "openai", model: "default", inputTokenPricePerMillionMicros: dpmt(0.15), outputTokenPricePerMillionMicros: dpmt(0.6) },
  { service: "llm", provider: "openai", model: "gpt-4o-mini", inputTokenPricePerMillionMicros: dpmt(0.15), outputTokenPricePerMillionMicros: dpmt(0.6) },
  { service: "llm", provider: "openai", model: "gpt-4o", inputTokenPricePerMillionMicros: dpmt(2.5), outputTokenPricePerMillionMicros: dpmt(10) },
  { service: "llm", provider: "openai", model: "gpt-4.1", inputTokenPricePerMillionMicros: dpmt(2), outputTokenPricePerMillionMicros: dpmt(8) },
  { service: "llm", provider: "openai", model: "gpt-4.1-mini", inputTokenPricePerMillionMicros: dpmt(0.4), outputTokenPricePerMillionMicros: dpmt(1.6) },
  { service: "llm", provider: "openai", model: "gpt-4.1-nano", inputTokenPricePerMillionMicros: dpmt(0.1), outputTokenPricePerMillionMicros: dpmt(0.4) },
  // Anthropic
  { service: "llm", provider: "anthropic", model: "default", inputTokenPricePerMillionMicros: dpmt(0.8), outputTokenPricePerMillionMicros: dpmt(4) },
  { service: "llm", provider: "anthropic", model: "claude-3-5-haiku-20241022", inputTokenPricePerMillionMicros: dpmt(0.8), outputTokenPricePerMillionMicros: dpmt(4) },
  { service: "llm", provider: "anthropic", model: "claude-3-5-sonnet-20241022", inputTokenPricePerMillionMicros: dpmt(3), outputTokenPricePerMillionMicros: dpmt(15) },
  { service: "llm", provider: "anthropic", model: "claude-sonnet-4-20250514", inputTokenPricePerMillionMicros: dpmt(3), outputTokenPricePerMillionMicros: dpmt(15) },
  { service: "llm", provider: "anthropic", model: "claude-opus-4-20250514", inputTokenPricePerMillionMicros: dpmt(15), outputTokenPricePerMillionMicros: dpmt(75) },
  // DeepSeek
  { service: "llm", provider: "deepseek", model: "default", inputTokenPricePerMillionMicros: dpmt(0.27), outputTokenPricePerMillionMicros: dpmt(1.1) },
  { service: "llm", provider: "deepseek", model: "deepseek-chat", inputTokenPricePerMillionMicros: dpmt(0.27), outputTokenPricePerMillionMicros: dpmt(1.1) },
  { service: "llm", provider: "deepseek", model: "deepseek-reasoner", inputTokenPricePerMillionMicros: dpmt(0.55), outputTokenPricePerMillionMicros: dpmt(2.19) },
  // Mistral
  { service: "llm", provider: "mistral", model: "default", inputTokenPricePerMillionMicros: dpmt(0.2), outputTokenPricePerMillionMicros: dpmt(0.6) },
  { service: "llm", provider: "mistral", model: "mistral-small-latest", inputTokenPricePerMillionMicros: dpmt(0.2), outputTokenPricePerMillionMicros: dpmt(0.6) },
  { service: "llm", provider: "mistral", model: "mistral-large-latest", inputTokenPricePerMillionMicros: dpmt(2), outputTokenPricePerMillionMicros: dpmt(6) },
  // Cohere
  { service: "llm", provider: "cohere", model: "default", inputTokenPricePerMillionMicros: dpmt(0.15), outputTokenPricePerMillionMicros: dpmt(0.6) },
  { service: "llm", provider: "cohere", model: "command-r", inputTokenPricePerMillionMicros: dpmt(0.15), outputTokenPricePerMillionMicros: dpmt(0.6) },
  { service: "llm", provider: "cohere", model: "command-r-plus", inputTokenPricePerMillionMicros: dpmt(2.5), outputTokenPricePerMillionMicros: dpmt(10) },
  // Google Gemini
  { service: "llm", provider: "google", model: "default", inputTokenPricePerMillionMicros: dpmt(0.075), outputTokenPricePerMillionMicros: dpmt(0.3) },
  { service: "llm", provider: "google", model: "gemini-1.5-flash", inputTokenPricePerMillionMicros: dpmt(0.075), outputTokenPricePerMillionMicros: dpmt(0.3) },
  { service: "llm", provider: "google", model: "gemini-1.5-pro", inputTokenPricePerMillionMicros: dpmt(1.25), outputTokenPricePerMillionMicros: dpmt(5) },
  { service: "llm", provider: "google", model: "gemini-2.0-flash", inputTokenPricePerMillionMicros: dpmt(0.1), outputTokenPricePerMillionMicros: dpmt(0.4) },
  { service: "llm", provider: "google", model: "gemini-2.5-flash", inputTokenPricePerMillionMicros: dpmt(0.3), outputTokenPricePerMillionMicros: dpmt(2.5) },
  { service: "llm", provider: "google", model: "gemini-2.5-flash-preview-05-20", inputTokenPricePerMillionMicros: dpmt(0.3), outputTokenPricePerMillionMicros: dpmt(2.5) },
  // Groq (per-million tokens, fast inference)
  { service: "llm", provider: "groq", model: "default", inputTokenPricePerMillionMicros: dpmt(0.05), outputTokenPricePerMillionMicros: dpmt(0.1) },
  { service: "llm", provider: "groq", model: "llama-3.1-8b-instant", inputTokenPricePerMillionMicros: dpmt(0.05), outputTokenPricePerMillionMicros: dpmt(0.08) },
  { service: "llm", provider: "groq", model: "llama-3.3-70b-versatile", inputTokenPricePerMillionMicros: dpmt(0.59), outputTokenPricePerMillionMicros: dpmt(0.79) },
  // Qwen (via Groq / OpenRouter): qwen3-32b ~$0.10/M in, $0.20/M out
  { service: "llm", provider: "qwen", model: "default", inputTokenPricePerMillionMicros: dpmt(0.10), outputTokenPricePerMillionMicros: dpmt(0.20) },
  { service: "llm", provider: "qwen", model: "qwen/qwen3-32b", inputTokenPricePerMillionMicros: dpmt(0.10), outputTokenPricePerMillionMicros: dpmt(0.20) },
  { service: "llm", provider: "qwen", model: "qwen/qwen3-8b", inputTokenPricePerMillionMicros: dpmt(0.03), outputTokenPricePerMillionMicros: dpmt(0.06) },
  // Sarvam LLM (Indic)
  { service: "llm", provider: "sarvam", model: "default", inputTokenPricePerMillionMicros: dpmt(0.5), outputTokenPricePerMillionMicros: dpmt(1.5) },
  { service: "llm", provider: "sarvam", model: "sarvam-30b", inputTokenPricePerMillionMicros: dpmt(0.5), outputTokenPricePerMillionMicros: dpmt(1.5) },
  { service: "llm", provider: "sarvam", model: "sarvam-m", inputTokenPricePerMillionMicros: dpmt(0.2), outputTokenPricePerMillionMicros: dpmt(0.6) },

  // ── TTS (per character) ───────────────────────────────────────────────────
  // ElevenLabs Creator/Pro tier ~$0.18 / 1k chars; Flash v2.5 ~$0.10 / 1k
  { service: "tts", provider: "elevenlabs", model: "default", characterPriceMicros: charK(0.18) },
  { service: "tts", provider: "elevenlabs", model: "eleven_turbo_v2_5", characterPriceMicros: charK(0.10) },
  { service: "tts", provider: "elevenlabs", model: "eleven_flash_v2_5", characterPriceMicros: charK(0.10) },
  { service: "tts", provider: "elevenlabs", model: "eleven_multilingual_v2", characterPriceMicros: charK(0.18) },
  // OpenAI TTS: $15 / 1M chars
  { service: "tts", provider: "openai", model: "default", characterPriceMicros: charM(15) },
  { service: "tts", provider: "openai", model: "tts-1", characterPriceMicros: charM(15) },
  { service: "tts", provider: "openai", model: "tts-1-hd", characterPriceMicros: charM(30) },
  { service: "tts", provider: "openai", model: "gpt-4o-mini-tts", characterPriceMicros: charM(15) },
  // Azure Neural TTS: $16 / 1M chars
  { service: "tts", provider: "azure", model: "default", characterPriceMicros: charM(16) },
  // AWS Polly Neural: $16 / 1M chars
  { service: "tts", provider: "polly", model: "default", characterPriceMicros: charM(16) },
  // Cartesia Sonic: ~$50 / 1M chars (Pro), Sonic Turbo ~$25 / 1M
  { service: "tts", provider: "cartesia", model: "default", characterPriceMicros: charM(50) },
  { service: "tts", provider: "cartesia", model: "sonic-2", characterPriceMicros: charM(50) },
  { service: "tts", provider: "cartesia", model: "sonic-turbo", characterPriceMicros: charM(25) },
  { service: "tts", provider: "cartesia", model: "sonic-3", characterPriceMicros: charM(50) },
  { service: "tts", provider: "cartesia", model: "sonic-3.5", characterPriceMicros: charM(50) },
  // Deepgram Aura TTS: ~$15 / 1M chars
  { service: "tts", provider: "deepgram", model: "default", characterPriceMicros: charM(15) },
  { service: "tts", provider: "deepgram", model: "aura-2", characterPriceMicros: charM(30) },
  // Sarvam TTS ~$30 / 1M chars
  { service: "tts", provider: "sarvam", model: "default", characterPriceMicros: charM(30) },
];

async function main() {
  let inserted = 0;
  let skipped = 0;
  for (const r of ROWS) {
    const result = await db
      .insert(providerPricingTable)
      .values({
        service: r.service,
        provider: r.provider,
        model: r.model,
        inputTokenPricePerMillionMicros: r.inputTokenPricePerMillionMicros ?? 0,
        outputTokenPricePerMillionMicros: r.outputTokenPricePerMillionMicros ?? 0,
        audioSecondPriceMicros: r.audioSecondPriceMicros ?? 0,
        characterPriceMicros: r.characterPriceMicros ?? 0,
      })
      .onConflictDoNothing({
        target: [providerPricingTable.service, providerPricingTable.provider, providerPricingTable.model],
      })
      .returning({ id: providerPricingTable.id });
    if (result.length > 0) inserted += 1;
    else skipped += 1;
  }
  const [{ total }] = await db.execute<{ total: string }>(sql`select count(*)::text as total from provider_pricing`).then((r) => r.rows);
  console.log(`provider_pricing seed complete: inserted=${inserted}, skipped=${skipped}, total_rows=${total}`);
  console.log(
    "Note: the api-server caches pricing for 60s (PRICING_TTL_MS in record-usage.ts) — new rates take effect after the cache expires or after a server restart.",
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("seed failed", err);
  process.exit(1);
});
