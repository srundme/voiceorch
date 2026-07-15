// Cost per minute in USD for each provider
// Sources: public pricing pages, estimates for providers without published per-minute rates

export interface ProviderCost {
  label: string;
  costPerMin: number; // USD
}

export interface PipelineCost {
  asr: ProviderCost;
  llm: ProviderCost;
  tts: ProviderCost;
  telephony: ProviderCost;
  platform: ProviderCost;
  totalPerMin: number;
}

const ASR_PRICING: Record<string, number> = {
  deepgram:   0.0059,
  azure:      0.0160,
  assemblyai: 0.0150,
  whisper:    0.0060,
  sarvam:     0.0040,
  cartesia:   0.0080,
};

const LLM_PRICING: Record<string, number> = {
  // OpenAI — based on token pricing (~450 tokens/min voice conversation)
  "openai/gpt-4.1":         0.0036,  // $2/$8 per 1M tokens
  "openai/gpt-4.1-mini":    0.0007,  // $0.40/$1.60 per 1M tokens
  "openai/gpt-4.1-nano":    0.0002,  // $0.10/$0.40 per 1M tokens
  "openai/gpt-4o":          0.0225,
  "openai/gpt-4o-mini":     0.0027,
  "openai/o4-mini":         0.0060,  // $1.10/$4.40 per 1M tokens
  "openai/gpt-4-turbo":     0.0450,
  "openai/gpt-3.5-turbo":   0.0018,
  // Anthropic
  "anthropic/claude-3-5-sonnet-20241022": 0.0180,
  "anthropic/claude-3-5-haiku-20241022":  0.0040,
  "anthropic/claude-3-opus-20240229":     0.0900,
  // Qwen (via Groq)
  "qwen/qwen3-32b":       0.0010,
  "qwen/qwen3-235b-a22b": 0.0030,
  // Groq (very fast, very cheap)
  "groq/llama-3.3-70b-versatile": 0.0018,
  "groq/llama-3.1-8b-instant":    0.0003,
  "groq/gemma2-9b-it":            0.0008,
  // Others
  "deepseek/deepseek-chat":     0.0015,
  "deepseek/deepseek-reasoner": 0.0070,
  "mistral/mistral-large-latest": 0.0090,
  "mistral/mistral-small-latest": 0.0030,
  "cohere/command-r-plus": 0.0120,
  "cohere/command-r":      0.0030,
  "sarvam/sarvam-30b":  0.0020,
  "sarvam/sarvam-105b": 0.0040,
};

// Provider-level fallback when model is unknown
const LLM_PROVIDER_FALLBACK: Record<string, number> = {
  openai:    0.0100,
  anthropic: 0.0200,
  qwen:      0.0020,
  groq:      0.0010,
  deepseek:  0.0030,
  mistral:   0.0060,
  cohere:    0.0075,
  sarvam:    0.0010,
};

const TTS_PRICING: Record<string, number> = {
  elevenlabs: 0.0300,
  openai:     0.0150,
  azure:      0.0160,
  cartesia:   0.0100,
  deepgram:   0.0125,
  aws_polly:  0.0040,
  sarvam:     0.0060,
};

const TELEPHONY_PRICING: Record<string, number> = {
  twilio: 0.0130,
  plivo:  0.0080,
  vonage: 0.0090,
  vobiz:  0.0060,
};

const PLATFORM_FEE = 5.0; // ₹5.00/min flat orchestration fee

export function computePipelineCost(
  asrProvider: string,
  llmProvider: string,
  llmModel: string | null | undefined,
  ttsProvider: string,
  telephonyProvider: string,
): PipelineCost {
  const asrCost = ASR_PRICING[asrProvider] ?? 0.0080;

  let llmCost: number;
  if (llmModel) {
    const key = `${llmProvider}/${llmModel}`;
    llmCost = LLM_PRICING[key] ?? LLM_PROVIDER_FALLBACK[llmProvider] ?? 0.0050;
  } else {
    llmCost = LLM_PROVIDER_FALLBACK[llmProvider] ?? 0.0050;
  }

  const ttsCost = TTS_PRICING[ttsProvider] ?? 0.0100;
  const telCost = TELEPHONY_PRICING[telephonyProvider] ?? 0.0100;

  return {
    asr:       { label: asrProvider,       costPerMin: asrCost },
    llm:       { label: llmProvider,       costPerMin: llmCost },
    tts:       { label: ttsProvider,       costPerMin: ttsCost },
    telephony: { label: telephonyProvider, costPerMin: telCost },
    platform:  { label: "SnapServe",       costPerMin: PLATFORM_FEE },
    totalPerMin: asrCost + llmCost + ttsCost + telCost + PLATFORM_FEE,
  };
}
