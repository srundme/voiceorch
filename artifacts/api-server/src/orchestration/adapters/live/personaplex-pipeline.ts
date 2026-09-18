/**
 * PersonaPlex live pipeline — SnapServe 8 kHz PCM ↔ GPU pcm_bridge.
 *
 * The GPU sidecar talks NVIDIA moshi.server (OGG Opus 24 kHz on /api/chat).
 * This Node process never encodes Opus: it sends/receives s16le PCM @ 8 kHz.
 */

import { WebSocket } from "ws";
import type { AgentConfig, ConversationTurn, SessionConfig } from "../../types.js";
import type { VoiceSession } from "../../voice-session.js";
import type { StreamSTT } from "../../types.js";
import { RecordingBuffer, WEBCALL_GAP_RESYNC_MS } from "../../recorder.js";
import { decodeMulaw, encodeMulaw, frameRms, upsample8to16 } from "../../audio.js";
import { logger } from "../../../lib/logger.js";
import { createLLMAdapter } from "../llm/index.js";
import { createSTTAdapter } from "../stt/index.js";
import { resolveSarvamSttMode } from "../stt/sarvam-mode.js";
import { PersonaplexIntakePersist } from "./personaplex-intake-persist.js";
import {
  buildPersonaplexTextPrompt,
  personaplexWsUrlFromEnv,
  resolvePersonaplexVoice,
} from "./personaplex-voices.js";

const FRAME_MS = 20;
const FRAME_SAMPLES_8K = 160;
const FRAME_BYTES_8K = FRAME_SAMPLES_8K * 2;
const PREBUFFER_FRAMES = 1;
const PUMP_LEAD_MS = 80;
const KEEPALIVE_FILL_GAP_MS = 500;
/** Caller-frame RMS that counts as speech for T0 (barge-in / turn start). */
const SPEECH_RMS = 400;

/** JSON control is never PCM. Telephony frames are 320-byte s16le even if a proxy marks them as text. */
export function isPersonaplexPcmFrame(isBinary: boolean | undefined, buf?: Buffer): boolean {
  if (buf && buf.length > 0 && (buf[0] === 0x7b || buf[0] === 0x5b)) {
    try {
      const parsed = JSON.parse(buf.toString("utf8")) as { type?: unknown };
      if (parsed && typeof parsed === "object" && "type" in parsed) return false;
    } catch {
      /* not JSON */
    }
  }
  if (buf && buf.length >= FRAME_BYTES_8K && buf.length % 2 === 0) return true;
  if (isBinary === true) return true;
  if (isBinary === false) return false;
  return !!buf && buf.length >= 2 && buf.length % 2 === 0;
}

export class PersonaPlexPipeline implements VoiceSession {
  public endReasonHint: string | null = null;

  private readonly config: SessionConfig;
  private readonly agent: AgentConfig;
  private readonly recording: RecordingBuffer;
  private readonly wsUrl: string;
  private readonly voice: string;
  private readonly textPrompt: string;

  private ws: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private closed = false;
  private ready = false;
  private greetingSent = false;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private lastRealFrameAt = 0;
  private outPending = Buffer.alloc(0);
  private outFrames: Buffer[] = [];
  private pumpTimer: ReturnType<typeof setInterval> | null = null;
  private pumpAnchorMs = 0;
  private framesSent = 0;
  private lastGpuSendAt = 0;
  private pendingIn: Buffer[] = [];
  private readonly startedAtMs = Date.now();
  private helloSentAt = 0;
  private readyAt = 0;
  private firstGpuPcmAt = 0;
  private firstWireAt = 0;
  private firstAudioLogged = false;
  private handshakeLogged = false;
  private t0CallerSpeechAt = 0;
  private t1GpuSendAt = 0;
  private awaitingTurnReply = false;
  private lastGpuPcmAt = 0;
  private history: ConversationTurn[] = [];
  private lastUserText: string | null = null;
  private lastAgentText: string | null = null;
  private agentTextBuf = "";
  private lastMediaAtMs: number | null = null;
  private intakePersist: PersonaplexIntakePersist | null = null;
  private callerStt: StreamSTT | null = null;

  constructor(config: SessionConfig) {
    this.config = config;
    this.agent = config.agentConfig;
    const url = (this.agent.personaplex?.wsUrl ?? personaplexWsUrlFromEnv() ?? "").trim();
    if (!url) {
      throw new Error("PersonaPlex requires PERSONAPLEX_WS_URL (GPU pcm_bridge)");
    }
    this.wsUrl = url;
    this.voice = resolvePersonaplexVoice(this.agent.personaplex?.voiceName);
    this.textPrompt = buildPersonaplexTextPrompt({
      agentName: this.agent.name,
      systemPrompt: this.agent.systemPrompt,
      greeting: this.agent.greetingMessage,
      isIntake: this.agent.personaplex?.isIntake === true,
    });
    this.recording = new RecordingBuffer(
      8000,
      config.telephonyProvider === "webcall" ? WEBCALL_GAP_RESYNC_MS : undefined,
    );
    if (config.answeredAt) this.recording.anchorStart(config.answeredAt);
    this.startKeepalive();
    this.startIntakeSidecar();
    void this.ensureConnected().catch((err) => {
      logger.warn({ callId: config.callId, err }, "PersonaPlex GPU connect at session start failed — will retry on audio");
    });
    logger.info(
      {
        callId: config.callId,
        agentId: this.agent.id,
        voice: this.voice,
        wsHost: safeWsHost(this.wsUrl),
        promptChars: this.textPrompt.length,
      },
      "PersonaPlex pipeline ready",
    );
  }

  private pcmOutRate(): number {
    return this.config.rawPcmOutput ? (this.config.rawPcmOutputRate ?? 8000) : 8000;
  }

  private startKeepalive(): void {
    const isVobiz = this.config.telephonyProvider === "vobiz";
    const silenceFrame = Buffer.alloc(
      this.config.rawPcmOutput
        ? (this.pcmOutRate() / 1000) * FRAME_MS * 2
        : FRAME_MS * 8,
      0,
    );
    const gpuSilence = Buffer.alloc(FRAME_BYTES_8K);
    const timer = setInterval(() => {
      if (this.closed) return;
      if (this.ready && this.ws && this.ws.readyState === WebSocket.OPEN) {
        if (Date.now() - this.lastGpuSendAt >= FRAME_MS) {
          this.ws.send(gpuSilence);
          this.lastGpuSendAt = Date.now();
        }
      }
      if (this.pumpTimer || this.outFrames.length > 0) return;
      // Before first agent audio, VoBiz early-ambient owns the wire. Zeros here
      // call stopSilence() and can fill playAudio until VoBiz closes the socket
      // (call felt like 20s+ dead air while Moshi had already spoken).
      if (this.lastRealFrameAt === 0) return;
      if (Date.now() - this.lastRealFrameAt < KEEPALIVE_FILL_GAP_MS) return;
      if (isVobiz || this.config.rawPcmOutput) this.config.onAudioOut(silenceFrame);
    }, FRAME_MS);
    (timer as unknown as { unref?: () => void }).unref?.();
    this.keepaliveTimer = timer;
  }

  /**
   * NVIDIA never calls save_candidate_details. Intake form fill is this sidecar:
   * silent caller STT → persist LLM → executeIntakeWrite, off the spoken path.
   */
  private startIntakeSidecar(): void {
    if (this.agent.personaplex?.isIntake !== true) return;
    const preferred = (this.agent.llmProvider || "").toLowerCase();
    const llmProvider = this.config.providerKeys.get(preferred)
      ? preferred
      : this.config.providerKeys.has("groq")
        ? "groq"
        : "sarvam";
    const llmKey = this.config.providerKeys.get(llmProvider) ?? "";
    if (!llmKey) {
      logger.warn({ callId: this.config.callId }, "PersonaPlex intake persist skipped — no LLM key");
      return;
    }
    const llm = createLLMAdapter(
      llmProvider,
      llmKey,
      this.agent.llmModel,
      undefined,
      this.agent.llmGenerationParams,
      this.config.callId,
    );
    this.intakePersist = new PersonaplexIntakePersist({
      llm,
      ctx: {
        callId: this.config.callId,
        agentId: this.agent.id,
        callerPhone: this.config.callerPhone,
      },
      systemPrompt: this.agent.systemPrompt,
      history: () => this.getHistory(),
      lastAgentText: () => this.lastAgentText,
    });
    this.startCallerSttTap();
  }

  private startCallerSttTap(): void {
    const provider = (this.agent.asrProvider || "sarvam").toLowerCase();
    const sttKey = this.config.providerKeys.get(provider) ?? this.config.providerKeys.get("sarvam") ?? "";
    if (!sttKey || !this.agent.sttConfig) {
      logger.warn({ callId: this.config.callId }, "PersonaPlex caller STT tap skipped — no STT key; persist will only see agent text");
      return;
    }
    const lang = this.agent.sttConfig.language || this.agent.language || "en-IN";
    const extra = provider === "sarvam"
      ? JSON.stringify({
          mode: resolveSarvamSttMode(lang, this.agent.sarvamSttMode),
          highVadSensitivity: this.agent.sarvamHighVadSensitivity,
          streamType: this.agent.sarvamSttStreamType,
          prompt: this.agent.sarvamSttPrompt,
        })
      : null;
    try {
      const adapter = createSTTAdapter(provider, sttKey, this.agent.asrModel, extra, this.agent.sttConfig);
      if (!adapter.transcribeStream) return;
      this.callerStt = adapter.transcribeStream((text, isFinal) => {
        if (this.closed || !isFinal) return;
        const spoken = text.replace(/\s+/g, " ").trim();
        if (!spoken) return;
        this.appendTranscript("user", spoken);
        this.intakePersist?.noteUserTurn(spoken);
      });
      logger.info({ callId: this.config.callId, provider }, "PersonaPlex caller STT tap for form fill");
    } catch (err) {
      logger.warn({ callId: this.config.callId, err }, "PersonaPlex caller STT tap failed to start");
    }
  }

  onAudioIn(mulawChunk: Buffer): void {
    this.onRawPcm8kIn(decodeMulaw(mulawChunk));
  }

  onRawPcm8kIn(pcm8k: Buffer, _noiseCancel?: boolean, _nativePcm16k?: Buffer): void {
    if (this.closed || pcm8k.length < 2) return;
    this.recording.addCallerChunk(pcm8k);
    this.config.callerAudioTap?.(pcm8k);
    this.lastMediaAtMs = Date.now();

    try {
      this.callerStt?.sendAudio(upsample8to16(pcm8k));
    } catch { /* STT tap must never break the spoken path */ }

    const now = Date.now();
    if (frameRms(pcm8k) >= SPEECH_RMS && !this.awaitingTurnReply) {
      this.t0CallerSpeechAt = now;
      this.t1GpuSendAt = 0;
      this.awaitingTurnReply = true;
    }

    if (!this.ready || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      if (this.pendingIn.length < 50) this.pendingIn.push(Buffer.from(pcm8k));
      void this.ensureConnected();
      return;
    }
    // Full-duplex S2S: never replace the caller with zeros. PSTN echo mute
    // on call 25573 blocked barge-in so Moshi kept inventing jobs.
    this.ws.send(pcm8k);
    this.lastGpuSendAt = now;
    if (this.awaitingTurnReply && this.t0CallerSpeechAt && !this.t1GpuSendAt) {
      this.t1GpuSendAt = now;
    }
  }

  async greet(): Promise<void> {
    if (this.closed || this.greetingSent) return;
    await this.ensureConnected();
    this.greetingSent = true;
    if (this.agent.firstSpeaker === "user") {
      logger.info({ callId: this.config.callId }, "PersonaPlex: first speaker = user");
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.closed) return;
    if (this.ready && this.ws && this.ws.readyState === WebSocket.OPEN) return;
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = this.connectOnce().finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }

  private connectOnce(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;
      let settled = false;

      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        reject(err);
      };

      ws.on("open", () => {
        this.helloSentAt = Date.now();
        ws.send(JSON.stringify({
          type: "hello",
          voice: this.voice,
          textPrompt: this.textPrompt,
          sampleRate: 8000,
        }));
      });

      ws.on("message", (data, isBinary) => {
        if (this.closed) return;
        const buf = toBuffer(data);
        if (!isPersonaplexPcmFrame(isBinary, buf)) {
          this.onControl(buf.toString("utf8"), () => {
            if (!settled) {
              settled = true;
              resolve();
            }
          });
          return;
        }
        // Ready can also be implied by the first audio if the bridge skipped JSON.
        if (!this.ready) {
          this.ready = true;
          this.readyAt = Date.now();
          this.flushPendingIn();
          this.logHandshakeIfReady();
          if (!settled) {
            settled = true;
            resolve();
          }
        }
        this.enqueueAgentPcm8k(buf);
      });

      ws.on("error", (err) => {
        logger.error({ callId: this.config.callId, err }, "PersonaPlex websocket error");
        fail(err instanceof Error ? err : new Error(String(err)));
      });

      ws.on("close", (code, reason) => {
        this.ready = false;
        this.ws = null;
        if (this.closed) return;
        const msg = `PersonaPlex GPU closed (${code} ${reason.toString() || ""})`.trim();
        logger.warn({ callId: this.config.callId, code }, msg);
        if (!settled) fail(new Error(msg));
        else this.config.onFatalError?.(msg);
      });
    });
  }

  private onControl(raw: string, onReady: () => void): void {
    let msg: { type?: string; text?: string; role?: string; error?: string };
    try {
      msg = JSON.parse(raw) as typeof msg;
    } catch {
      return;
    }
    if (msg.type === "ready") {
      this.ready = true;
      this.readyAt = Date.now();
      this.flushPendingIn();
      this.logHandshakeIfReady();
      onReady();
      return;
    }
    if (msg.type === "error") {
      const reason = msg.error || "PersonaPlex GPU error";
      logger.error({ callId: this.config.callId, reason }, "PersonaPlex GPU error");
      this.config.onFatalError?.(reason);
      return;
    }
    if (msg.type === "text" && msg.text) {
      const role = msg.role === "user" ? "user" : "assistant";
      this.appendTranscript(role, msg.text);
    }
  }

  private flushPendingIn(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    for (const chunk of this.pendingIn) {
      this.ws.send(chunk);
      this.lastGpuSendAt = Date.now();
    }
    this.pendingIn = [];
  }

  private logHandshakeIfReady(): void {
    if (this.handshakeLogged || !this.helloSentAt || !this.readyAt) return;
    this.handshakeLogged = true;
    logger.info(
      {
        evt: "personaplex_handshake",
        callId: this.config.callId,
        helloToReadyMs: this.readyAt - this.helloSentAt,
        bootToReadyMs: this.readyAt - this.startedAtMs,
        promptChars: this.textPrompt.length,
      },
      "PersonaPlex: Moshi handshake (prompt bake)",
    );
  }

  private enqueueAgentPcm8k(pcm8k: Buffer): void {
    if (pcm8k.length < 2) return;
    if (!this.firstGpuPcmAt) {
      this.firstGpuPcmAt = Date.now();
      logger.info(
        {
          evt: "personaplex_latency",
          stage: "T2_first_gpu_pcm",
          callId: this.config.callId,
          readyToFirstPcmMs: this.readyAt ? this.firstGpuPcmAt - this.readyAt : null,
          helloToFirstPcmMs: this.helloSentAt ? this.firstGpuPcmAt - this.helloSentAt : null,
        },
        "PersonaPlex: first model audio (T2)",
      );
    }
    if (this.awaitingTurnReply && this.t0CallerSpeechAt) {
      const now = Date.now();
      const greetingWindow = this.readyAt > 0 && now - this.readyAt < 800;
      const agentGapMs = this.lastGpuPcmAt ? now - this.lastGpuPcmAt : 9999;
      if (!greetingWindow && agentGapMs > 200) {
        logger.info(
          {
            evt: "personaplex_latency",
            stage: "turn",
            callId: this.config.callId,
            t1MinusT0Ms: this.t1GpuSendAt ? this.t1GpuSendAt - this.t0CallerSpeechAt : null,
            t2MinusT1Ms: this.t1GpuSendAt ? now - this.t1GpuSendAt : now - this.t0CallerSpeechAt,
            t2MinusT0Ms: now - this.t0CallerSpeechAt,
            agentGapMs,
          },
          "PersonaPlex: turn first-audio (T2-T0)",
        );
        this.awaitingTurnReply = false;
        this.t0CallerSpeechAt = 0;
        this.t1GpuSendAt = 0;
      }
    }
    this.lastGpuPcmAt = Date.now();
    const aligned = pcm8k.length % 2 === 0 ? pcm8k : pcm8k.subarray(0, pcm8k.length - 1);
    this.outPending = this.outPending.length ? Buffer.concat([this.outPending, aligned]) : aligned;
    while (this.outPending.length >= FRAME_BYTES_8K) {
      this.outFrames.push(this.outPending.subarray(0, FRAME_BYTES_8K));
      this.outPending = this.outPending.subarray(FRAME_BYTES_8K);
    }
    if (this.pumpTimer || this.outFrames.length >= PREBUFFER_FRAMES) this.ensurePump();
  }

  private ensurePump(): void {
    if (this.pumpTimer) return;
    this.pumpAnchorMs = Date.now();
    this.framesSent = 0;
    this.pumpTimer = setInterval(() => this.pumpTick(), 10);
    (this.pumpTimer as unknown as { unref?: () => void }).unref?.();
  }

  private stopPump(): void {
    if (this.pumpTimer) {
      clearInterval(this.pumpTimer);
      this.pumpTimer = null;
    }
  }

  private pumpTick(): void {
    if (this.closed) {
      this.stopPump();
      return;
    }
    if (this.outFrames.length === 0) {
      this.stopPump();
      return;
    }
    const elapsedMs = Date.now() - this.pumpAnchorMs + PUMP_LEAD_MS;
    while (this.outFrames.length > 0 && this.framesSent * FRAME_MS < elapsedMs) {
      const pcm8k = this.outFrames.shift()!;
      this.framesSent++;
      this.lastRealFrameAt = Date.now();
      this.lastMediaAtMs = Date.now();
      if (!this.firstAudioLogged) {
        this.firstAudioLogged = true;
        this.firstWireAt = Date.now();
        logger.info(
          {
            evt: "personaplex_latency",
            stage: "T4_first_wire",
            callId: this.config.callId,
            bootMs: this.firstWireAt - this.startedAtMs,
            t4MinusT2Ms: this.firstGpuPcmAt ? this.firstWireAt - this.firstGpuPcmAt : null,
          },
          "PersonaPlex: first agent audio on the wire (T4)",
        );
      }
      this.recording.addAgentChunk(pcm8k);
      const out = this.config.rawPcmOutput
        ? (this.pcmOutRate() === 16000 ? upsample8to16(pcm8k) : pcm8k)
        : encodeMulaw(pcm8k);
      this.config.onAudioOut(out);
    }
  }

  private appendTranscript(role: "user" | "assistant", fragment: string): void {
    const text = fragment.replace(/\s+/g, " ").trim();
    if (!text) return;
    if (role === "user") {
      this.lastUserText = this.lastUserText ? `${this.lastUserText} ${text}`.trim() : text;
      const last = this.history[this.history.length - 1];
      if (last?.role === "user") last.content = `${last.content} ${text}`.trim();
      else this.history.push({ role: "user", content: text });
      this.config.onTranscript("user", text);
    } else {
      this.agentTextBuf += text;
      const flushed = flushSentence(this.agentTextBuf);
      if (flushed) {
        this.agentTextBuf = flushed.rest;
        this.lastAgentText = this.lastAgentText
          ? `${this.lastAgentText} ${flushed.sentence}`.trim()
          : flushed.sentence;
        const last = this.history[this.history.length - 1];
        if (last?.role === "assistant") last.content = `${last.content} ${flushed.sentence}`.trim();
        else this.history.push({ role: "assistant", content: flushed.sentence });
        this.config.onTranscript("agent", flushed.sentence);
      }
    }
    this.config.onConversationUpdate?.(this.getHistory());
  }

  async confirmAmdMachineThenBranch(): Promise<void> {
    await this.greet();
  }

  async deliverVoicemail(): Promise<void> {
    await this.speakRaw(
      this.config.voicemailDelivery?.message
        ?? this.config.voicemailPolicy?.message
        ?? "Hello, we tried to reach you. Please call us back at your earliest convenience. Thank you.",
    );
    try { this.config.onVoicemailAction?.(); } catch { /* best-effort */ }
    this.config.onCallEnd();
  }

  async finishSpeakingForMaxDuration(graceMs: number): Promise<void> {
    if (this.closed || graceMs <= 0) return;
    const t0 = Date.now();
    while (Date.now() - t0 < graceMs) {
      if (Date.now() - this.lastRealFrameAt >= 400) return;
      await new Promise((r) => setTimeout(r, 40));
    }
  }

  async speakRaw(text: string): Promise<void> {
    if (this.closed || !text.trim()) return;
    await this.ensureConnected();
    this.appendTranscript("assistant", text);
    this.ws?.send(JSON.stringify({ type: "speak", text: text.trim() }));
  }

  getTranscript(): string {
    this.flushAgentBuf();
    return this.history
      .filter((t) => t.content.trim())
      .map((t) => `${t.role === "user" ? "Caller" : "Agent"}: ${t.content}`)
      .join("\n");
  }

  getHistory(): ConversationTurn[] {
    this.flushAgentBuf();
    return [...this.history];
  }

  getLastTurnTexts(): { lastUser: string | null; lastAgent: string | null } {
    return { lastUser: this.lastUserText, lastAgent: this.lastAgentText };
  }

  getPreferredCallerLang(): string {
    return this.agent.language ?? this.agent.sttConfig?.language ?? "en-IN";
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
    return this.lastMediaAtMs ?? this.recording.getLastWriteAtMs();
  }

  noteMediaDropIfWaitingForReply(): void {}
  onExternalAmdSignal(_verdict: "machine" | "human", _source: string): void {}

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.ready = false;
    this.flushAgentBuf();
    this.stopPump();
    this.outFrames = [];
    this.outPending = Buffer.alloc(0);
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
    try { this.callerStt?.close(); } catch { /* ignore */ }
    this.callerStt = null;
    try { this.ws?.close(); } catch { /* ignore */ }
    this.ws = null;
  }

  private flushAgentBuf(): void {
    const leftover = this.agentTextBuf.trim();
    if (!leftover) return;
    this.agentTextBuf = "";
    this.lastAgentText = this.lastAgentText ? `${this.lastAgentText} ${leftover}`.trim() : leftover;
    const last = this.history[this.history.length - 1];
    if (last?.role === "assistant") last.content = `${last.content} ${leftover}`.trim();
    else this.history.push({ role: "assistant", content: leftover });
  }
}

function toBuffer(data: WebSocket.RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(String(data));
}

function safeWsHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}

function flushSentence(buf: string): { sentence: string; rest: string } | null {
  const m = buf.match(/^([\s\S]*?[.!?])(\s+[\s\S]*)?$/);
  if (!m?.[1] || m[1].trim().length < 8) return null;
  return { sentence: m[1].trim(), rest: (m[2] ?? "").trimStart() };
}
