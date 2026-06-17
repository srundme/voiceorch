/**
 * Stub adapters for load-testing and CI benchmarks.
 *
 * Activate by starting the API server with STUB_PROVIDERS=1.
 * Every provider factory (createSTTAdapter, createLLMAdapter, createTTSAdapter)
 * checks this flag and returns a stub instead of a real HTTP client.
 *
 * Designed to isolate SnapServe orchestration overhead from provider round-trip
 * variance: STT=120ms, LLM TTFT=400ms then 20ms/token, TTS first-byte=200ms.
 */

import type { STTAdapter, LLMAdapter, TTSAdapter } from "../../orchestration/types.js";

function sleep(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }

const STUB_TRANSCRIPT = "Hello this is a test utterance for load testing purposes.";

export function createStubSTT(latencyMs = 120): STTAdapter {
  return {
    async transcribe(_audio, _sampleRate) {
      await sleep(latencyMs);
      return STUB_TRANSCRIPT;
    },
  };
}

const STUB_REPLY_WORDS = [
  "Thank", "you", "for", "your", "message.", "I", "am", "the",
  "SnapServe", "stub", "agent", "responding", "at", "fixed", "latency.",
];

export function createStubLLM(ttftMs = 400, tokenIntervalMs = 20): LLMAdapter {
  return {
    async chat(_messages, _system, onToken, onDone, _options) {
      await sleep(ttftMs);
      for (const word of STUB_REPLY_WORDS) {
        onToken(word + " ");
        await sleep(tokenIntervalMs);
      }
      const full = STUB_REPLY_WORDS.join(" ");
      onDone(full, { inputTokens: 50, outputTokens: STUB_REPLY_WORDS.length });
    },
  };
}

const STUB_TTS_DURATION_MS = 500;
const STUB_TTS_SAMPLE_RATE = 16_000;
const STUB_TTS_SAMPLES = Math.ceil((STUB_TTS_DURATION_MS / 1000) * STUB_TTS_SAMPLE_RATE);
const STUB_TTS_PCM = Buffer.alloc(STUB_TTS_SAMPLES * 2, 0); // 16-bit PCM silence

export function createStubTTS(ttfbMs = 200): TTSAdapter {
  return {
    async synthesize(_text) {
      await sleep(ttfbMs + STUB_TTS_DURATION_MS);
      return { audio: STUB_TTS_PCM, characters: _text.length };
    },
    async synthesizeStream(_text, onChunk, onDone, _signal) {
      await sleep(ttfbMs);
      if (_signal?.aborted) return;
      onChunk(STUB_TTS_PCM);
      onDone(_text.length);
    },
  };
}

export const STUB_PROVIDERS_ENABLED = process.env["STUB_PROVIDERS"] === "1";
