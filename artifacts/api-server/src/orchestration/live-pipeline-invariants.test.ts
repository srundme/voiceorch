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
const audioWorkerSrc = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "audioWorker.ts"),
  "utf8",
);
const compactGreetingSrc = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "compact-greeting-prompt.ts"),
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

  it("does not overlay Smart Turn on provider VAD/finals", () => {
    const evalBody = methodBody("evaluateSemanticTurn");
    expect(evalBody.replace(/\s+/g, "")).toBe("{return;}");
    expect(evalBody).not.toContain("smart_turn_fail_open");
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
    expect(pipelineSrc).toMatch(/resumeDropped && !this\.isIntakeAgent \? "" : typedWelcome/);
    expect(pipelineSrc).toContain("playing welcome before greeting LLM");
  });

  it("streams the first greeting sentence before the LLM finishes (call 20257 boot)", () => {
    expect(pipelineSrc).toContain("_greetingFirstSentence");
    expect(pipelineSrc).toContain("playing first greeting sentence before LLM done");
  });

  it("never interrupts TTS from bare VAD — Audio → STT → InterruptionManager (call 20257)", () => {
    expect(pipelineSrc).toContain("shouldInterruptFromCallerTranscript");
    expect(pipelineSrc).toContain("shouldAcceptCallerInterrupt");
    // Linear echo is WebRTC AEC3 (audio worker); no SnapServe RMS barge path.
    expect(pipelineSrc).not.toContain("tryEnergyBargeIn");
    expect(pipelineSrc).toContain("feedFarEndRender");
    // Far-end tap is on transmitted onAudioOut bytes (survives TTS cancel / drain).
    expect(pipelineSrc).toMatch(/onAudioOut:\s*\(audio:\s*Buffer\)\s*=>\s*\{[\s\S]*?feedFarEndRender/);
    // Preferred PSTN chain: AEC3 → Quail VF → STT (never Quail before AEC3).
    const aecIdx = audioWorkerSrc.indexOf("aec.processPcm8k");
    const quailIdx = audioWorkerSrc.indexOf("aic.processPcm8k");
    expect(aecIdx).toBeGreaterThan(-1);
    expect(quailIdx).toBeGreaterThan(aecIdx);
    expect(audioWorkerSrc).toContain('type: "RESET_AEC"');
    expect(pipelineSrc).not.toContain("shouldIgnoreSelfEcho");
    expect(pipelineSrc).not.toContain("SELF_ECHO_MIN_OVERLAP");
    expect(pipelineSrc).toContain("vad.speech_start only");
    expect(pipelineSrc).toContain("maybeBargeFromRealtimeVadStart");
    const vadBody = methodBody("maybeBargeFromRealtimeVadStart");
    expect(vadBody).toContain("shouldBargeOnRealtimeVadStart");
    expect(vadBody).toContain("isCarrierSelfEcho");
    expect(vadBody).toContain("shouldAcceptCallerInterrupt");
    expect(vadBody).not.toMatch(/triggerBargeIn\(\s*"energy"/);
    expect(methodBody("schedulePartialBargeIn")).toContain("shouldInterruptFromCallerTranscript");
    expect(methodBody("schedulePartialBargeIn")).toContain("isCarrierSelfEcho");
    expect(methodBody("schedulePartialBargeIn")).not.toContain("SELF_ECHO_MIN_WORDS");
    expect(methodBody("schedulePartialBargeIn")).toContain("turnCoord.requestInterrupt");
    expect(methodBody("maybeBargeFromRealtimeVadStart")).toContain("turnCoord.requestInterrupt");
    expect(pipelineSrc).toContain("beginSoftDuck");
    expect(pipelineSrc).toContain("preferSoftDuckBeforeBarge");
    expect(pipelineSrc).toContain("SileroStream");
    expect(pipelineSrc).toContain("fuseCallerSpeaking");
    expect(pipelineSrc).toContain("shouldDiscardAsRoomCrosstalk");
    // Soft duck applies to transmitted frames; STT feed stays ungated.
    expect(pipelineSrc).toContain("emitAudioOut");
    expect(pipelineSrc).toContain("this.streamSTT.sendAudio(sttFrame)");
    expect(pipelineSrc).toContain("sileroStream?.push8k");
    expect(pipelineSrc).not.toMatch(/if\s*\([^)]*sileroSustainedNow[^)]*\)\s*\{[^}]{0,80}sendAudio/s);
    // Turn Acceptance Gate sits before processTurn; default shadow does not block.
    expect(pipelineSrc).toContain("evaluateTurnAcceptance");
    expect(pipelineSrc).toContain("voice_canary_turn_acceptance");
    expect(pipelineSrc).toContain("resolveTurnAcceptanceMode");
    // Phase 1 ClassicTurnCoordinator — sole commit/interrupt routing facade.
    expect(pipelineSrc).toContain("ClassicTurnCoordinator");
    expect(pipelineSrc).toContain("this.turnCoord = new ClassicTurnCoordinator");
    expect(pipelineSrc).toContain("turnCoord.requestCommit");
    expect(pipelineSrc).toContain("bindFillerToResponse");
    // External call sites must not bypass the coordinator.
    expect(pipelineSrc).not.toMatch(/this\.requestBargeIn\(\s*"/);
    expect(pipelineSrc).not.toMatch(/await this\.processTurn\(/);
    expect(pipelineSrc).not.toMatch(/void this\.processTurn\(/);
    expect(methodBody("isEagerPartialReady")).toContain("isEagerCommitReady");
    expect(methodBody("handleStreamingTranscript")).toContain("collectionHoldMsForTranscript");
    expect(methodBody("handleStreamingTranscript")).toContain("agent_still_speaking");
    expect(methodBody("isCarrierSelfEcho")).toContain("ttsOnWire");
    expect(methodBody("isCarrierSelfEcho")).toContain("protectedShortIntent");
    expect(methodBody("isCarrierSelfEcho")).toContain("isTtsOnWireForEcho");
    expect(methodBody("isCarrierSelfEcho")).toContain("lastTtsFrameAt");
    expect(methodBody("resumeBargedReply")).toContain("bargeInRequested && !this.isProcessing");
    expect(methodBody("backchannelFillerOpts")).toContain("backchannelFillers");
    expect(pipelineSrc).not.toContain("Barge-in detected after Sarvam realtime partial");
    const speechEndBody = methodBody("wireStreamSttCallbacks");
    expect(speechEndBody).toContain("maybeBargeFromRealtimeVadStart");
    expect(pipelineSrc).toContain("Call 20274: caller was already mid-utterance");
    const streamBody = methodBody("handleStreamingTranscript");
    expect(streamBody.indexOf("deferGreetingTranscript"))
      .toBeLessThan(streamBody.indexOf("processTurn"));
    expect(pipelineSrc).toContain("room_crosstalk");
    expect(pipelineSrc).toContain("greetingFirstClipActive");
    expect(pipelineSrc).toContain("turnEchoGraceAt");
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
    expect(pipelineSrc).toContain("this.emitAudioOut(holdFrame)");
    expect(pipelineSrc).toContain("Never start the wire on an empty queue");
    expect(pipelineSrc).not.toContain("STREAMING_TTS_PREBUFFER_BOOST_MS");
    expect(pipelineSrc).toMatch(/TTS_PREBUFFER_GREETING_MS \?\? 400\)/);
    expect(pipelineSrc).toMatch(/TTS_PREBUFFER_MS \?\? 600\)/);
    expect(pipelineSrc).toMatch(/TTS_REBUFFER_MS \?\? 120\)/);
    expect(pipelineSrc).not.toContain("loadPresetFillerPcm");
    expect(pipelineSrc).not.toContain("preset-filler");
    expect(pipelineSrc).toContain("job.streaming && this.tts.synthesizeStream");
    expect(pipelineSrc).toMatch(/TELEPHONY_TAIL_DRAIN_MS_DEFAULT = 0/);
    expect(pipelineSrc).toContain("shouldInjectSchedulingPhrasebook");
    expect(pipelineSrc).toContain("needSchedulingGuides");
    expect(pipelineSrc).toContain("return ttsSentenceOptions(this.agent.ttsProvider)");
    expect(methodBody("processTurn")).toContain("this.cartesiaManagedTokenStream()");
    expect(pipelineSrc).toContain("CartesiaTurnStream");
    expect(pipelineSrc).toContain("waitJobReadyUnlessBarged");
    expect(pipelineSrc).toContain("finalizeTurnContext");
    expect(pipelineSrc).toContain("trim: !this.cartesiaManagedTokenStream()");
    expect(readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "clause-stream.ts"),
      "utf8",
    )).toContain("tryWordBoundaryDispatch");
    expect(pipelineSrc).toContain("extractSpeakable");
    expect(pipelineSrc).toContain("Do not wait on incrementalDelay / calleeSpeaking before first audio");
    expect(methodBody("processTurn")).toContain("this.clearBargeWait()");
    expect(methodBody("handleStreamingTranscript")).toContain("if (this.isProcessing) {");
    // Call 21803: do not start a second processTurn (21426 double-speak), but
    // cut current audio for a real queued final and drop stale acks at drain.
    expect(methodBody("handleStreamingTranscript")).toContain("queued_final");
    expect(methodBody("handleStreamingTranscript")).toContain("interruptReplyArmed");
    expect(methodBody("processTurn")).toContain("interruptReplyArmed");
    expect(pipelineSrc).toContain("THIS_TURN_INSTRUCTION");
    expect(pipelineSrc).toContain("this.wakePlayTask()");
    expect(pipelineSrc).toMatch(/FILLER_THRESHOLD_MS \?\? 0/);
    expect(pipelineSrc).toMatch(/BACKCHANNEL_LATE_MS \?\? 0/);
    expect(pipelineSrc).not.toContain("Math.random() < freq");
    expect(methodBody("processTurn")).toContain("dueForCover");
    expect(methodBody("processTurn")).toContain("buildAntiRepeatNudge");
    expect(methodBody("processTurn")).toContain("demoteResumeMemoryAfterOpening");
    expect(methodBody("processTurn")).toContain("this.agent.backchannelingEnabled");
    expect(pipelineSrc).toContain("Backchannel filler armed (immediate, language-aware)");
    // The cover must survive the first LLM token — Cartesia only speaks once a
    // whole sentence exists (call 21546: 0.3–1.5s later). Assert on behaviour,
    // not prose: no first-token filler hook, no cancel window.
    expect(pipelineSrc).not.toContain("onLlmFirstTokenReceived");
    expect(pipelineSrc).not.toContain("DEAD_AIR_FILLER_CANCEL_MS");
    expect(pipelineSrc).toContain("The first token is not audible TTS");
    expect(pipelineSrc).toContain("firstSpeakableEnqueued || this.bargeInRequested || this.closed");
    // A played cover must not be echoed by the LLM's own leading "சரி,".
    expect(pipelineSrc).toContain("stripLeadingAckClause");
    expect(pipelineSrc).toContain("event: \"Backchannel Armed\"");
    expect(pipelineSrc).toContain("if (sequenceId !== FILLER_SEQUENCE_ID) {");
    expect(pipelineSrc).toContain("partialSnapshot: _spec.partialSnapshot");
    expect(pipelineSrc).not.toContain("preferNumberTranscript");
    expect(pipelineSrc).toContain("initialLanguage wins even in strict mode");
    expect(pipelineSrc).toContain("this.requestedLangLatch || this.lastNonEnglishLang || this.currentLang");
    expect(pipelineSrc).toContain("getLiveHandoffLanguage(): string");
    expect(pipelineSrc).toContain("Live squad handoff language");
    expect(compactGreetingSrc).toContain("[OPENING — SQUAD HANDOFF]");
    expect(pipelineSrc).toContain("squadHandoffTakeover");
  });

  it("does not mute after a mid-sentence false barge (call 21450)", () => {
    expect(pipelineSrc).toContain("isSameUtteranceContinuation");
    expect(pipelineSrc).toContain("isSameUtteranceStillArriving");
    expect(pipelineSrc).toContain("PARTIAL_BARGE_MIN_PLAY_MS");
    expect(pipelineSrc).toContain("armBargeRecovery");
    expect(pipelineSrc).toContain("flushBargeRecovery");
    expect(pipelineSrc).toContain("if (this.streamSTT?.flush && !this.liveSarvamRealtime())");
    expect(pipelineSrc).toContain("this.armBargeRecovery(partial)");
    expect(methodBody("processTurn")).toContain("this.clearBargeRecovery()");
    expect(methodBody("shouldInterruptFromCallerTranscript")).toContain("shouldAcceptCallerInterrupt");
    expect(methodBody("isSameUtteranceStillArriving")).toContain("isQueuedDuplicateUserTurn");
    expect(methodBody("playbackTooFreshForPartialBarge")).toContain("PARTIAL_BARGE_MIN_PLAY_MS");
    expect(methodBody("playbackTooFreshForPartialBarge")).toContain("bargeInSentenceStartAt");
    expect(methodBody("schedulePartialBargeIn")).toContain("playbackTooFreshForPartialBarge");
    expect(methodBody("maybeBargeFromRealtimeVadStart")).toContain("playbackTooFreshForPartialBarge");
    expect(methodBody("armBargeRecovery")).toMatch(/return;/);
    expect(methodBody("flushBargeRecovery")).not.toContain("handleStreamingTranscript");
    expect(methodBody("handleStreamingTranscript")).toContain("resumeBargedReply");
    expect(pipelineSrc).not.toContain("answering last partial");
  });

  it("does not replay a spoken pitch or loop the callback closer (call 26692)", () => {
    expect(methodBody("isCarrierSelfEcho")).toContain("isCallerClosingUtterance");
    expect(methodBody("isCarrierSelfEcho")).toContain("isCallerFarewellUtteranceShared");
    expect(methodBody("handleStreamingTranscript")).toContain("collapseRepeatedUtterance");
    expect(methodBody("handleStreamingTranscript")).toContain("isStutterLoopTranscript");
    expect(methodBody("captureBargedRemainder")).toContain("_currentTurnPlayedSentences");
    expect(methodBody("resumeBargedReply")).toContain("False barge remainder already spoken");
    expect(methodBody("processTurn")).toContain("_scheduledCallbackThisCall");
    expect(methodBody("handleToolCallInner")).toContain("you MUST call end_call");
    expect(methodBody("handleToolCallInner")).toContain("buildScheduleCallbackSpeakInstruction");
    expect(methodBody("handleToolCallInner")).not.toContain("toLocaleString(\"en-IN\"");
    expect(methodBody("handleToolCallInner")).not.toContain("Confirm THIS exact time");
    expect(methodBody("handleToolCallInner")).not.toContain("Do NOT call end_call automatically");
    expect(pipelineSrc).toContain("stub Welcome is the whole opener — waiting for the caller");
  });

  it("barge recovery waits out an open VAD instead of answering a fragment (call 21628)", () => {
    expect(methodBody("flushBargeRecovery")).toContain("this.clearBargeRecovery()");
    expect(pipelineSrc).toContain("abandonFalseBarge");
    expect(pipelineSrc).toContain('this.flushBargeRecovery("speech_end")');
    expect(pipelineSrc).toContain("Cover masks OUR latency; it must not talk over the caller.");
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

describe("intake persist + VoBiz hangup (call 25223)", () => {
  it("saves the form during TTS instead of a silent tool-only turn", () => {
    expect(methodBody("processTurn")).toContain("persistIntakeFromTurn");
    expect(methodBody("processTurn")).toContain("withoutBackgroundIntakeTools");
    expect(pipelineSrc).toContain("persistDuringSpeech");
  });

  it("issues a VoBiz REST hangup because keepCallAlive leaves the PSTN up", () => {
    const sessionSrc = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "session.ts"),
      "utf8",
    );
    expect(sessionSrc).toContain("hangupVobizCall");
    expect(sessionSrc).toContain("hangupCarrierIfAgentEnded");
    const vobizSrc = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "telephony/vobiz.ts"),
      "utf8",
    );
    expect(vobizSrc).toContain('keepCallAlive="true"');
    expect(vobizSrc).toContain('maxRetries="0"');
    expect(vobizSrc).toContain("stale media epoch");
    expect(vobizSrc).toContain("ownsMedia()");
    expect(vobizSrc).toContain("DELETE /Call/{uuid}");
  });
});

describe("Cartesia greeting overlap (call 25226)", () => {
  it("plays known-up-front Cartesia text as one generation, not flushed sentences", () => {
    const body = methodBody("playTextAsSentences");
    expect(body).toContain("CartesiaTTS");
    expect(body).toContain("playSentence");
    expect(body).toContain("25226");
    expect(body).not.toContain("skipDrain");
  });

  it("does not flush incomplete Cartesia fragments (flush_done is not audio-done)", () => {
    const cartesiaSrc = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "adapters/tts/cartesia.ts"),
      "utf8",
    );
    expect(cartesiaSrc).not.toContain("flush: true");
    expect(cartesiaSrc).toContain("Do not flush a fragment");
  });
});
