import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The ten turn invariants are tribal knowledge until the build fails when
 * someone reintroduces STT gating (772→1320) or idle-from-the-wrong-clock
 * (14315). These are source-scan guards on pipeline.ts — they do not run a
 * live call, they fail CI when the wiring that *caused* those incidents
 * comes back.
 */
const pipelineSrc = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "pipeline.ts"),
  "utf8",
);

function methodBody(name: string): string {
  const start = pipelineSrc.search(new RegExp(`private (?:async )?${name}\\s*\\(`));
  expect(start, `${name} must exist on OrchestrationPipeline`).toBeGreaterThan(-1);
  const brace = pipelineSrc.indexOf("{", start);
  let depth = 0;
  for (let i = brace; i < pipelineSrc.length; i++) {
    const ch = pipelineSrc[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return pipelineSrc.slice(brace, i + 1);
    }
  }
  throw new Error(`unclosed method ${name}`);
}

describe("live pipeline invariants (calls 772→1320, 14315)", () => {
  it("feeds streaming STT unconditionally — never gated on TTS (772→1320)", () => {
    const marker = "INVARIANT — DO NOT GATE OR FLUSH THIS FEED";
    const start = pipelineSrc.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    const send = pipelineSrc.indexOf("this.streamSTT.sendAudio(sttFrame)", start);
    expect(send).toBeGreaterThan(start);
    const between = pipelineSrc.slice(start, send);
    expect(between).not.toMatch(/if\s*\(\s*!?\s*this\.isPlaying/);
    expect(between).not.toMatch(/if\s*\(\s*!?\s*this\.isSendingTtsAudio/);
    expect(between).not.toMatch(/AlwaysUserMute|muteUser|gateStt|sttGated/);
    // One unconditional sendAudio — energy no longer swaps in silence frames.
    // The invariant is preserved: we ALWAYS send (never gate on TTS).
    expect([...pipelineSrc.matchAll(/streamSTT\.sendAudio/g)]).toHaveLength(1);
  });

  it("starts idle when the bot stops speaking, not from leftover user-turn time (14315)", () => {
    const body = methodBody("onBotStoppedSpeaking");
    expect(body).toContain("this.resetHangupTimer()");
    expect(body).toContain("this.safetyNet.beginListening()");
    expect(pipelineSrc).toContain("Pipecat UserIdleController");
    expect(pipelineSrc).toContain("call 14315");
  });

  it("pages once when Smart Turn is missing (fail-open is degraded mode, not silent)", () => {
    expect(pipelineSrc).toContain('["smart_turn_fail_open"]');
    expect(pipelineSrc).toContain("_smartTurnFailOpenAlerted");
    expect(pipelineSrc).toMatch(/Smart Turn fail-open/);
    const evalBody = methodBody("evaluateSemanticTurn");
    expect(evalBody).toContain("!sessionReady");
    expect(evalBody).toContain("logWarningEvent");
    expect(evalBody).toContain("smart_turn_fail_open");
  });

  it("does not drop listening finals on RMS — STT is the turn authority (call 14351)", () => {
    expect(pipelineSrc).not.toMatch(/logDiscardedTranscript\(\s*transcript,\s*"background_talker"\s*\)/);
    expect(pipelineSrc).not.toContain("isBackgroundTalkerUtterance(");
    expect(pipelineSrc).not.toContain("utterancePeakRawRms");
  });

  it("does not WAIT-pause the TTS send pump while the agent is speaking (call 14351 voice break)", () => {
    const body = methodBody("audioSendStatus");
    expect(body).toContain("isPlaying");
    expect(body).toContain("isSendingTtsAudio");
    expect(body).toMatch(/status === "WAIT"/);
  });

  it("speaks typed outbound Welcome as-is and does not LLM-speak Talk (call 17455)", () => {
    expect(pipelineSrc).toContain("outboundTypedWelcomeBlocksGreetingLlm");
    expect(pipelineSrc).toContain("call 17455");
    expect(pipelineSrc).not.toContain("outbound stub greeting — generating opener from system prompt instead");
    expect(pipelineSrc).toContain("joinWelcomeAndOpener");
    expect(pipelineSrc).toContain("typedWelcome");
  });

  it("keeps typed Welcome on resume-drop so first audio is not blocked on the greeting LLM (call 18112)", () => {
    expect(pipelineSrc).not.toContain('const typedWelcome = resumeDropped ? ""');
    expect(pipelineSrc).toMatch(/resumeDropped \? "" : typedWelcome/);
    expect(pipelineSrc).toContain("playing welcome before greeting LLM");
  });

  it("streams the first greeting sentence before the LLM finishes (call 20257 boot)", () => {
    expect(pipelineSrc).toContain("_greetingFirstSentence");
    expect(pipelineSrc).toContain("playing first greeting sentence before LLM done");
  });

  it("never interrupts TTS from bare VAD — Audio → STT → InterruptionManager (call 20257)", () => {
    expect(pipelineSrc).toContain("shouldInterruptFromCallerTranscript");
    expect(pipelineSrc).toContain("shouldCutTtsFromCallerTranscript");
    expect(pipelineSrc).toContain("shouldDiscardOpenerTranscript");
    expect(pipelineSrc).toContain("vad.speech_start only");
    expect(pipelineSrc).toContain("maybeBargeFromRealtimeVadStart");
    const vadBody = methodBody("maybeBargeFromRealtimeVadStart");
    expect(vadBody).toContain("shouldInterruptFromCallerTranscript");
    expect(vadBody.indexOf("shouldInterruptFromCallerTranscript"))
      .toBeLessThan(vadBody.indexOf("triggerBargeIn"));
    const streamBody = methodBody("handleStreamingTranscript");
    expect(streamBody.indexOf("shouldDiscardOpenerTranscript"))
      .toBeLessThan(streamBody.indexOf("processTurn"));
    expect(pipelineSrc).toContain("room_crosstalk");
    expect(pipelineSrc).toContain("first-speech mute");
    expect(pipelineSrc).not.toContain("voice-isolator");
  });

  it("synthesizes Cartesia and Sarvam at native 8 kHz on 8 kHz legs; 16 kHz FIR is opt-in", () => {
    expect(pipelineSrc).toContain("CARTESIA_TTS_16K");
    expect(pipelineSrc).toContain("SARVAM_TTS_16K");
    expect(pipelineSrc).toMatch(/pcmOutRate\(\) === 8000/);
    expect(pipelineSrc).toContain('ttsProvider === "sarvam"');
  });

  it("does not punch a 200 ms rebuffer hole mid-sentence (call 14351)", () => {
    expect(pipelineSrc).not.toMatch(/await awaitPrebuffer\(TTS_REBUFFER/);
    expect(pipelineSrc).toContain("TTS_WIRE_LEAD_FRAMES");
    // Underrun keeps the carrier alive with silence, never a looped speech frame.
    expect(pipelineSrc).not.toContain("concealFrame");
    expect(pipelineSrc).toContain("this.config.onAudioOut(holdFrame)");
    expect(pipelineSrc).toContain("Never start the wire on an empty queue");
    expect(pipelineSrc).not.toContain("STREAMING_TTS_PREBUFFER_BOOST_MS");
    // Greeting prebuffer raised 280 -> 400 (call 19718: cold LLM-opener underran the wire at the greeting).
    expect(pipelineSrc).toMatch(/TTS_PREBUFFER_GREETING_MS \?\? 400\)/);
    // Warm prebuffer raised again after call 20094 (six underruns in <2 min).
    expect(pipelineSrc).toMatch(/TTS_PREBUFFER_MS \?\? 1000\)/);
  });

  it("does not ship GTCRN / voice-isolator on the live audio path (call 20257)", () => {
    const orchDir = dirname(fileURLToPath(import.meta.url));
    const workerSrc = readFileSync(resolve(orchDir, "audioWorker.ts"), "utf8");
    expect(existsSync(resolve(orchDir, "voice-isolator.ts"))).toBe(false);
    expect(existsSync(resolve(orchDir, "gtcrn-stft.ts"))).toBe(false);
    expect(existsSync(resolve(orchDir, "gtcrn_simple.onnx"))).toBe(false);
    expect(workerSrc).not.toContain("voice-isolator");
    expect(workerSrc).not.toContain("gtcrn");
    expect(pipelineSrc).not.toContain("voice-isolator");
  });
});
