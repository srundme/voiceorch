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
  decodeMulaw,
  downsample24to8,
  encodeMulaw,
  upsample8to16,
} from "../../audio.js";
import { logger } from "../../../lib/logger.js";
import { buildToolDefs } from "../../../services/tool-executor.js";
import {
  DEFAULT_GEMINI_LIVE_MODEL,
  resolveGeminiLiveThinkingLevel,
  resolveGeminiLiveVoice,
} from "./gemini-live-voices.js";
import { toGeminiLiveTools } from "./gemini-tools.js";
import { runLiveToolCall } from "./live-tool-runner.js";

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

export class GeminiLivePipeline implements VoiceSession {
  public endReasonHint: string | null = null;

  private readonly config: SessionConfig;
  private readonly agent: AgentConfig;
  private readonly apiKey: string;
  private readonly recording: RecordingBuffer;
  private readonly history: ConversationTurn[] = [];
  private lastUserText: string | null = null;
  private lastAgentText: string | null = null;

  private session: Session | null = null;
  private connectPromise: Promise<void> | null = null;
  private closed = false;
  private greetingSent = false;
  private pendingOut24k = Buffer.alloc(0);
  private isPlayingOut = false;

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

  // Serialize server-message handling: tool calls await inside the handler, and
  // firing handlers unordered lets late audio/transcripts overtake an
  // interruption (stale-answer symptom).
  private msgChain: Promise<void> = Promise.resolve();
  constructor(config: SessionConfig) {
    this.config = config;
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
  }

  onAudioIn(mulawChunk: Buffer): void {
    this.onRawPcm8kIn(decodeMulaw(mulawChunk));
  }


  onRawPcm8kIn(pcm8k: Buffer, _noiseCancel?: boolean, nativePcm16k?: Buffer): void {
    if (this.closed || pcm8k.length < 2) return;
    this.recording.addCallerChunk(pcm8k);
    this.config.callerAudioTap?.(pcm8k);

    const pcm16k = nativePcm16k?.length ? nativePcm16k : upsample8to16(pcm8k);
    void this.ensureConnected().then(() => {
      if (this.closed || !this.session) return;
      this.session.sendRealtimeInput({
        audio: {
          data: pcm16k.toString("base64"),
          mimeType: "audio/pcm;rate=16000",
        },
      });
    }).catch((err) => this.handleFatal(err));
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

    this.session?.sendClientContent({
      turns: [{ role: "user", parts: [{ text: prompt }] }],
      turnComplete: true,
    });
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
    this.session?.sendClientContent({
      turns: [{ role: "user", parts: [{ text: `Speak exactly the following to the caller: "${text}"` }] }],
      turnComplete: true,
    });
  }

  getTranscript(): string {
    return this.history
      .filter((t) => t.content.trim() !== "")
      .map((t) => `${t.role === "user" ? "Caller" : "Agent"}: ${t.content}`)
      .join("\n");
  }

  getHistory(): ConversationTurn[] {
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

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.stopPump();
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
    const model = liveCfg?.model ?? DEFAULT_GEMINI_LIVE_MODEL;
    const voiceName = resolveGeminiLiveVoice(liveCfg?.voiceName);
    const thinkingLevel = resolveGeminiLiveThinkingLevel(liveCfg?.thinkingLevel);

    const toolDefs = buildToolDefs(this.agent.tools);
    toolDefs.push(SCHEDULE_CALLBACK_TOOL);
    const tools = toGeminiLiveTools(toolDefs);

    const thinkingMap: Record<string, ThinkingLevel> = {
      minimal: ThinkingLevel.MINIMAL,
      low: ThinkingLevel.LOW,
      medium: ThinkingLevel.MEDIUM,
      high: ThinkingLevel.HIGH,
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
          this.handleFatal(e.error ?? e);
        },
        onclose: () => {
          if (!this.closed) {
            logger.info({ callId: this.config.callId }, "Gemini Live socket closed");
            this.config.onCallEnd();
          }
        },
      },
    });

    logger.info({ callId: this.config.callId, model, voiceName }, "Gemini Live session connected");
  }

  private async onServerMessage(msg: LiveServerMessage): Promise<void> {
    if (this.closed) return;

    const content = msg.serverContent;
    if (content?.inputTranscription?.text) {
      const text = content.inputTranscription.text.trim();
      if (text) {
        this.appendUser(text);
        this.config.onTranscript("user", text);
      }
    }

    if (content?.outputTranscription?.text) {
      const text = content.outputTranscription.text.trim();
      if (text) {
        this.appendAgent(text);
        this.config.onTranscript("agent", text);
      }
    }

    const inlineAudio = msg.data;
    if (inlineAudio) {
      const pcm24k = Buffer.from(inlineAudio, "base64");
      this.pendingOut24k = Buffer.concat([this.pendingOut24k, pcm24k]);
      this.flushOutboundAudio();
    }

    if (msg.toolCall?.functionCalls?.length) {
      await this.handleToolCalls(msg.toolCall.functionCalls);
    }

    if (content?.turnComplete) {
      this.isPlayingOut = false;
    }
  }

  /** Runs synchronously from onmessage — must never await (see onmessage note). */
  private handleInterrupted(): void {
    if (this.closed) return;
    const droppedMs = this.outFrames8k.length * GeminiLivePipeline.FRAME_MS;
    this.pendingOut24k = Buffer.alloc(0);
    this.outFrames8k.length = 0; // drop locally queued (unplayed) audio immediately
    this.isPlayingOut = false;
    this.config.onBargeIn?.();
    logger.info({ callId: this.config.callId, droppedMs }, "Gemini Live: interrupted — cleared queued audio");
  }

  private flushOutboundAudio(): void {
    // Slice into ~20ms frames at 24kHz (480 samples = 960 bytes) and queue them
    // for the paced pump — never forward faster than real time (see pump docs).
    const FRAME_BYTES_24K = 960;
    while (this.pendingOut24k.length >= FRAME_BYTES_24K) {
      const frame24k = this.pendingOut24k.subarray(0, FRAME_BYTES_24K);
      this.pendingOut24k = this.pendingOut24k.subarray(FRAME_BYTES_24K);
      this.outFrames8k.push(downsample24to8(frame24k));
    }
    if (this.outFrames8k.length) this.ensurePump();
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
      // Drained — stop; a fresh anchor starts with the next reply's audio.
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
      this.isPlayingOut = true;
      this.recording.addAgentChunk(pcm8k); // record at playback time, not arrival time
      const out = this.config.rawPcmOutput ? pcm8k : encodeMulaw(pcm8k);
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
    this.lastAgentText = text;
    const last = this.history[this.history.length - 1];
    if (last?.role === "assistant") {
      last.content = `${last.content} ${text}`.trim();
    } else {
      this.history.push({ role: "assistant", content: text });
    }
  }

  private handleFatal(err: unknown): void {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error({ callId: this.config.callId, reason }, "Gemini Live fatal error");
    this.config.onFatalError?.(reason);
  }
}
