import type { Chapter } from "../types";

export const genderDetection: Chapter = {
  slug: "gender-detection",
  moduleId: "m12",
  number: "13.1",
  title: "Gender & Voice Analysis",
  summary:
    "The Python microservice that analyses caller audio in real time to detect gender — how it works, why it's a sidecar, and how the pipeline feeds it.",
  estMinutes: 16,
  fileRef: "artifacts/gender-service/main.py",
  prerequisites: ["audio-ts", "session-and-pipeline"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "Why gender detection?",
      paragraphs: [
        "Voice AI agents that can adapt their communication style based on the caller's gender provide a better experience in certain cultural contexts — particularly in India, where formal address terms differ between genders ('sir' vs 'ma'am', or 'bhai' vs 'didi' in Hindi). The gender detector gives the LLM a signal it can use in its system prompt injection.",
        "This capability is entirely optional and agent-configurable. When enabled, the pipeline taps the caller's audio stream, sends chunks to the gender service, and receives a probabilistic estimate (`male: 0.87, female: 0.13`). This is injected into the session context and made available to the LLM as caller metadata.",
        "SnapServe builds this as a **sidecar microservice** in Python, separate from the Node.js API server. The reason: the best audio analysis libraries (librosa, scikit-learn, SpeechBrain) are Python-native. Running Python inside Node.js requires a subprocess bridge that's slower than an HTTP call to a local service.",
      ],
    },
    {
      kind: "concept",
      title: "How gender detection works: MFCCs and classifiers",
      body: [
        "Gender detection from voice is a classic signal processing + machine learning problem. The key audio feature is the **fundamental frequency (F0)** — the pitch of the voice. On average, male voices have F0 in the 85-180 Hz range; female voices in the 165-255 Hz range. There's overlap, which is why it's probabilistic.",
        "The gender service uses **MFCCs (Mel-Frequency Cepstral Coefficients)** — a representation of the short-term power spectrum of audio that compresses the spectral shape into ~20 numbers per 25ms frame. MFCCs are the standard feature for voice analysis tasks (ASR, speaker recognition, gender detection). A trained classifier (logistic regression or a small neural net) maps MFCC statistics to a gender probability.",
        "The service uses **librosa**, a Python library for audio analysis, to extract MFCCs from PCM audio buffers. The classifier is either a pre-trained sklearn model loaded at startup or a fine-tuned model from the `speechbrain` library.",
      ],
    },
    {
      kind: "code",
      filename: "gender-service/main.py",
      language: "python",
      intro:
        "The FastAPI endpoint that receives PCM audio and returns a gender estimate. Librosa is imported lazily to avoid blocking uvicorn's startup.",
      code: `from fastapi import FastAPI
import numpy as np

app = FastAPI()

# Lazy import: top-level librosa import blocks uvicorn port binding
_librosa = None
def get_librosa():
    global _librosa
    if _librosa is None:
        import librosa as _lib
        _librosa = _lib
    return _librosa

@app.post("/analyse")
async def analyse_gender(request: AudioRequest) -> GenderResult:
    lib = get_librosa()

    # Decode PCM bytes to float32 samples [-1.0, 1.0]
    pcm = np.frombuffer(request.audio_bytes, dtype=np.int16).astype(np.float32)
    pcm /= 32768.0

    # Extract MFCCs: 20 coefficients, 25ms frames, 10ms hop
    mfccs = lib.feature.mfcc(
        y=pcm, sr=request.sample_rate,
        n_mfcc=20, n_fft=400, hop_length=160
    )
    features = np.concatenate([mfccs.mean(axis=1), mfccs.std(axis=1)])

    # Classify using the pre-loaded model
    prob = CLASSIFIER.predict_proba(features.reshape(1, -1))[0]
    return GenderResult(male=float(prob[1]), female=float(prob[0]))`,
      lines: [
        {
          lines: "7-12",
          label: "lazy librosa import",
          explanation:
            "librosa's top-level import triggers numpy and scipy initialisation — taking ~2-3 seconds. If this happened at module level, uvicorn would pause during import and the port wouldn't bind in time for Railway's health check. The lazy import defers this cost to the first actual request, after the server is already listening.",
        },
        {
          lines: "20-22",
          label: "int16 → float32 normalisation",
          explanation:
            "PCM audio from the pipeline is 16-bit signed integers (`int16`). librosa expects normalised float32 in the range [-1.0, 1.0]. Dividing by 32768 (2^15) converts the range. This is a standard PCM normalisation.",
        },
        {
          lines: "24-27",
          label: "MFCC extraction",
          explanation:
            "`n_mfcc=20` extracts 20 coefficients (standard for speech tasks). `n_fft=400` = 25ms frames at 16 kHz. `hop_length=160` = 10ms step. The result is a `(20, frames)` matrix. Taking `mean` and `std` across frames reduces this to a 40-feature vector — one compact audio fingerprint.",
        },
        {
          lines: "29-31",
          label: "classifier predict_proba",
          explanation:
            "`CLASSIFIER` is a pre-loaded sklearn model (loaded at startup). `predict_proba` returns a probability vector — `[female_prob, male_prob]`. These are the confidence scores returned to the pipeline.",
        },
      ],
    },
    {
      kind: "prose",
      heading: "How the Node.js pipeline uses the service",
      paragraphs: [
        "In the pipeline, a `VoiceIntelSession` object accumulates caller audio chunks and periodically sends batches to the gender service's `/analyse` endpoint. The batch size is configurable (`GENDER_BATCH_FRAMES`, typically 50 frames = ~1 second of audio). Sending every frame individually would be too many HTTP round-trips; batching amortises the overhead.",
        "The result updates an exponentially weighted moving average (EWMA) rather than replacing the current estimate. Early in the call, there's little audio and confidence is low. After 5-10 seconds, the estimate stabilises. The EWMA smooths over individual noisy frames.",
        "The gender estimate is stored on the `SessionConfig.callerGender` field and injected into the system prompt: `'The caller appears to be male. Use appropriate honorifics.'` The word 'appears' is important — probabilities are not certainties.",
      ],
    },
    {
      kind: "callout",
      variant: "insight",
      title: "The echo-gate: not feeding agent audio to the gender detector",
      body: [
        "The pipeline feeds only **caller** audio to the gender detector, never the agent's TTS output. This requires the echo gate: the gender detector is gated on `!this.isPlaying` (the pipeline is not currently playing TTS audio). When the agent is speaking, caller audio frames are still arriving (μ-law silence frames from the network), but they contain the agent's voice leaking back through the caller's phone speaker. Feeding this back would produce nonsense gender estimates.",
      ],
    },
    {
      kind: "connections",
      title: "Voice analysis data flow",
      nodes: [
        { id: "tele",   label: "Telephony WebSocket",  sublabel: "μ-law audio frames" },
        { id: "pipe",   label: "OrchestrationPipeline", sublabel: "pipeline.ts",  chapterSlug: "session-and-pipeline" },
        { id: "tap",    label: "VoiceIntelSession",     sublabel: "audio accumulator" },
        { id: "svc",    label: "Gender service",        sublabel: "Python/FastAPI", current: true },
        { id: "ewma",   label: "EWMA smoother",         sublabel: "callerGender" },
        { id: "prompt", label: "System prompt",         sublabel: "LLM call",     chapterSlug: "staged-prompts" },
      ],
      edges: [
        { from: "tele",  to: "pipe",   label: "raw frames" },
        { from: "pipe",  to: "tap",    label: "caller frames (!playing)" },
        { from: "tap",   to: "svc",    label: "HTTP POST /analyse" },
        { from: "svc",   to: "ewma",   label: "male/female probs" },
        { from: "ewma",  to: "prompt", label: "callerGender injected" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "Why is librosa imported lazily (inside a function) rather than at the top of `main.py`?",
          choices: [
            "Lazy imports are required by the FastAPI framework",
            "Top-level librosa import takes ~2-3 seconds and delays uvicorn's port binding, causing health check failures",
            "librosa can't be imported before the audio request arrives",
            "To save memory — librosa is only loaded when needed",
          ],
          correctIndex: 1,
          explanation:
            "librosa's top-level import initialises numpy and scipy, taking 2-3 seconds. Railway's health check fires shortly after the container starts. If the port isn't bound yet, the health check fails and the deployment is rolled back. Lazy import defers the cost past port binding.",
        },
        {
          prompt: "Why is the gender detector gated on `!isPlaying`?",
          choices: [
            "Processing audio while TTS plays causes CPU spikes",
            "The caller audio frames during TTS playback contain agent voice leaking back, which corrupts the estimate",
            "The gender service can only process one stream at a time",
            "To reduce network traffic to the gender service",
          ],
          correctIndex: 1,
          explanation:
            "When the agent is playing TTS audio, the caller's phone speaker leaks that audio back into the microphone. The incoming caller frames contain the agent's voice, not the caller's. Feeding this to the gender detector produces wrong results.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Gender detection runs in a Python sidecar service — Python because of librosa/SpeechBrain; sidecar because it can't run inside Node.js cheaply",
        "MFCCs (20 coefficients) + mean/std across frames → 40-feature vector → pre-trained classifier",
        "librosa is imported lazily to avoid blocking uvicorn port binding at startup",
        "Caller audio is gated on `!isPlaying` — agent TTS audio leaking back corrupts the estimate",
        "EWMA smoothing: early estimates are noisy; the window stabilises after ~5-10 seconds of caller audio",
      ],
    },
  ],
};
