import {
  GoogleGenAI,
  Modality,
  ThinkingLevel,
  type FunctionCall,
  type LiveServerMessage,
  type Session,
} from "@google/genai";
import type { AgentConfig, ConversationTurn, SessionConfig } from "../../types.js";
import type { VoiceSession } from "../../voice-session.js";
import { RecordingBuffer, WEBCALL_GAP_RESYNC_MS } from "../../recorder.js";
import {
  attenuatePcm16,
  createDownsampler24to8,
  decodeMulaw,
  encodeMulaw,
  frameRms,
  upsample8to16,
} from "../../audio.js";
import { processRawPcm8kIn } from "../../audioPool.js";
import {
  envForceVobizSoftwareNc,
  resolveSoftwareNoiseGate,
  type NoiseGateDecision,
} from "../../noise-gate.js";
import {
  getMicSensitivityThresholds,
  resolveBargeInEnergyThreshold,
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
import { buildToolDefs } from "../../../services/tool-executor.js";
import {
  resolveGeminiLiveModel,
  resolveGeminiLiveThinkingLevel,
  resolveGeminiLiveVoice,
} from "./gemini-live-voices.js";
import { toGeminiLiveTools } from "./gemini-tools.js";
import { runLiveToolCall } from "./live-tool-runner.js";
import { mergeTranscriptFragment } from "./live-transcript-merge.js";
import { CALL_SCREENING_WINDOW_MS, detectScreeningPrompt } from "../../callScreening.js";

const SCHEDULE_CALLBACK_TOOL = {
  name: "schedule_callback",
  description:
    "Schedule a callback when the caller explicitly asks to be called back later.",
  parameters: {
    type: "object" as const,
    properties: {
      scheduled_at: {
        type: "string" as const,
        description:
          "Local wall-clock datetime to call back, in the business timezone shown in your current date/time context. Resolve relative phrasing ('tomorrow', 'this evening', 'in two hours') against the current date/time and output an absolute ISO 8601 value WITHOUT a timezone suffix (e.g. '2026-06-23T15:00:00'). Omit if no time was mentioned — defaults to 1 hour from now.",
      },
      notes: {
        type: "string" as const,
        description: "Brief note capturing why the callback was requested, in the caller's words.",
      },
    },
    required: [] as string[],
  },
};

const SCHEDULE_MEET_REJOIN_TOOL = {
  name: "schedule_meet_rejoin",
  description:
    "Schedule a SnapServe meeting agent to rejoin this same Meet/Zoom/Teams link later. Use for same-URL rejoin; use book/reschedule for a new calendar slot.",
  parameters: {
    type: "object" as const,
    properties: {
      scheduled_at: {
        type: "string" as const,
        description: "When to rejoin as ISO 8601 without timezone suffix.",
      },
      meet_url: {
        type: "string" as const,
        description: "Optional. Defaults to the current meeting link.",
      },
      notes: {
        type: "string" as const,
        description: "Short note about the rejoin request.",
      },
    },
    required: ["scheduled_at"] as string[],
  },
};

const MEETING_PRESENTATION_TOOLS: Array<{
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description?: string }>;
    required: string[];
  };
}> = [
  {
    name: "start_presentation",
    description:
      "Start screensharing a presentation in this meeting. Uses configured URL unless url is provided.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Optional https:// Google Slides, PDF, or webpage URL.",
        },
      },
      required: [],
    },
  },
  {
    name: "stop_presentation",
    description: "Stop screensharing the presentation.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "next_slide",
    description: "Advance to the next slide while presenting.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "previous_slide",
    description: "Go back to the previous slide while presenting.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "goto_slide",
    description: "Jump to a specific slide number (1-based) while presenting.",
    parameters: {
      type: "object",
      properties: {
        slide: { type: "number", description: "Slide number to show (starting at 1)." },
      },
      required: ["slide"],
    },
  },
  {
    name: "send_meeting_chat",
    description:
      "Post a short message to the meeting chat (links, agenda, summary). Keep under ~500 characters.",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "Chat message for everyone." },
        pin: { type: "boolean", description: "Pin on Google Meet (optional)." },
      },
      required: ["message"],
    },
  },
  {
    name: "leave_meeting",
    description: "Leave the video meeting now when the host wraps up or asks you to leave.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "mute_meeting",
    description: "Mute your audio output into the meeting. Call unmute_meeting before speaking again.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "unmute_meeting",
    description: "Unmute your audio output into the meeting so you can speak again.",
    parameters: { type: "object", properties: {}, required: [] },
  },
];

export class GeminiLivePipeline implements VoiceSession {
  public endReasonHint: string | null = null;

  private readonly config: SessionConfig;
  private readonly agent: AgentConfig;
  private readonly apiKey: string;
  private readonly recording: RecordingBuffer;
  private readonly history: ConversationTurn[] = [];
  private lastUserText: string | null = null;
  private lastAgentText: string | null = null;

  /** Streaming Live transcription buffers — flushed on turn boundaries. */
  private inputBuf = "";
  private outputBuf = "";

  private session: Session | null = null;
  private connectPromise: Promise<void> | null = null;
  private closed = false;
  private greetingSent = false;
  private pendingOut24k = Buffer.alloc(0);
  // Frames are decimated one 20 ms slice at a time, so the filter must carry its
  // tail across slices — a stateless per-frame call renormalizes the kernel at
  // both block edges and bakes a 50 Hz buzz into the voice (see audio.ts).
  private readonly outDecim24to8 = createDownsampler24to8();
  private isPlayingOut = false;

  // ── Caller-audio isolation ───────────────────────────────────────────────
  // Live used to send caller audio straight to Gemini, which made the Noise
  // Cancellation toggle a no-op on this stack. Both Live and classic now share
  // resolveSoftwareNoiseGate + the audio-worker GTCRN isolator (energy gate
  // fallback) so the same toggle covers every LLM.
  private readonly noiseGate: NoiseGateDecision;
  private readonly micThresholds: MicSensitivityThresholds;
  private readonly gateRatio: number;
  /** Serialize isolator + Gemini send so 20 ms frames stay in order. */
  private audioInChain: Promise<void> = Promise.resolve();

  // ── Paced outbound pump ──────────────────────────────────────────────────
  // Gemini Live streams a whole reply's audio much faster than real time. If we
  // forward it to the carrier as it arrives, the carrier buffers many seconds of
  // speech and a barge-in "clearAudio" can't stop what's already buffered — the
  // caller keeps hearing the old (pre-interruption) answer. So we hold frames
  // HERE and release them at real-time pace (20ms frames + small jitter lead);
  // on interruption the local queue is dropped instantly.
  private outFrames8k: Buffer[] = [];
  private pumpTimer: ReturnType<typeof setInterval> | null = null;
  private pumpAnchorMs = 0;
  private framesSent = 0;
  private static readonly FRAME_MS = 20;
  private static readonly LEAD_MS = 240; // frames allowed ahead of real time (carrier jitter buffer)
  // Gemini does not always deliver a reply faster than real time. Starting the
  // pump on the very first 20 ms frame means one slow chunk drains the queue
  // mid-word, and the caller hears the reply chopped into pieces. Hold a small
  // jitter buffer before (re)starting playback so a slow chunk is absorbed.
  private static readonly PREBUFFER_FRAMES = 16; // 320 ms — do not start on the first 20 ms
  private underruns = 0;
  private lastOutPcm8k: Buffer | null = null;

  // ── Self-echo suppression ────────────────────────────────────────────────
  // On a PSTN leg there is no AEC between our outbound audio and the caller
  // audio the carrier returns, so the agent's own voice comes back as "caller
  // speech". Gemini's server VAD then fires `interrupted` and we clear the
  // reply — the agent cuts itself off ~200 ms after it starts talking. The
  // classic pipeline defends with an echo grace + a measured echo floor
  // (BARGE_IN_ECHO_* in pipeline.ts); Live forwarded every frame raw. Mirror
  // that here: mute the caller leg while returning echo dominates, and after
  // the grace require energy above the learned echo floor to pass through, so
  // a genuinely loud caller can still barge in.
  private agentAudioStartedAt = 0;
  private echoFloorRms = 0;
  private echoSamples = 0;
  private echoSuppressedFrames = 0;
  private static readonly ECHO_CALIBRATION_MS = 250;
  private static readonly ECHO_MARGIN = 1.6;
  private static readonly ECHO_MAX_BAR = 2500;
  private static readonly ECHO_FLOOR_RISE_ALPHA = 0.05;
  private static readonly ECHO_FLOOR_FALL_ALPHA = 0.3;

  // ── Carrier keepalive / ambient bed ──────────────────────────────────────
  // Gemini Live only emits audio while the model is actually speaking, so the
  // wait for the greeting and every conversational pause left the outbound leg
  // completely idle. VoBiz drops the call (hangup 4010) when the audio bridge
  // receives nothing for ~2 s even with keepCallAlive="true" — long enough that
  // Live agents went silent before the greeting ever arrived. This mirrors the
  // classic pipeline's watchdog: fill genuine gaps with the agent's ambient bed
  // (or PCM zeros on VoBiz), and stay quiet while real frames are flowing so
  // two senders never interleave on the same 20 ms cadence.
  private ambientStream: AmbientNoiseStream | FileAmbientNoiseStream | null = null;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private lastRealFrameAt = 0;
  private readonly startedAtMs = Date.now();
  private firstFrameLogged = false;
  private static readonly KEEPALIVE_FILL_GAP_MS = 500;

  // Serialize server-message handling: tool calls await inside the handler, and
  // firing handlers unordered lets late audio/transcripts overtake an
  // interruption (stale-answer symptom).
  private msgChain: Promise<void> = Promise.resolve();
  private meetingForceMuted = false;
  private meetingMuteWhenIdle = false;
  private pendingMeetingNotes: string[] = [];
  /** Last Live session-resumption handle — reconnects after GoAway / socket close. */
  private resumptionHandle: string | null = null;
  private reconnecting = false;
  private reconnectAttempts = 0;
  private static readonly MAX_LIVE_RECONNECTS = 2;
  private screeningHangupDone = false;
  private readonly screeningWindowStart = Date.now();

  constructor(config: SessionConfig) {
    const rawAudioOut = config.onAudioOut;
    this.config = {
      ...config,
      onAudioOut: (audio: Buffer) => {
        if (this.blocksMeetingAudioOut()) return;
        rawAudioOut(audio);
      },
    };
    this.meetingMuteWhenIdle = config.meetingMuteWhenIdle === true;
    this.agent = config.agentConfig;
    const key = config.providerKeys.get("google") ?? config.providerKeys.get("gemini");
    if (!key) {
      throw new Error("Gemini Live requires a Google API key (managed or BYOP)");
    }
    this.apiKey = key;
    this.recording = new RecordingBuffer(
      8000,
      config.telephonyProvider === "webcall" ? WEBCALL_GAP_RESYNC_MS : undefined,
    );
    if (config.answeredAt) {
      this.recording.anchorStart(config.answeredAt);
    }
    this.micThresholds = getMicSensitivityThresholds(resolveMicSensitivity());
    this.gateRatio = this.micThresholds.gateRatio;
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
        voiceStack: "gemini-live",
        toggle: this.agent.noiseCancellationEnabled,
        softwareGate: this.noiseGate.enabled,
        reason: this.noiseGate.reason,
        gateRatio: this.noiseGate.enabled ? this.gateRatio : undefined,
      },
      "Noise cancellation resolved",
    );
    this.initAmbient();
    this.startKeepalive();
  }

  /** Sample rate of the raw-PCM output leg (8000 unless a webcall client
   *  negotiated HD 16k). Only meaningful when rawPcmOutput is true. */
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
        logger.error({ callId: this.config.callId, track, err }, "Gemini Live: ambient load failed — keepalive falls back to silence");
      });
  }

  private startKeepalive(): void {
    const isVobiz = this.config.telephonyProvider === "vobiz";
    const silenceFrame = Buffer.alloc(
      this.config.rawPcmOutput
        ? (this.pcmOutRate() / 1000) * GeminiLivePipeline.FRAME_MS * 2
        : GeminiLivePipeline.FRAME_MS * 8,
      0,
    );

    const timer = setInterval(() => {
      if (this.closed) return;
      // Real audio flowing → the pump owns the wire; stay silent.
      if (Date.now() - this.lastRealFrameAt < GeminiLivePipeline.KEEPALIVE_FILL_GAP_MS) return;
      if (this.ambientStream) {
        this.config.onAudioOut(this.nextAmbientFrame(this.ambientStream));
      } else if (isVobiz) {
        this.config.onAudioOut(silenceFrame);
      }
    }, GeminiLivePipeline.FRAME_MS);
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

  onRawPcm8kIn(pcm8k: Buffer, noiseCancel?: boolean, nativePcm16k?: Buffer): void {
    if (this.closed || pcm8k.length < 2) return;
    // Record and tap the RAW caller audio, so the recording stays a faithful
    // copy of what the carrier delivered even when isolation is running.
    this.recording.addCallerChunk(pcm8k);
    this.config.callerAudioTap?.(pcm8k);

    // An explicit caller-supplied flag wins (webcall passes false because the
    // browser already ran AEC/NS); otherwise use the per-call decision.
    const gateOn = noiseCancel !== undefined ? noiseCancel : this.noiseGate.enabled;
    const callId = String(this.config.callId);
    const pcm8kCopy = Buffer.from(pcm8k);
    const nativeCopy = nativePcm16k?.length ? Buffer.from(nativePcm16k) : undefined;
    const muteEcho = this.isSelfEcho(pcm8k);

    this.audioInChain = this.audioInChain.then(async () => {
      if (this.closed) return;
      let pcm16k: Buffer;
      if (muteEcho) {
        // Send silence rather than nothing: a continuous stream keeps Gemini's
        // VAD timing honest, it just has no echo to trigger on.
        pcm16k = Buffer.alloc(pcm8kCopy.length * 2);
        await this.ensureConnected();
        if (this.closed || !this.session) return;
        this.session.sendRealtimeInput({
          audio: { data: pcm16k.toString("base64"), mimeType: "audio/pcm;rate=16000" },
        });
        return;
      }
      if (gateOn) {
        const result = await processRawPcm8kIn(
          callId,
          pcm8kCopy,
          true,
          this.micThresholds.gateRatio,
          this.micThresholds.vadThreshold,
        );
        pcm16k = result.pcm16k;
      } else {
        pcm16k = nativeCopy?.length ? nativeCopy : upsample8to16(pcm8kCopy);
      }
      if (this.closed || pcm16k.length < 2) return;
      await this.ensureConnected();
      if (this.closed || !this.session) return;
      this.session.sendRealtimeInput({
        audio: {
          data: pcm16k.toString("base64"),
          mimeType: "audio/pcm;rate=16000",
        },
      });
    }).catch((err) => {
      logger.error({ callId: this.config.callId, err }, "Gemini Live caller-audio path failed");
    });
  }

  /**
   * True when this caller frame is most likely our own audio coming back off
   * the carrier rather than the person on the line.
   *
   * Webcall legs are excluded: the browser already runs AEC, so there is no
   * echo to reject and gating there would only cost real barge-ins.
   */
  private isSelfEcho(pcm8k: Buffer): boolean {
    if (this.config.rawPcmOutput) return false;
    if (!(this.isPlayingOut || this.outFrames8k.length > 0)) return false;

    const rms = frameRms(pcm8k);
    const sinceStart = Date.now() - this.agentAudioStartedAt;

    // Right after a line starts, anything returning is echo — measure it.
    if (sinceStart <= GeminiLivePipeline.ECHO_CALIBRATION_MS) {
      const alpha = rms > this.echoFloorRms
        ? GeminiLivePipeline.ECHO_FLOOR_RISE_ALPHA
        : GeminiLivePipeline.ECHO_FLOOR_FALL_ALPHA;
      this.echoFloorRms = this.echoSamples === 0
        ? rms
        : this.echoFloorRms + alpha * (rms - this.echoFloorRms);
      this.echoSamples++;
      this.echoSuppressedFrames++;
      return true;
    }
    if (sinceStart <= this.agent.bargeInEchoGraceMs) {
      this.echoSuppressedFrames++;
      return true;
    }

    // Past the grace: a caller louder than the measured echo still gets through.
    const bar = Math.min(
      GeminiLivePipeline.ECHO_MAX_BAR,
      Math.max(
        resolveBargeInEnergyThreshold(this.agent.bargeInEnergyThreshold),
        this.echoFloorRms * GeminiLivePipeline.ECHO_MARGIN,
      ),
    );
    if (rms >= bar) return false;
    this.echoSuppressedFrames++;
    return true;
  }

  /** Test hook: wait until queued caller frames have been sent to Gemini. */
  async flushCallerAudio(): Promise<void> {
    await this.audioInChain;
  }

  async greet(): Promise<void> {
    if (this.closed || this.greetingSent) return;
    await this.ensureConnected();
    if (this.agent.firstSpeaker === "user") {
      logger.info({ callId: this.config.callId }, "Gemini Live: first speaker = user — waiting for caller");
      return;
    }

    this.greetingSent = true;
    const greeting = (this.agent.greetingMessage ?? "").trim();
    const prompt = greeting
      ? `Begin the call by speaking this greeting naturally: "${greeting}"`
      : "Begin the call with a brief, friendly greeting and ask how you can help.";

    this.session?.sendRealtimeInput({ text: prompt });
  }

  async confirmAmdMachineThenBranch(): Promise<void> {
    // v1: AMD/voicemail paths are classic-only — fall through to normal greeting.
    await this.greet();
  }

  async deliverVoicemail(): Promise<void> {
    await this.greet();
  }

  async finishSpeakingForMaxDuration(graceMs: number): Promise<void> {
    if (graceMs <= 0) return;
    await new Promise((r) => setTimeout(r, graceMs));
  }

  async speakRaw(text: string): Promise<void> {
    if (this.closed || !text.trim()) return;
    await this.ensureConnected();
    this.appendAgent(text);
    this.config.onTranscript("agent", text);
    this.session?.sendRealtimeInput({
      text: `Speak exactly the following to the caller: "${text}"`,
    });
  }

  getTranscript(): string {
    // Commit streaming buffers so callers that read before close() still get
    // the latest Live transcription fragments.
    this.flushInputBuf();
    this.flushOutputBuf();
    return this.history
      .filter((t) => t.content.trim() !== "")
      .map((t) => {
        const content = stripLiveMarkup(t.content);
        return `${t.role === "user" ? "Caller" : "Agent"}: ${content}`;
      })
      .filter((line) => !/^(Caller|Agent):\s*$/.test(line))
      .join("\n");
  }

  getHistory(): ConversationTurn[] {
    this.flushInputBuf();
    this.flushOutputBuf();
    return [...this.history];
  }

  getLastTurnTexts(): { lastUser: string | null; lastAgent: string | null } {
    return { lastUser: this.lastUserText, lastAgent: this.lastAgentText };
  }

  getPreferredCallerLang(): string {
    return this.agent.language ?? this.agent.sttConfig.language ?? "en-IN";
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

  injectMeetingNote(note: string): void {
    const n = note.trim().slice(0, 200);
    if (!n || this.pendingMeetingNotes.length >= 10) return;
    this.pendingMeetingNotes.push(n);
  }

  injectMeetingChat(from: string, text: string): void {
    const who = from.trim().slice(0, 60) || "Participant";
    const body = text.replace(/\s+/g, " ").trim().slice(0, 400);
    if (!body || this.closed) return;
    const line = `[Meeting chat from ${who}]: ${body}`;
    void this.ensureConnected().then(() => {
      if (this.closed) return;
      this.session?.sendRealtimeInput({ text: line });
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

  /** Meeting roster cost-cut: end SnapServe session when the room empties. */
  endMeetingSession(reason?: string): void {
    if (this.closed) return;
    this.endReasonHint = reason?.trim() || "meeting_ended";
    logger.info(
      { callId: this.config.callId, reason: this.endReasonHint },
      "Gemini Live meeting session ended by roster cost-cut",
    );
    this.config.onCallEnd();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    // Commit any in-flight Live transcription so post-call disposition/memory
    // see the full conversation (Gemini often omits a final turnComplete).
    this.flushInputBuf();
    this.flushOutputBuf();
    this.stopPump();
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
    this.outFrames8k.length = 0;
    try {
      this.session?.close();
    } catch (err) {
      logger.debug({ callId: this.config.callId, err }, "Gemini Live session close error");
    }
    this.session = null;
  }

  noteMediaDropIfWaitingForReply(): void {
    // Live stack uses native VAD — no classic STT wait state.
  }

  onExternalAmdSignal(_verdict: "machine" | "human", _source: string): void {
    // v1: AMD corroboration is classic-only.
  }

  private async ensureConnected(): Promise<void> {
    if (this.session) return;
    if (!this.connectPromise) {
      this.connectPromise = this.connect();
    }
    await this.connectPromise;
  }

  private async connect(): Promise<void> {
    const ai = new GoogleGenAI({ apiKey: this.apiKey });
    const liveCfg = this.agent.geminiLive;
    const model = resolveGeminiLiveModel(liveCfg?.model);
    const voiceName = resolveGeminiLiveVoice(liveCfg?.voiceName);
    const thinkingLevel = resolveGeminiLiveThinkingLevel(liveCfg?.thinkingLevel);

    const toolDefs = buildToolDefs(this.agent.tools);
    toolDefs.push(SCHEDULE_CALLBACK_TOOL);
    if (this.agent.isMeetingSession) {
      toolDefs.push(SCHEDULE_MEET_REJOIN_TOOL, ...MEETING_PRESENTATION_TOOLS);
    }
    const tools = toGeminiLiveTools(toolDefs);

    const thinkingMap: Record<string, ThinkingLevel> = {
      minimal: ThinkingLevel.MINIMAL,
      low: ThinkingLevel.LOW,
      medium: ThinkingLevel.MEDIUM,
      high: ThinkingLevel.HIGH,
    };

    const connectStarted = Date.now();
    const liveSessionExtras: Record<string, unknown> = {
      // Without compression, audio sessions hard-drop around 15 min.
      contextWindowCompression: { slidingWindow: {} },
      // Empty object enables handle updates; pass the last handle on reconnect.
      sessionResumption: this.resumptionHandle ? { handle: this.resumptionHandle } : {},
    };
    this.session = await ai.live.connect({
      model,
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: this.agent.systemPrompt,
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
        thinkingConfig: {
          thinkingLevel: thinkingMap[thinkingLevel] ?? ThinkingLevel.MINIMAL,
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        tools,
        temperature: this.agent.temperature,
        ...liveSessionExtras,
      },
      callbacks: {
        onmessage: (msg) => {
          // Handle interruption SYNCHRONOUSLY, before the ordered chain — a
          // long-running tool call inside the chain must never head-of-line
          // block the barge-in (queue clear + carrier clearAudio).
          if (msg.serverContent?.interrupted) this.handleInterrupted();
          this.msgChain = this.msgChain
            .then(() => this.onServerMessage(msg))
            .catch((err) => logger.error({ callId: this.config.callId, err }, "Gemini Live message handler error"));
        },
        onerror: (e) => {
          logger.error({ callId: this.config.callId, err: e.error ?? e }, "Gemini Live socket error");
          if (!this.closed && this.resumptionHandle && this.reconnectAttempts < GeminiLivePipeline.MAX_LIVE_RECONNECTS) {
            void this.tryResumeAfterDisconnect("socket_error");
            return;
          }
          this.handleFatal(e.error ?? e);
        },
        onclose: () => {
          if (this.closed || this.reconnecting) return;
          logger.info({ callId: this.config.callId, hasHandle: Boolean(this.resumptionHandle) }, "Gemini Live socket closed");
          void this.tryResumeAfterDisconnect("socket_closed");
        },
      },
    });

    const connectMs = Date.now() - connectStarted;
    logger.info({ callId: this.config.callId, model, voiceName, connectMs }, "Gemini Live session connected");
    createExecutionLogger(this.config.callId, null)(EXEC_COMPONENTS.LLM, "system", {
      provider: "gemini_live",
      status: "info",
      latencyMs: connectMs,
      metadata: {
        event: "Gemini Live Connected",
        model,
        voiceName,
        promptChars: this.agent.systemPrompt.length,
      },
    });
  }

  private async onServerMessage(msg: LiveServerMessage): Promise<void> {
    if (this.closed) return;

    const content = msg.serverContent;

    // Live streams transcription as deltas or cumulative fragments with no
    // reliable `finished` flag. Buffer until a turn boundary, then commit.
    if (content?.inputTranscription?.text) {
      this.inputBuf = mergeTranscriptFragment(this.inputBuf, content.inputTranscription.text);
      if (this.tryHangupCallScreening(this.inputBuf)) return;
    }

    if (content?.outputTranscription?.text) {
      // Model started speaking → caller turn is done.
      if (this.inputBuf.trim()) this.flushInputBuf();
      this.outputBuf = mergeTranscriptFragment(this.outputBuf, content.outputTranscription.text);
    }

    const inlineAudio = msg.data;
    if (inlineAudio) {
      const pcm24k = Buffer.from(inlineAudio, "base64");
      this.pendingOut24k = Buffer.concat([this.pendingOut24k, pcm24k]);
      this.flushOutboundAudio();
    }

    if (msg.toolCall?.functionCalls?.length) {
      // Tool calls usually follow user speech with no output transcription yet.
      if (this.inputBuf.trim()) this.flushInputBuf();
      await this.handleToolCalls(msg.toolCall.functionCalls);
    }

    const extras = msg as LiveServerMessage & {
      sessionResumptionUpdate?: { newHandle?: string; resumable?: boolean };
      goAway?: { timeLeft?: string };
    };
    const handle = extras.sessionResumptionUpdate?.newHandle;
    if (typeof handle === "string" && handle.trim()) {
      this.resumptionHandle = handle.trim();
    }
    if (extras.goAway && !this.closed) {
      logger.info(
        { callId: this.config.callId, timeLeft: extras.goAway.timeLeft },
        "Gemini Live GoAway — resuming session",
      );
      void this.tryResumeAfterDisconnect("go_away");
    }

    if (content?.turnComplete) {
      this.flushInputBuf();
      this.flushOutputBuf();
      // Release a tail shorter than the prebuffer — no more audio is coming.
      this.flushOutboundAudio(true);
      this.isPlayingOut = false;
      // Classic STT→LLM→TTS metrics don't apply; count a conversational turn
      // so History / wasDropped / no_turns logic treat Live calls as real.
      this.config.onMetrics?.({ sttLatencyMs: 0, llmLatencyMs: 0, ttsFirstChunkMs: 0 });
      this.config.onConversationUpdate?.(this.getHistory());
    }
  }

  /** Runs synchronously from onmessage — must never await (see onmessage note). */
  private handleInterrupted(): void {
    if (this.closed) return;
    const droppedMs = this.outFrames8k.length * GeminiLivePipeline.FRAME_MS;
    this.pendingOut24k = Buffer.alloc(0);
    this.outFrames8k.length = 0; // drop locally queued (unplayed) audio immediately
    this.lastOutPcm8k = null;
    this.isPlayingOut = false;
    // Commit what was already transcribed; drop only unplayed audio frames.
    this.flushOutputBuf();
    this.config.onBargeIn?.();
    logger.info(
      {
        callId: this.config.callId,
        droppedMs,
        sinceAgentAudioMs: this.agentAudioStartedAt ? Date.now() - this.agentAudioStartedAt : null,
        echoFloorRms: Math.round(this.echoFloorRms),
        echoSuppressedFrames: this.echoSuppressedFrames,
      },
      "Gemini Live: interrupted — cleared queued audio",
    );
    // If we wiped real queued speech, nudge the model so "Hello"/barge-in does not
    // leave the caller in dead air with status completed and no agent reply.
    if (droppedMs >= 200 && this.session && !this.closed) {
      try {
        this.session.sendRealtimeInput({
          text:
            "The caller just spoke or interrupted. Continue the conversation now — " +
            "acknowledge them briefly and answer. Do not stay silent.",
        });
      } catch (err) {
        logger.warn({ callId: this.config.callId, err }, "Gemini Live: interrupt recovery nudge failed");
      }
    }
  }

  private flushInputBuf(): void {
    const text = this.inputBuf.trim();
    this.inputBuf = "";
    if (!text) return;
    this.appendUser(text);
    this.config.onTranscript("user", text);
    this.tryHangupCallScreening(text);
  }

  /**
   * iPhone Ask Reason for Calling / Google Call Screen on outbound Live calls:
   * hang up and mark voicemail instead of letting Gemini treat the robot as a human.
   */
  private tryHangupCallScreening(transcript: string): boolean {
    if (this.screeningHangupDone || this.closed) return false;
    if (this.config.callDirection !== "outbound") return false;
    if (Date.now() - this.screeningWindowStart > CALL_SCREENING_WINDOW_MS) return false;
    if (!detectScreeningPrompt(transcript)) return false;

    this.screeningHangupDone = true;
    const text = transcript.trim();
    if (text && this.inputBuf.trim()) {
      this.flushInputBuf();
    }
    logger.info(
      { callId: this.config.callId, transcript: text.slice(0, 160) },
      "Gemini Live: call screening bot detected — hanging up as voicemail",
    );
    createExecutionLogger(this.config.callId, null)(EXEC_COMPONENTS.STT, "system", {
      provider: "gemini_live",
      status: "info",
      metadata: {
        event: "Call Screening Detected",
        action: "hangup_voicemail",
        screenerPrompt: text.slice(0, 160),
      },
    });
    this.pendingOut24k = Buffer.alloc(0);
    this.outFrames8k.length = 0;
    this.isPlayingOut = false;
    try { this.config.onAmdResult?.("machine"); } catch { /* best-effort */ }
    try { this.config.onVoicemailAction?.(); } catch { /* best-effort */ }
    this.config.onCallEnd();
    return true;
  }

  private flushOutputBuf(): void {
    const text = this.outputBuf.trim();
    this.outputBuf = "";
    if (!text) return;
    this.appendAgent(text);
    this.config.onTranscript("agent", text);
  }

  private flushOutboundAudio(force = false): void {
    // Slice into ~20ms frames at 24kHz (480 samples = 960 bytes) and queue them
    // for the paced pump — never forward faster than real time (see pump docs).
    const FRAME_BYTES_24K = 960;
    while (this.pendingOut24k.length >= FRAME_BYTES_24K) {
      const frame24k = this.pendingOut24k.subarray(0, FRAME_BYTES_24K);
      this.pendingOut24k = this.pendingOut24k.subarray(FRAME_BYTES_24K);
      this.outFrames8k.push(this.outDecim24to8.process(frame24k));
    }
    if (!this.outFrames8k.length) return;
    // Already streaming: keep feeding. Otherwise wait for the jitter buffer so a
    // fresh (or post-underrun) start has cushion — force only on turn end, where
    // no more audio is coming and a short tail must still be played.
    const ready =
      this.pumpTimer !== null
      || force
      || this.outFrames8k.length >= GeminiLivePipeline.PREBUFFER_FRAMES;
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

  private pumpTick(): void {
    if (this.closed) { this.stopPump(); return; }
    if (this.outFrames8k.length === 0) {
      // Mid-reply stall: hold a faded last frame so the carrier does not
      // go silent. Pace at 20 ms like real frames. Stop when this reply ends.
      if (this.isPlayingOut && this.lastOutPcm8k) {
        const elapsedMs = Date.now() - this.pumpAnchorMs + GeminiLivePipeline.LEAD_MS;
        if (this.framesSent * GeminiLivePipeline.FRAME_MS >= elapsedMs) return;
        this.underruns++;
        const hold = attenuatePcm16(this.lastOutPcm8k, 0.35);
        this.recording.addAgentChunk(hold);
        const out = this.config.rawPcmOutput
          ? (this.pcmOutRate() === 16000 ? upsample8to16(hold) : hold)
          : encodeMulaw(hold);
        this.config.onAudioOut(out);
        this.framesSent++;
        if (this.underruns === 1 || this.underruns % 25 === 0) {
          logger.warn(
            { callId: this.config.callId, underruns: this.underruns, framesSent: this.framesSent },
            "Gemini Live: outbound audio underrun — concealing with last frame",
          );
        }
        return;
      }
      this.stopPump();
      return;
    }
    const elapsedMs = Date.now() - this.pumpAnchorMs + GeminiLivePipeline.LEAD_MS;
    while (
      this.outFrames8k.length > 0 &&
      this.framesSent * GeminiLivePipeline.FRAME_MS < elapsedMs
    ) {
      const pcm8k = this.outFrames8k.shift()!;
      this.framesSent++;
      // Anchor the echo grace to the moment a speech burst becomes audible.
      if (!this.isPlayingOut) this.agentAudioStartedAt = Date.now();
      this.isPlayingOut = true;
      this.lastRealFrameAt = Date.now();
      if (!this.firstFrameLogged) {
        this.firstFrameLogged = true;
        const bootMs = this.lastRealFrameAt - this.startedAtMs;
        logger.info(
          { callId: this.config.callId, bootMs },
          "Gemini Live: first agent audio on the wire",
        );
        createExecutionLogger(this.config.callId, null)(EXEC_COMPONENTS.TTS, "system", {
          provider: "gemini_live",
          status: "info",
          latencyMs: bootMs,
          metadata: {
            event: "First Agent Audio",
            bootMs,
          },
        });
      }
      this.lastOutPcm8k = pcm8k;
      this.recording.addAgentChunk(pcm8k); // record at playback time, not arrival time
      const out = this.config.rawPcmOutput
        ? (this.pcmOutRate() === 16000 ? upsample8to16(pcm8k) : pcm8k)
        : encodeMulaw(pcm8k);
      this.config.onAudioOut(out);
    }
  }

  private async handleToolCalls(calls: FunctionCall[]): Promise<void> {
    if (!this.session) return;
    const responses = [];
    for (const call of calls) {
      const name = call.name ?? "";
      const args = (call.args ?? {}) as Record<string, unknown>;
      const result = await runLiveToolCall(
        {
          config: this.config,
          agent: this.agent,
          onAgentText: (text) => this.appendAgent(text),
          speakText: (text) => this.speakRaw(text),
          endCall: () => {
            this.endReasonHint = "end_call";
            this.config.onCallEnd();
          },
          genuineUserTurns: () =>
            this.history.filter((m) => m.role === "user" && m.content.trim().length > 0).length,
        },
        name,
        args,
      );
      responses.push({
        id: call.id,
        name,
        response: result,
      });
      this.config.onConversationUpdate?.(this.getHistory());
    }
    this.session.sendToolResponse({ functionResponses: responses });
  }

  private appendUser(text: string): void {
    this.lastUserText = text;
    const last = this.history[this.history.length - 1];
    if (last?.role === "user") {
      last.content = `${last.content} ${text}`.trim();
    } else {
      this.history.push({ role: "user", content: text });
    }
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
  }

  private async tryResumeAfterDisconnect(reason: string): Promise<void> {
    if (this.closed || this.reconnecting) return;
    if (!this.resumptionHandle || this.reconnectAttempts >= GeminiLivePipeline.MAX_LIVE_RECONNECTS) {
      logger.info(
        { callId: this.config.callId, reason, hasHandle: Boolean(this.resumptionHandle), attempts: this.reconnectAttempts },
        "Gemini Live: no resumable session — ending call",
      );
      this.config.onCallEnd();
      return;
    }
    this.reconnecting = true;
    this.reconnectAttempts += 1;
    const attempt = this.reconnectAttempts;
    try {
      this.session = null;
      this.connectPromise = null;
      await this.ensureConnected();
      logger.info(
        { callId: this.config.callId, reason, attempt },
        "Gemini Live session resumed",
      );
    } catch (err) {
      logger.error({ callId: this.config.callId, reason, attempt, err }, "Gemini Live resume failed");
      this.config.onCallEnd();
    } finally {
      this.reconnecting = false;
    }
  }

  private handleFatal(err: unknown): void {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error({ callId: this.config.callId, reason }, "Gemini Live fatal error");
    this.config.onFatalError?.(reason);
  }
}

/** Strip TTS prosody markup so Live transcripts stay human-readable. */
function stripLiveMarkup(text: string): string {
  return text
    .replace(/<\/?emotion\b[^>]*>/gi, "")
    .replace(/<break\b[^>]*\/?>/gi, "")
    .replace(/[^\S\r\n]{2,}/g, " ")
    .trim();
}
