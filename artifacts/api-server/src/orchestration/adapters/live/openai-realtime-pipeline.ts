import type { WebSocket } from "ws";
import type { AgentConfig, ConversationTurn, SessionConfig } from "../../types.js";
import type { VoiceSession } from "../../voice-session.js";
import { RecordingBuffer, WEBCALL_GAP_RESYNC_MS } from "../../recorder.js";
import {
  attenuatePcm16,
  createDownsampler24to8,
  decodeMulaw,
  encodeMulaw,
  upsample8to16,
} from "../../audio.js";
import { processRawPcm8kIn, feedFarEndRender, setAudioCanaryMeta } from "../../audioPool.js";
import { aec3Enabled } from "../../aec3.js";
import {
  envForceVobizSoftwareNc,
  resolveSoftwareNoiseGate,
  type NoiseGateDecision,
} from "../../noise-gate.js";
import {
  getMicSensitivityThresholds,
  resolveMicSensitivity,
  type MicSensitivityThresholds,
} from "../../mic-sensitivity.js";
import {
  AmbientNoiseStream,
  FileAmbientNoiseStream,
  TRACK_PARAMS,
  loadPcmLoop,
  peekCachedPcmLoop,
} from "../../ambient.js";
import { logger } from "../../../lib/logger.js";
import { createExecutionLogger, EXEC_COMPONENTS } from "../../../services/execution-log.js";
import { buildLiveToolDefs, stripLiveMarkup } from "./live-tool-defs.js";
import { toOpenAIRealtimeTools } from "./openai-realtime-tools.js";
import {
  OPENAI_REALTIME_TRANSCRIBE_MODEL,
  resolveOpenAIRealtimeModel,
  resolveOpenAIRealtimeVoice,
} from "./openai-realtime-voices.js";
import {
  openRealtimeSocket,
  parseRealtimeEvent,
  sendRealtimeEvent,
  type RealtimeServerEvent,
} from "./openai-realtime-socket.js";
import { runLiveToolCall } from "./live-tool-runner.js";
import {
  applyBookingEmailToBookArgs,
  buildEmailSpellLine,
  emptyBookingFlowState,
  looksLikeBookOrRescheduleTool,
  looksLikeFalseBookingClaim,
  shouldSpeakEmailSpell,
  updateBookingFlowFromAssistantText,
  updateBookingFlowFromToolResult,
  updateBookingFlowFromUserTurn,
  type BookingFlowState,
} from "../../booking-flow-enforce.js";
import { bookingAsksCallerForEmail } from "../../booking-email-policy.js";
import { liveBookingTruthRule, liveToolResultConfirmedBooking } from "./live-booking-email.js";
import { CALL_SCREENING_WINDOW_MS, detectScreeningPrompt } from "../../callScreening.js";

const HANDOFF_SEED_MAX_TURNS = 16;

export interface OpenAIRealtimeUsage {
  inputTokens: number;
  outputTokens: number;
  inputAudioTokens: number;
  inputTextTokens: number;
  inputCachedTokens: number;
  outputAudioTokens: number;
  outputTextTokens: number;
  transcribeInputTokens: number;
  transcribeOutputTokens: number;
  responses: number;
}

interface FunctionCallItem {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
}

/**
 * OpenAI gpt-realtime speech-to-speech session. Mirrors GeminiLivePipeline:
 * same noise gate, paced 24k→8k outbound pump, carrier keepalive, barge-in,
 * tools via runLiveToolCall, squad handoff seeding and voicemail/AMD hooks.
 */
export class OpenAIRealtimePipeline implements VoiceSession {
  public endReasonHint: string | null = null;

  private readonly config: SessionConfig;
  private readonly agent: AgentConfig;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly voiceName: string;
  private readonly recording: RecordingBuffer;
  private readonly history: ConversationTurn[] = [];
  private lastUserText: string | null = null;
  private lastAgentText: string | null = null;
  private outputBuf = "";

  private ws: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private closed = false;
  private greetingSent = false;

  private readonly noiseGate: NoiseGateDecision;
  private readonly micThresholds: MicSensitivityThresholds;
  private audioInChain: Promise<void> = Promise.resolve();

  // Paced outbound pump — see GeminiLivePipeline for why audio is held here
  // and released at real time instead of being forwarded as it arrives.
  private pendingOut24k = Buffer.alloc(0);
  private readonly outDecim24to8 = createDownsampler24to8();
  private isPlayingOut = false;
  private outFrames8k: Buffer[] = [];
  private pumpTimer: ReturnType<typeof setInterval> | null = null;
  private pumpAnchorMs = 0;
  private framesSent = 0;
  private underruns = 0;
  private lastOutPcm8k: Buffer | null = null;
  private static readonly FRAME_MS = 20;
  private static readonly LEAD_MS = 80;
  private static readonly PREBUFFER_FRAMES = 5;

  /** Assistant item currently being played + how much of it reached the caller (for truncate). */
  private playingItemId: string | null = null;
  private playedMsForItem = 0;
  private audioItemId: string | null = null;

  private ambientStream: AmbientNoiseStream | FileAmbientNoiseStream | null = null;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private lastRealFrameAt = 0;
  private readonly startedAtMs = Date.now();
  private firstFrameLogged = false;
  private static readonly KEEPALIVE_FILL_GAP_MS = 500;

  private msgChain: Promise<void> = Promise.resolve();
  private responseActive = false;
  private responsePending = false;
  private meetingForceMuted = false;
  private meetingMuteWhenIdle = false;
  private screeningHangupDone = false;
  private readonly screeningWindowStart = Date.now();
  private schedulingActionConfirmed = false;
  private bookingFlowState: BookingFlowState = emptyBookingFlowState();
  private bookingTruthPromptSent = false;
  private amdExternalVerdict: "human" | "machine" | null = null;
  private readonly usage: OpenAIRealtimeUsage = {
    inputTokens: 0,
    outputTokens: 0,
    inputAudioTokens: 0,
    inputTextTokens: 0,
    inputCachedTokens: 0,
    outputAudioTokens: 0,
    outputTextTokens: 0,
    transcribeInputTokens: 0,
    transcribeOutputTokens: 0,
    responses: 0,
  };

  constructor(config: SessionConfig) {
    const rawAudioOut = config.onAudioOut;
    this.config = {
      ...config,
      onAudioOut: (audio: Buffer) => {
        if (this.blocksMeetingAudioOut()) return;
        if (config.telephonyProvider !== "webcall" && aec3Enabled() && audio.length > 0) {
          feedFarEndRender(String(config.callId), audio, config.rawPcmOutput ? "pcm8k" : "mulaw");
        }
        rawAudioOut(audio);
      },
    };
    this.meetingMuteWhenIdle = config.meetingMuteWhenIdle === true;
    this.agent = config.agentConfig;
    if (config.telephonyProvider !== "webcall" && aec3Enabled()) {
      setAudioCanaryMeta(String(config.callId), {
        mediaEpoch: config.getMediaEpoch?.() ?? 1,
        carrier: config.telephonyProvider,
        route: config.canaryRoute ?? `${config.telephonyProvider}:${config.callId}`,
      });
    }
    const key = config.providerKeys.get("openai");
    if (!key) {
      throw new Error("OpenAI Realtime requires an OpenAI API key (managed or BYOP)");
    }
    this.apiKey = key;
    this.model = resolveOpenAIRealtimeModel(this.agent.openaiRealtime?.model);
    this.voiceName = resolveOpenAIRealtimeVoice(this.agent.openaiRealtime?.voiceName);
    this.recording = new RecordingBuffer(
      8000,
      config.telephonyProvider === "webcall" ? WEBCALL_GAP_RESYNC_MS : undefined,
    );
    if (config.answeredAt) this.recording.anchorStart(config.answeredAt);
    this.micThresholds = getMicSensitivityThresholds(resolveMicSensitivity());
    this.noiseGate = resolveSoftwareNoiseGate({
      telephonyProvider: config.telephonyProvider,
      agentEnabled: this.agent.noiseCancellationEnabled,
      agentOverride: this.agent.forceSoftwareNoiseGate,
      envForceVobiz: envForceVobizSoftwareNc(),
    });
    logger.info(
      {
        callId: config.callId,
        agentId: this.agent.id,
        telephonyProvider: config.telephonyProvider,
        voiceStack: "openai-realtime",
        toggle: this.agent.noiseCancellationEnabled,
        softwareGate: this.noiseGate.enabled,
        reason: this.noiseGate.reason,
      },
      "Noise cancellation resolved",
    );
    this.initAmbient();
    this.startKeepalive();
  }

  private pcmOutRate(): number {
    return this.config.rawPcmOutput ? (this.config.rawPcmOutputRate ?? 8000) : 8000;
  }

  private initAmbient(): void {
    const track = this.agent.ambientNoiseTrack;
    if (!this.agent.ambientNoiseEnabled || !track) return;
    const volume = Math.max(0, Math.min(1,
      typeof this.agent.ambientNoiseVolume === "number" && Number.isFinite(this.agent.ambientNoiseVolume)
        ? this.agent.ambientNoiseVolume
        : 1.0,
    ));
    if (Object.prototype.hasOwnProperty.call(TRACK_PARAMS, track)) {
      this.ambientStream = new AmbientNoiseStream(track, volume);
      return;
    }
    const cached = peekCachedPcmLoop(track);
    if (cached) {
      this.ambientStream = new FileAmbientNoiseStream(cached, volume);
      return;
    }
    loadPcmLoop(track)
      .then((pcm) => {
        if (!this.closed) this.ambientStream = new FileAmbientNoiseStream(pcm, volume);
      })
      .catch((err) => {
        logger.error({ callId: this.config.callId, track, err }, "OpenAI Realtime: ambient load failed — keepalive falls back to silence");
      });
  }

  /** VoBiz drops an idle bridge after ~2 s — fill gaps with ambient bed or silence. */
  private startKeepalive(): void {
    const isVobiz = this.config.telephonyProvider === "vobiz";
    const silenceFrame = Buffer.alloc(
      this.config.rawPcmOutput
        ? (this.pcmOutRate() / 1000) * OpenAIRealtimePipeline.FRAME_MS * 2
        : OpenAIRealtimePipeline.FRAME_MS * 8,
      0,
    );
    const timer = setInterval(() => {
      if (this.closed) return;
      if (Date.now() - this.lastRealFrameAt < OpenAIRealtimePipeline.KEEPALIVE_FILL_GAP_MS) return;
      if (this.ambientStream) {
        this.config.onAudioOut(this.nextAmbientFrame(this.ambientStream));
      } else if (isVobiz) {
        this.config.onAudioOut(silenceFrame);
      }
    }, OpenAIRealtimePipeline.FRAME_MS);
    (timer as unknown as { unref?: () => void }).unref?.();
    this.keepaliveTimer = timer;
  }

  private nextAmbientFrame(stream: AmbientNoiseStream | FileAmbientNoiseStream): Buffer {
    if (!this.config.rawPcmOutput) return stream.nextMulawChunk();
    const pcm8k = stream.nextPcmChunk();
    return this.pcmOutRate() === 16000 ? upsample8to16(pcm8k) : pcm8k;
  }

  onAudioIn(mulawChunk: Buffer): void {
    this.onRawPcm8kIn(decodeMulaw(mulawChunk));
  }

  onRawPcm8kIn(pcm8k: Buffer, noiseCancel?: boolean, _nativePcm16k?: Buffer): void {
    if (this.closed || pcm8k.length < 2) return;
    this.recording.addCallerChunk(pcm8k);
    this.config.callerAudioTap?.(pcm8k);

    const gateOn = noiseCancel !== undefined ? noiseCancel : this.noiseGate.enabled;
    const callId = String(this.config.callId);
    const pcm8kCopy = Buffer.from(pcm8k);

    this.audioInChain = this.audioInChain.then(async () => {
      if (this.closed) return;
      let clean8k: Buffer = pcm8kCopy;
      if (gateOn) {
        const result = await processRawPcm8kIn(
          callId,
          pcm8kCopy,
          true,
          this.micThresholds.gateRatio,
          this.micThresholds.vadThreshold,
        );
        clean8k = result.pcm8k;
      }
      if (this.closed || clean8k.length < 2) return;
      await this.ensureConnected();
      if (this.closed) return;
      this.send({ type: "input_audio_buffer.append", audio: encodeMulaw(clean8k).toString("base64") });
    }).catch((err) => {
      logger.error({ callId: this.config.callId, err }, "OpenAI Realtime caller-audio path failed");
    });
  }

  /** Test hook: wait until queued caller frames have been sent. */
  async flushCallerAudio(): Promise<void> {
    await this.audioInChain;
  }

  async greet(): Promise<void> {
    if (this.closed || this.greetingSent) return;
    await this.ensureConnected();
    const takeover = this.config.isSquadHandoffTakeover === true;
    if (this.agent.firstSpeaker === "user" && !takeover) {
      logger.info({ callId: this.config.callId }, "OpenAI Realtime: first speaker = user — waiting for caller");
      return;
    }
    this.greetingSent = true;
    const greeting = (this.agent.greetingMessage ?? "").trim();
    if (takeover) {
      await this.beginSquadHandoffTakeover(greeting);
      return;
    }
    this.addSystemNote(
      greeting
        ? `Begin the call by speaking this greeting naturally: "${greeting}"`
        : "Begin the call with a brief, friendly greeting and ask how you can help.",
    );
    this.requestResponse();
  }

  private async beginSquadHandoffTakeover(customGreeting: string): Promise<void> {
    for (const item of toRealtimeHandoffItems(this.config.handoffSeedTurns)) {
      this.send({ type: "conversation.item.create", item });
    }
    if (customGreeting) {
      await this.speakRaw(customGreeting);
      return;
    }
    this.addSystemNote(
      "You just took over this live call from a teammate. The customer is still on the line. " +
      "Do not start a new greeting. Speak 1-2 short sentences: acknowledge continuity and continue.",
    );
    this.requestResponse();
    logger.info(
      { callId: this.config.callId, seedTurns: this.config.handoffSeedTurns?.length ?? 0 },
      "OpenAI Realtime: squad handoff takeover — seeded prior turns and requested a spoken reply",
    );
  }

  async confirmAmdMachineThenBranch(): Promise<void> {
    if (this.closed) return;
    const action = this.config.amdConfirm?.action ?? "hangup";
    if (this.config.amdConfirm && this.config.amdConfirm.hint !== true && this.amdExternalVerdict == null) {
      const waitMs = Number(process.env["AMD_CONFIRM_WINDOW_MS"]) || 4000;
      const t0 = Date.now();
      while (!this.closed && Date.now() - t0 < waitMs && this.amdExternalVerdict == null) {
        await new Promise((r) => setTimeout(r, 50));
      }
    }
    const providerSaidMachine =
      this.config.amdConfirm?.hint === true || this.amdExternalVerdict === "machine";
    if (!providerSaidMachine) {
      await this.greet();
      return;
    }
    try { this.config.onAmdResult?.("machine"); } catch { /* best-effort */ }
    if (action === "continue") {
      await this.greet();
      return;
    }
    if (action === "leave_message") {
      await this.deliverVoicemail();
      return;
    }
    try { this.config.onVoicemailAction?.(); } catch { /* best-effort */ }
    this.config.onCallEnd();
  }

  async deliverVoicemail(): Promise<void> {
    if (this.closed) return;
    this.greetingSent = true;
    const message = (
      this.config.voicemailDelivery?.message
      ?? this.config.voicemailPolicy?.message
      ?? "Hello, we tried to reach you. Please call us back at your earliest convenience. Thank you."
    ).trim();
    const leadSec =
      this.config.voicemailDelivery?.leadInSeconds
      ?? this.config.amdConfirm?.leadInSeconds
      ?? this.config.voicemailPolicy?.leadInSeconds
      ?? 0;
    if (leadSec > 0 && !this.closed) {
      await new Promise((r) => setTimeout(r, Math.round(leadSec * 1000)));
    }
    if (!this.closed && message) await this.speakRaw(message);
    try { this.config.onVoicemailAction?.(); } catch { /* best-effort */ }
    if (!this.closed) this.config.onCallEnd();
  }

  async finishSpeakingForMaxDuration(graceMs: number): Promise<void> {
    if (this.closed || graceMs <= 0) return;
    const speaking = this.isPlayingOut || this.outFrames8k.length > 0 || this.pendingOut24k.length > 0;
    if (!speaking) return;
    await this.waitUntilSpokenAudioDrained(Date.now() - 80, graceMs);
  }

  async speakRaw(text: string): Promise<void> {
    if (this.closed || !text.trim()) return;
    await this.ensureConnected();
    // The spoken line reaches the transcript via response.output_audio_transcript.done.
    const spokenAfter = Date.now();
    this.addSystemNote(`Speak exactly the following to the caller, word for word, and nothing else: "${text}"`);
    this.requestResponse();
    await this.waitUntilSpokenAudioDrained(spokenAfter, 10_000);
  }

  private async waitUntilSpokenAudioDrained(startedAtMs: number, timeoutMs: number): Promise<void> {
    const t0 = Date.now();
    let heard = false;
    while (Date.now() - t0 < timeoutMs) {
      if (this.closed) return;
      if (this.lastRealFrameAt >= startedAtMs) heard = true;
      const idle = this.outFrames8k.length === 0 && this.pendingOut24k.length === 0;
      if (heard && idle && Date.now() - this.lastRealFrameAt >= 450) return;
      await new Promise((r) => setTimeout(r, 40));
    }
    if (!heard) {
      logger.warn({ callId: this.config.callId, timeoutMs }, "OpenAI Realtime: speakRaw timed out with no outbound audio");
    }
  }

  getTranscript(): string {
    this.flushOutputBuf();
    return this.history
      .filter((t) => t.content.trim() !== "")
      .map((t) => `${t.role === "user" ? "Caller" : "Agent"}: ${stripLiveMarkup(t.content)}`)
      .filter((line) => !/^(Caller|Agent):\s*$/.test(line))
      .join("\n");
  }

  getHistory(): ConversationTurn[] {
    this.flushOutputBuf();
    return [...this.history];
  }

  getLastTurnTexts(): { lastUser: string | null; lastAgent: string | null } {
    return { lastUser: this.lastUserText, lastAgent: this.lastAgentText };
  }

  getPreferredCallerLang(): string {
    return this.agent.language ?? this.agent.sttConfig.language ?? "en-IN";
  }

  getLiveHandoffLanguage(): string {
    return this.getPreferredCallerLang();
  }

  getExplicitLangRequestForMemory(): string | null {
    return null;
  }

  getRecording(): RecordingBuffer {
    return this.recording;
  }

  getLastMediaAtMs(): number | null {
    return this.recording.getLastWriteAtMs();
  }

  getUsageTotals(): { llmInputTokens: number; llmOutputTokens: number } {
    return { llmInputTokens: this.usage.inputTokens, llmOutputTokens: this.usage.outputTokens };
  }

  getRealtimeUsage(): OpenAIRealtimeUsage & { model: string; transcribeModel: string } {
    return { ...this.usage, model: this.model, transcribeModel: OPENAI_REALTIME_TRANSCRIBE_MODEL };
  }

  injectMeetingNote(_note: string): void {
    // Meeting notes are folded into prompts by the classic pipeline only.
  }

  injectMeetingChat(from: string, text: string): void {
    const who = from.trim().slice(0, 60) || "Participant";
    const body = text.replace(/\s+/g, " ").trim().slice(0, 400);
    if (!body || this.closed) return;
    const line = `[Meeting chat from ${who}]: ${body}`;
    void this.ensureConnected().then(() => {
      if (this.closed) return;
      this.send({
        type: "conversation.item.create",
        item: { type: "message", role: "user", content: [{ type: "input_text", text: line }] },
      });
      this.requestResponse();
      this.config.onTranscript("user", line);
      this.appendUser(line);
    }).catch((err) => {
      logger.warn({ callId: this.config.callId, err }, "Meeting chat inject failed");
    });
  }

  setMeetingOutputMuted(muted: boolean): void {
    this.meetingForceMuted = muted === true;
    if (this.meetingForceMuted) {
      this.outFrames8k.length = 0;
      this.config.onBargeIn?.();
    }
  }

  isMeetingOutputMuted(): boolean {
    return this.meetingForceMuted;
  }

  blocksMeetingAudioOut(): boolean {
    if (!this.agent.isMeetingSession) return false;
    if (this.meetingForceMuted) return true;
    if (!this.meetingMuteWhenIdle) return false;
    return !(this.isPlayingOut || this.outFrames8k.length > 0);
  }

  endMeetingSession(reason?: string): void {
    if (this.closed) return;
    this.endReasonHint = reason?.trim() || "meeting_ended";
    logger.info({ callId: this.config.callId, reason: this.endReasonHint }, "OpenAI Realtime meeting session ended by roster cost-cut");
    this.config.onCallEnd();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.flushOutputBuf();
    this.stopPump();
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
    this.outFrames8k.length = 0;
    try {
      this.ws?.close();
    } catch (err) {
      logger.debug({ callId: this.config.callId, err }, "OpenAI Realtime socket close error");
    }
    this.ws = null;
    logger.info({ callId: this.config.callId, usage: this.usage }, "OpenAI Realtime session closed");
  }

  noteMediaDropIfWaitingForReply(): void {
    // Native VAD — no classic STT wait state.
  }

  onExternalAmdSignal(verdict: "machine" | "human", _source: string): void {
    this.amdExternalVerdict = verdict;
  }

  // ── Connection ───────────────────────────────────────────────────────────

  private send(event: Record<string, unknown>): boolean {
    return sendRealtimeEvent(this.ws, event);
  }

  private async ensureConnected(): Promise<void> {
    if (this.ws) return;
    if (!this.connectPromise) this.connectPromise = this.connect();
    await this.connectPromise;
  }

  private async connect(): Promise<void> {
    const connectStarted = Date.now();
    const ws = await openRealtimeSocket(this.apiKey, this.model);
    if (this.closed) {
      ws.close();
      return;
    }
    this.ws = ws;
    ws.on("message", (data) => {
      const evt = parseRealtimeEvent(data);
      if (!evt) return;
      // Barge-in and audio run outside the ordered chain: a slow tool call in
      // the chain must never delay clearing the carrier or playing speech.
      if (evt.type === "input_audio_buffer.speech_started") this.handleInterrupted();
      else if (evt.type === "response.output_audio.delta") this.ingestOutboundAudio(evt);
      this.msgChain = this.msgChain
        .then(() => this.onServerEvent(evt))
        .catch((err) => logger.error({ callId: this.config.callId, err }, "OpenAI Realtime event handler error"));
    });
    ws.on("error", (err) => {
      logger.error({ callId: this.config.callId, err }, "OpenAI Realtime socket error");
    });
    ws.on("close", (code, reason) => {
      if (this.closed) return;
      logger.info(
        { callId: this.config.callId, code, reason: reason.toString().slice(0, 200) },
        "OpenAI Realtime socket closed — ending call",
      );
      this.ws = null;
      this.config.onCallEnd();
    });

    this.send({ type: "session.update", session: this.sessionConfig() });

    const connectMs = Date.now() - connectStarted;
    logger.info({ callId: this.config.callId, model: this.model, voiceName: this.voiceName, connectMs }, "OpenAI Realtime session connected");
    createExecutionLogger(this.config.callId, null)(EXEC_COMPONENTS.LLM, "system", {
      provider: "openai_realtime",
      status: "info",
      latencyMs: connectMs,
      metadata: {
        event: "OpenAI Realtime Connected",
        model: this.model,
        voiceName: this.voiceName,
        promptChars: this.agent.systemPrompt.length,
      },
    });
  }

  private sessionConfig(): Record<string, unknown> {
    const silenceMs = this.agent.asrEndpointingSilenceMs;
    const language = (this.agent.language ?? this.agent.sttConfig.language ?? "").split("-")[0]?.trim();
    return {
      type: "realtime",
      model: this.model,
      instructions: this.systemInstructions(),
      output_modalities: ["audio"],
      audio: {
        input: {
          format: { type: "audio/pcmu" },
          transcription: {
            model: OPENAI_REALTIME_TRANSCRIBE_MODEL,
            ...(language ? { language } : {}),
          },
          turn_detection: {
            type: "server_vad",
            create_response: true,
            interrupt_response: true,
            ...(typeof silenceMs === "number" && Number.isFinite(silenceMs) && silenceMs > 0
              ? { silence_duration_ms: Math.round(silenceMs) }
              : {}),
          },
        },
        output: {
          format: { type: "audio/pcm", rate: 24000 },
          voice: this.voiceName,
        },
      },
      tools: toOpenAIRealtimeTools(buildLiveToolDefs(this.agent)),
      tool_choice: "auto",
    };
  }

  private systemInstructions(): string {
    const hasBook = this.agent.tools.some((t) => t.type === "native_booking" || t.type === "native_reschedule");
    if (!hasBook) return this.agent.systemPrompt;
    return `${this.agent.systemPrompt}\n\n${liveBookingTruthRule()}`;
  }

  /** Out-of-band instruction the model must follow on its next response. */
  private addSystemNote(text: string): void {
    this.send({
      type: "conversation.item.create",
      item: { type: "message", role: "system", content: [{ type: "input_text", text }] },
    });
  }

  /** Realtime rejects response.create while a response is active — queue until response.done. */
  private requestResponse(): void {
    if (this.closed) return;
    if (this.responseActive) {
      this.responsePending = true;
      return;
    }
    this.responseActive = true;
    this.send({ type: "response.create" });
  }

  // ── Server events ────────────────────────────────────────────────────────

  private async onServerEvent(evt: RealtimeServerEvent): Promise<void> {
    if (this.closed) return;
    switch (evt.type) {
      case "response.created":
        this.responseActive = true;
        return;
      case "response.output_audio_transcript.delta": {
        const delta = typeof evt["delta"] === "string" ? evt["delta"] : "";
        this.outputBuf += delta;
        return;
      }
      case "response.output_audio_transcript.done":
        this.flushOutputBuf(typeof evt["transcript"] === "string" ? evt["transcript"] : undefined);
        return;
      case "conversation.item.input_audio_transcription.completed": {
        this.recordTranscribeUsage(evt["usage"]);
        const text = typeof evt["transcript"] === "string" ? evt["transcript"].trim() : "";
        if (!text) return;
        this.appendUser(text);
        this.config.onTranscript("user", text);
        if (this.tryHangupCallScreening(text)) return;
        this.nudgeExactEmailSpell();
        return;
      }
      case "response.done":
        await this.onResponseDone(evt["response"] as Record<string, unknown> | undefined);
        return;
      case "error":
        this.onErrorEvent(evt["error"] as Record<string, unknown> | undefined);
        return;
      default:
        return;
    }
  }

  private async onResponseDone(response: Record<string, unknown> | undefined): Promise<void> {
    this.responseActive = false;
    this.flushOutputBuf();
    this.flushOutboundAudio(true);
    this.recordResponseUsage(response?.["usage"]);
    this.config.onMetrics?.({ sttLatencyMs: 0, llmLatencyMs: 0, ttsFirstChunkMs: 0 });

    const output = Array.isArray(response?.["output"]) ? (response!["output"] as unknown[]) : [];
    const calls = output.filter(
      (item): item is FunctionCallItem =>
        !!item && typeof item === "object" && (item as { type?: unknown }).type === "function_call",
    );
    if (calls.length > 0) {
      await this.handleToolCalls(calls);
    }
    this.config.onConversationUpdate?.(this.getHistory());
    if (this.responsePending && !this.closed) {
      this.responsePending = false;
      this.requestResponse();
    }
  }

  private onErrorEvent(error: Record<string, unknown> | undefined): void {
    const code = typeof error?.["code"] === "string" ? error["code"] : "";
    const message = typeof error?.["message"] === "string" ? error["message"] : "unknown";
    if (code === "conversation_already_has_active_response") {
      this.responsePending = true;
      return;
    }
    if (code === "response_cancel_not_active") return;
    logger.error({ callId: this.config.callId, code, message, error }, "OpenAI Realtime error event");
    if (code === "invalid_api_key" || code === "insufficient_quota" || code === "model_not_found") {
      this.config.onFatalError?.(message);
    }
  }

  private recordResponseUsage(raw: unknown): void {
    if (!raw || typeof raw !== "object") return;
    const u = raw as Record<string, unknown>;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    const inDetails = (u["input_token_details"] ?? {}) as Record<string, unknown>;
    const outDetails = (u["output_token_details"] ?? {}) as Record<string, unknown>;
    this.usage.inputTokens += num(u["input_tokens"]);
    this.usage.outputTokens += num(u["output_tokens"]);
    this.usage.inputAudioTokens += num(inDetails["audio_tokens"]);
    this.usage.inputTextTokens += num(inDetails["text_tokens"]);
    this.usage.inputCachedTokens += num(inDetails["cached_tokens"]);
    this.usage.outputAudioTokens += num(outDetails["audio_tokens"]);
    this.usage.outputTextTokens += num(outDetails["text_tokens"]);
    this.usage.responses += 1;
  }

  private recordTranscribeUsage(raw: unknown): void {
    if (!raw || typeof raw !== "object") return;
    const u = raw as Record<string, unknown>;
    if (typeof u["input_tokens"] === "number") this.usage.transcribeInputTokens += u["input_tokens"];
    if (typeof u["output_tokens"] === "number") this.usage.transcribeOutputTokens += u["output_tokens"];
  }

  // ── Outbound audio ───────────────────────────────────────────────────────

  private ingestOutboundAudio(evt: RealtimeServerEvent): void {
    if (this.closed) return;
    const delta = typeof evt["delta"] === "string" ? evt["delta"] : "";
    if (!delta) return;
    const itemId = typeof evt["item_id"] === "string" ? evt["item_id"] : null;
    if (itemId && itemId !== this.audioItemId) this.audioItemId = itemId;
    this.pendingOut24k = Buffer.concat([this.pendingOut24k, Buffer.from(delta, "base64")]);
    this.flushOutboundAudio();
  }

  /** Runs synchronously from the socket handler — must never await. */
  private handleInterrupted(): void {
    if (this.closed) return;
    const speaking = this.isPlayingOut || this.outFrames8k.length > 0 || this.pendingOut24k.length > 0;
    if (!speaking) return;
    const droppedMs = this.outFrames8k.length * OpenAIRealtimePipeline.FRAME_MS;
    this.pendingOut24k = Buffer.alloc(0);
    this.outFrames8k.length = 0;
    this.lastOutPcm8k = null;
    this.isPlayingOut = false;
    // Tell the model how much of its reply the caller actually heard, so the
    // unplayed tail is not treated as said.
    const itemId = this.playingItemId ?? this.audioItemId;
    if (itemId) {
      this.send({
        type: "conversation.item.truncate",
        item_id: itemId,
        content_index: 0,
        audio_end_ms: this.playingItemId === itemId ? this.playedMsForItem : 0,
      });
    }
    this.flushOutputBuf();
    this.config.onBargeIn?.();
    logger.info({ callId: this.config.callId, droppedMs, itemId }, "OpenAI Realtime: interrupted — cleared queued audio");
  }

  private flushOutboundAudio(force = false): void {
    const FRAME_BYTES_24K = 960;
    while (this.pendingOut24k.length >= FRAME_BYTES_24K) {
      const frame24k = this.pendingOut24k.subarray(0, FRAME_BYTES_24K);
      this.pendingOut24k = this.pendingOut24k.subarray(FRAME_BYTES_24K);
      this.outFrames8k.push(this.outDecim24to8.process(frame24k));
    }
    if (!this.outFrames8k.length) return;
    const ready =
      this.pumpTimer !== null
      || force
      || this.outFrames8k.length >= OpenAIRealtimePipeline.PREBUFFER_FRAMES;
    if (ready) this.ensurePump();
  }

  private ensurePump(): void {
    if (this.pumpTimer) return;
    this.pumpAnchorMs = Date.now();
    this.framesSent = 0;
    this.pumpTimer = setInterval(() => this.pumpTick(), 10);
  }

  private stopPump(): void {
    if (this.pumpTimer) {
      clearInterval(this.pumpTimer);
      this.pumpTimer = null;
    }
  }

  private toWire(pcm8k: Buffer): Buffer {
    return this.config.rawPcmOutput
      ? (this.pcmOutRate() === 16000 ? upsample8to16(pcm8k) : pcm8k)
      : encodeMulaw(pcm8k);
  }

  private pumpTick(): void {
    if (this.closed) { this.stopPump(); return; }
    if (this.outFrames8k.length === 0) {
      if (this.responseActive && this.isPlayingOut && this.lastOutPcm8k) {
        const elapsedMs = Date.now() - this.pumpAnchorMs + OpenAIRealtimePipeline.LEAD_MS;
        if (this.framesSent * OpenAIRealtimePipeline.FRAME_MS >= elapsedMs) return;
        this.underruns++;
        const hold = attenuatePcm16(this.lastOutPcm8k, 0.35);
        this.recording.addAgentChunk(hold);
        this.config.onAudioOut(this.toWire(hold));
        this.framesSent++;
        if (this.underruns === 1 || this.underruns % 25 === 0) {
          logger.warn(
            { callId: this.config.callId, underruns: this.underruns, framesSent: this.framesSent },
            "OpenAI Realtime: outbound audio underrun — concealing with last frame",
          );
        }
        return;
      }
      this.isPlayingOut = false;
      this.stopPump();
      return;
    }
    const elapsedMs = Date.now() - this.pumpAnchorMs + OpenAIRealtimePipeline.LEAD_MS;
    while (this.outFrames8k.length > 0 && this.framesSent * OpenAIRealtimePipeline.FRAME_MS < elapsedMs) {
      const pcm8k = this.outFrames8k.shift()!;
      this.framesSent++;
      this.isPlayingOut = true;
      this.lastRealFrameAt = Date.now();
      if (this.audioItemId !== this.playingItemId) {
        this.playingItemId = this.audioItemId;
        this.playedMsForItem = 0;
      }
      this.playedMsForItem += OpenAIRealtimePipeline.FRAME_MS;
      if (!this.firstFrameLogged) {
        this.firstFrameLogged = true;
        const bootMs = this.lastRealFrameAt - this.startedAtMs;
        logger.info({ callId: this.config.callId, bootMs }, "OpenAI Realtime: first agent audio on the wire");
        createExecutionLogger(this.config.callId, null)(EXEC_COMPONENTS.TTS, "system", {
          provider: "openai_realtime",
          status: "info",
          latencyMs: bootMs,
          metadata: { event: "First Agent Audio", bootMs },
        });
      }
      this.lastOutPcm8k = pcm8k;
      this.recording.addAgentChunk(pcm8k);
      this.config.onAudioOut(this.toWire(pcm8k));
    }
  }

  // ── Tools ────────────────────────────────────────────────────────────────

  private async handleToolCalls(calls: FunctionCallItem[]): Promise<void> {
    for (const call of calls) {
      let rawArgs: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(call.arguments || "{}") as unknown;
        if (parsed && typeof parsed === "object") rawArgs = parsed as Record<string, unknown>;
      } catch {
        logger.warn({ callId: this.config.callId, tool: call.name }, "OpenAI Realtime: tool arguments were not valid JSON");
      }
      const args = looksLikeBookOrRescheduleTool(call.name)
        ? applyBookingEmailToBookArgs(this.bookingFlowState, rawArgs)
        : rawArgs;
      const result = await runLiveToolCall(
        {
          config: this.config,
          agent: this.agent,
          onAgentText: (text) => this.appendAgent(text),
          speakText: (text) => this.speakRaw(text),
          endCall: () => {
            this.endReasonHint = "end_call";
            void this.waitUntilSpokenAudioDrained(0, 5_000).then(() => this.config.onCallEnd());
          },
          genuineUserTurns: () =>
            this.history.filter((m) => m.role === "user" && m.content.trim().length > 0).length,
          schedulingActionConfirmed: () => this.schedulingActionConfirmed,
        },
        call.name,
        args,
      );
      if (liveToolResultConfirmedBooking(result)) this.schedulingActionConfirmed = true;
      const toolBlob = [
        typeof result["output"] === "string" ? result["output"] : "",
        typeof result["error"] === "string" ? result["error"] : "",
      ].join(" ").trim();
      if (toolBlob) {
        this.bookingFlowState = updateBookingFlowFromToolResult(this.bookingFlowState, call.name, toolBlob);
      }
      this.maybeCorrectFailedBooking(call.name, result);
      // Squad handoff closes this session from inside the transfer tool.
      if (this.closed) return;
      this.send({
        type: "conversation.item.create",
        item: { type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result) },
      });
    }
    if (this.closed || this.endReasonHint === "end_call") return;
    this.requestResponse();
  }

  private maybeCorrectFailedBooking(toolName: string, result: Record<string, unknown>): void {
    if (!/book_appointment|native_booking/i.test(toolName)) return;
    const output = typeof result["output"] === "string" ? result["output"] : "";
    const err = typeof result["error"] === "string" ? result["error"] : "";
    if (/booking_confirmed/.test(`${output} ${err}`)) return;
    const spoken = `${this.outputBuf} ${this.lastAgentText ?? ""}`;
    if (looksLikeFalseBookingClaim(spoken)) {
      this.pendingOut24k = Buffer.alloc(0);
      this.outFrames8k.length = 0;
      this.config.onBargeIn?.();
      logger.warn({ callId: this.config.callId, toolName }, "OpenAI Realtime: dropped spoken booking claim after tool did not confirm");
    }
    this.nudgeBookingTruth();
  }

  private nudgeExactEmailSpell(): void {
    if (this.closed) return;
    if (!bookingAsksCallerForEmail(this.agent.tools.find((t) => t.type === "native_booking"))) return;
    if (!shouldSpeakEmailSpell(this.bookingFlowState) || !this.bookingFlowState.pendingEmail) return;
    const line = buildEmailSpellLine(this.bookingFlowState.pendingEmail);
    this.addSystemNote(`In your next reply, speak exactly this and then wait: ${line} Do not invent a different email.`);
  }

  private nudgeBookingTruth(): void {
    if (this.bookingTruthPromptSent || this.closed) return;
    this.bookingTruthPromptSent = true;
    this.addSystemNote(
      "The booking was not saved. Do not tell the caller they are booked. " +
      "Say the booking could not be completed and offer to transfer or try again.",
    );
  }

  // ── Transcript ───────────────────────────────────────────────────────────

  private flushOutputBuf(finalText?: string): void {
    const text = (finalText ?? this.outputBuf).trim();
    this.outputBuf = "";
    if (!text) return;
    if (!this.schedulingActionConfirmed && looksLikeFalseBookingClaim(text)) {
      this.pendingOut24k = Buffer.alloc(0);
      this.outFrames8k.length = 0;
      this.config.onBargeIn?.();
      logger.warn({ callId: this.config.callId, text: text.slice(0, 120) }, "OpenAI Realtime: suppressed spoken booking claim with no booking_confirmed");
      this.nudgeBookingTruth();
    }
    this.appendAgent(text);
    this.config.onTranscript("agent", text);
  }

  /** iPhone Ask Reason for Calling / Google Call Screen on outbound calls → voicemail. */
  private tryHangupCallScreening(transcript: string): boolean {
    if (this.screeningHangupDone || this.closed) return false;
    if (this.config.callDirection !== "outbound") return false;
    if (Date.now() - this.screeningWindowStart > CALL_SCREENING_WINDOW_MS) return false;
    if (!detectScreeningPrompt(transcript)) return false;
    this.screeningHangupDone = true;
    logger.info({ callId: this.config.callId, transcript: transcript.slice(0, 160) }, "OpenAI Realtime: call screening bot detected — hanging up as voicemail");
    createExecutionLogger(this.config.callId, null)(EXEC_COMPONENTS.STT, "system", {
      provider: "openai_realtime",
      status: "info",
      metadata: { event: "Call Screening Detected", action: "hangup_voicemail", screenerPrompt: transcript.slice(0, 160) },
    });
    this.pendingOut24k = Buffer.alloc(0);
    this.outFrames8k.length = 0;
    this.isPlayingOut = false;
    try { this.config.onAmdResult?.("machine"); } catch { /* best-effort */ }
    try { this.config.onVoicemailAction?.(); } catch { /* best-effort */ }
    this.config.onCallEnd();
    return true;
  }

  private appendUser(text: string): void {
    this.lastUserText = text;
    const last = this.history[this.history.length - 1];
    if (last?.role === "user") {
      last.content = `${last.content} ${text}`.trim();
    } else {
      this.history.push({ role: "user", content: text });
    }
    this.bookingFlowState = updateBookingFlowFromUserTurn(this.bookingFlowState, text, this.lastAgentText ?? "");
  }

  private appendAgent(text: string): void {
    const clean = stripLiveMarkup(text);
    if (!clean) return;
    this.lastAgentText = clean;
    const last = this.history[this.history.length - 1];
    if (last?.role === "assistant") {
      last.content = `${last.content} ${clean}`.trim();
    } else {
      this.history.push({ role: "assistant", content: clean });
    }
    this.bookingFlowState = updateBookingFlowFromAssistantText(this.bookingFlowState, clean);
  }
}

/** Map classic/Live history into Realtime conversation items for a squad takeover. */
export function toRealtimeHandoffItems(
  turns: ConversationTurn[] | undefined,
): Array<Record<string, unknown>> {
  if (!turns?.length) return [];
  return turns
    .filter((t) => (t.role === "user" || t.role === "assistant") && t.content.trim())
    .slice(-HANDOFF_SEED_MAX_TURNS)
    .map((t) => t.role === "assistant"
      ? { type: "message", role: "assistant", content: [{ type: "output_text", text: t.content.trim() }] }
      : { type: "message", role: "user", content: [{ type: "input_text", text: t.content.trim() }] });
}
