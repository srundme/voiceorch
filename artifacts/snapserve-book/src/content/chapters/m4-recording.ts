import type { Chapter } from "../types";

export const callRecording: Chapter = {
  slug: "call-recording",
  moduleId: "m4",
  number: "5.9",
  title: "Call Recording",
  summary:
    "How SnapServe taps both audio streams during a live call and produces a stereo WAV stored as PostgreSQL bytea.",
  estMinutes: 16,
  fileRef: "artifacts/api-server/src/orchestration/recorder.ts",
  prerequisites: ["audio-ts", "session-and-pipeline"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "Call recording is the digital equivalent of a cassette tape on a telephone junction box — it captures both sides of the conversation for later review, training, compliance, or dispute resolution. SnapServe records at the **application layer**, not the telephony layer. That means recordings capture exactly what the pipeline processed, not what the phone carrier sent.",
        "This distinction matters. Telephony-layer recordings (Twilio call recordings, for example) capture the raw phone audio including network artefacts. Application-layer recordings capture the audio after the pipeline has decoded, decoded μ-law, applied noise cancellation, and mixed the two channels. You get a clean, predictable file.",
        "Recording is opt-in per agent (`agentConfig.recordingEnabled`). When enabled, the pipeline creates a `RecordingBuffer` at construction time and continuously feeds both streams into it during the call. At call-end, `session.ts` calls `getRecording().finalize()` to produce the WAV file.",
      ],
    },
    {
      kind: "concept",
      title: "Stereo WAV: two channels, one file",
      body: [
        "A stereo WAV file has two channels: **left** and **right**. SnapServe assigns `caller = left` and `agent = right`. This convention lets downstream tools (transcription services, quality assurance software) separate the two speakers by channel without needing diarisation — you already know who's on which side.",
        "Both channels are 8 kHz, 16-bit PCM (the decoded form of μ-law). 8 kHz is the standard telephone audio sample rate — 8,000 samples per second, each 16 bits (2 bytes), so a one-minute call produces 8,000 × 2 × 2 channels × 60 seconds = **1.92 MB** of uncompressed audio.",
        "The WAV header is 44 bytes and describes the format. The `RecordingBuffer` builds the header at `finalize()` time, after it knows the total data length, and prepends it to the interleaved channel data.",
      ],
    },
    {
      kind: "code",
      filename: "orchestration/recorder.ts",
      language: "typescript",
      intro:
        "The `RecordingBuffer` maintains two PCM buffers — one per channel — and grows them with every audio chunk the pipeline produces.",
      code: `export class RecordingBuffer {
  private callerChunks: Buffer[] = [];
  private agentChunks:  Buffer[] = [];
  private sampleRate: number;

  constructor(sampleRate = 8000) {
    this.sampleRate = sampleRate;
  }

  addCallerChunk(pcm: Buffer): void {
    this.callerChunks.push(pcm);
  }

  addAgentChunk(pcm: Buffer): void {
    this.agentChunks.push(pcm);
  }

  finalize(callId: number): Promise<{ url: string | null; error: string | null }> {
    const caller = Buffer.concat(this.callerChunks);
    const agent  = Buffer.concat(this.agentChunks);
    // Pad the shorter channel to match the longer one
    const len = Math.max(caller.length, agent.length);
    const callerPadded = Buffer.concat([caller, Buffer.alloc(len - caller.length)]);
    const agentPadded  = Buffer.concat([agent,  Buffer.alloc(len - agent.length)]);
    const wav = buildStereoWav(callerPadded, agentPadded, this.sampleRate);
    return saveRecording(callId, wav);
  }
}`,
      lines: [
        {
          lines: "2-3",
          label: "callerChunks / agentChunks",
          explanation:
            "Two separate arrays of `Buffer` objects, one per channel. During a 2-minute call at 8 kHz, each array might hold thousands of 160-sample (20ms) chunks — the standard RTP packet size. Storing them as arrays and concatenating at the end avoids repeated memory allocations during the call.",
        },
        {
          lines: "20-26",
          label: "padding the shorter channel",
          explanation:
            "The caller and agent don't always speak for the same duration — the agent's TTS might finish before the call ends, leaving `agentChunks` shorter than `callerChunks`. Interleaving two channels of different lengths produces an invalid WAV. The shorter channel is zero-padded (silence) to match the longer one.",
        },
        {
          lines: "27",
          label: "buildStereoWav",
          explanation:
            "Interleaves the two padded channels sample-by-sample (LRLRLR…), prepends the 44-byte WAV header, and returns a `Buffer` ready to write. The header includes sample rate, channel count, bit depth, and total data length.",
        },
      ],
    },
    {
      kind: "prose",
      heading: "Where does the audio come from?",
      paragraphs: [
        "The pipeline feeds the recording buffer from two distinct points in its audio pipeline:",
        "**Caller audio**: added in `addCallerFrame()`, which is called for every decoded μ-law frame that arrives from the telephony WebSocket. This is the caller's voice, decoded and ready.",
        "**Agent audio**: added in the TTS playback loop. Every 160-sample PCM chunk that the TTS adapter emits is fed to the recording buffer before being encoded back to μ-law and sent to the phone line. This means the recording captures exactly what the caller heard — including pauses, barge-in interruptions, and TTS artefacts.",
        "Crucially, **ambient noise is NOT recorded**. The ambient noise layer (background cafe sounds, etc.) is mixed only into the outbound phone line copy, never into the recording buffer. The recording stays clean.",
      ],
    },
    {
      kind: "code",
      filename: "orchestration/pipeline.ts",
      language: "typescript",
      intro: "The two recording tap-points inside the pipeline. Both feed the same `RecordingBuffer` object.",
      code: `// Caller audio tap (in addCallerFrame)
this.recording.addCallerChunk(pcm8k);

// Agent audio tap (in the TTS playback loop)
// Recording stays clean — ambient is mixed only into the outbound copy
this.recording.addAgentChunk(pcm8k);`,
      lines: [
        {
          lines: "2",
          label: "caller tap",
          explanation:
            "Called every time a decoded audio frame arrives from the telephony WebSocket. `pcm8k` is the 8 kHz PCM buffer produced by decoding the μ-law bytes from the provider.",
        },
        {
          lines: "5-6",
          label: "agent tap",
          explanation:
            "Called inside the TTS chunk loop, after TTS produces PCM and before re-encoding to μ-law for the phone line. The comment is key: ambient noise is mixed into the *outbound* copy that goes to the phone, but not into `pcm8k` here. So the recording captures dry TTS audio only.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "insight",
      title: "Where recordings are stored",
      body: [
        "Recordings are stored as **PostgreSQL `bytea`** — raw binary data in the `calls` table. This is unconventional; most systems store large binary files in object storage (S3, GCS). SnapServe uses `bytea` for simplicity and to keep the deployment stateless (no separate bucket to configure). At 1.92 MB/minute, a 5-minute call is ~10 MB — large but workable for Postgres.",
        "In a production system handling hundreds of simultaneous calls, you'd want to move to object storage. The `saveRecording` function is the single place to change.",
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "Why does SnapServe record at the application layer rather than using the telephony provider's recording feature?",
          choices: [
            "Application-layer recording is cheaper than Twilio/Plivo recording",
            "It captures post-processed audio and works the same way across all telephony providers",
            "Telephony providers don't support recording",
            "It allows recording to be stored in the browser",
          ],
          correctIndex: 1,
          explanation:
            "Application-layer recording is provider-agnostic (works with Twilio, Plivo, VoBiz, or webcall equally) and captures the audio the pipeline actually processed — after decoding, noise cancellation, and mixing — rather than raw phone-carrier audio.",
        },
        {
          prompt: "In the stereo WAV file, which channel is the agent and which is the caller?",
          choices: [
            "Left = agent, Right = caller",
            "Left = caller, Right = agent",
            "Both channels contain the mixed conversation",
            "The assignment depends on which side spoke first",
          ],
          correctIndex: 1,
          explanation:
            "By convention, caller = left channel, agent = right channel. This lets downstream tools separate speakers by channel without diarisation.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Recording is opt-in (`agentConfig.recordingEnabled`); `RecordingBuffer` is created at pipeline construction",
        "Two tap points: caller audio in `addCallerFrame`, agent audio in the TTS playback loop",
        "Ambient noise is intentionally excluded from the recording (only mixed into the phone line)",
        "At finalize time, both channels are padded to equal length, interleaved, and prefixed with a WAV header",
        "Recordings are stored as PostgreSQL `bytea` — unconventional but keeps deployment stateless",
      ],
    },
  ],
};
