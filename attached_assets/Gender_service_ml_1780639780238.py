"""
gender_service_ml.py
────────────────────
ML-based gender detection using Facebook wav2vec2.
Pretrained on LibriSpeech — works on any language/accent.

Use this as a drop-in alongside gender_service.py (pitch-based).
The pitch-based service acts as fallback if this one fails.
"""

import numpy as np
import librosa
import soundfile as sf
import warnings
warnings.filterwarnings("ignore")

from transformers import pipeline as hf_pipeline

# ─────────────────────────────────────────
#  Configuration
# ─────────────────────────────────────────

MODEL_NAME       = "alefiury/wav2vec2-large-xlsr-53-gender-recognition-librispeech"
SAMPLE_RATE      = 8000        # your platform's PCM rate
TARGET_SR        = 16000       # wav2vec2 requires 16kHz
BUFFER_SECONDS   = 2           # seconds of audio before detection fires
BUFFER_SIZE      = SAMPLE_RATE * 2 * BUFFER_SECONDS   # PCM16 = 2 bytes/sample
MIN_CONFIDENCE   = 0.65        # below this → neutral


# ─────────────────────────────────────────
#  Singleton Model Loader
# ─────────────────────────────────────────

class _ModelLoader:
    """Loads the wav2vec2 model once and reuses it across all calls."""
    _classifier = None

    @classmethod
    def get(cls):
        if cls._classifier is None:
            print("[MLGenderService] Loading wav2vec2 model (first time only)...")
            cls._classifier = hf_pipeline(
                "audio-classification",
                model=MODEL_NAME,
                device=-1   # CPU; change to 0 for GPU
            )
            print("[MLGenderService] Model ready.")
        return cls._classifier


# ─────────────────────────────────────────
#  Core ML Detector
# ─────────────────────────────────────────

class MLGenderDetector:
    """
    Runs wav2vec2 gender classification on a float32 audio array.
    Returns a result dict: { gender, salutation, confidence, raw_label }
    """

    def detect(self, audio: np.ndarray, sample_rate: int) -> dict:
        try:
            # Resample to 16kHz if needed
            if sample_rate != TARGET_SR:
                audio = librosa.resample(
                    audio, orig_sr=sample_rate, target_sr=TARGET_SR
                )

            classifier = _ModelLoader.get()
            results    = classifier({"array": audio, "sampling_rate": TARGET_SR})
            top        = results[0]
            label      = top["label"].lower()
            confidence = top["score"]

            if "female" in label and confidence >= MIN_CONFIDENCE:
                return self._result("female", "ma'am", confidence, label)
            elif "male" in label and confidence >= MIN_CONFIDENCE:
                return self._result("male", "sir", confidence, label)
            else:
                return self._result("neutral", "", confidence, label)

        except Exception as e:
            print(f"[MLGenderService] Detection error: {e}")
            return self._result("neutral", "", 0.0, "error")

    def _result(self, gender, salutation, confidence, raw_label):
        return {
            "gender":     gender,
            "salutation": salutation,
            "confidence": round(confidence, 2),
            "raw_label":  raw_label,
            "provider":   "ml_model_v2"
        }


# ─────────────────────────────────────────
#  ML Gender Service  (main interface)
# ─────────────────────────────────────────

class MLGenderService:
    """
    Drop-in ML gender service for WebSocket voice pipelines.
    Same interface as GenderService (pitch-based) for easy swapping.

    Usage:
        service = MLGenderService(enabled=True)
        service.feed(audio_chunk)            # on each WebSocket chunk
        if service.is_ready():
            salutation = service.get_salutation()   # "sir" | "ma'am" | ""
    """

    def __init__(self, enabled: bool = True, sample_rate: int = SAMPLE_RATE):
        self.enabled     = enabled
        self.sample_rate = sample_rate
        self.buffer_size = sample_rate * 2 * BUFFER_SECONDS

        self._buffer   = bytearray()
        self._result   = None
        self._detector = MLGenderDetector() if enabled else None

    # ── Public API ──────────────────────────────────────────

    def feed(self, audio_chunk: bytes) -> None:
        """Feed raw PCM16 audio bytes from your WebSocket stream."""
        if not self.enabled or self._result is not None:
            return

        self._buffer.extend(audio_chunk)

        if len(self._buffer) >= self.buffer_size:
            self._run_detection()

    def is_ready(self) -> bool:
        """True once detection has completed."""
        return self._result is not None

    def get_salutation(self) -> str:
        """Returns 'sir', 'ma'am', or '' (neutral / disabled / pending)."""
        if not self.enabled or self._result is None:
            return ""
        return self._result.get("salutation", "")

    def get_result(self) -> dict:
        """Full detection result dict."""
        return self._result or {}

    def reset(self) -> None:
        """Reset for a new call session."""
        self._buffer = bytearray()
        self._result = None

    # ── Internal ────────────────────────────────────────────

    def _run_detection(self) -> None:
        audio = self._pcm_to_float(bytes(self._buffer))
        self._result = self._detector.detect(audio, self.sample_rate)
        print(f"[MLGenderService] {self._result}")

    def _pcm_to_float(self, pcm_bytes: bytes) -> np.ndarray:
        audio = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32)
        audio /= 32768.0
        return audio


# ─────────────────────────────────────────
#  Prompt Resolver (shared utility)
# ─────────────────────────────────────────

def resolve_salutation(template: str, service) -> str:
    """
    Replaces {caller_salutation} in the agent prompt.
    Works with both MLGenderService and GenderService (pitch-based).

    "Hello {caller_salutation}, how can I help?" →
        "Hello sir, how can I help?"      (male)
        "Hello ma'am, how can I help?"    (female)
        "Hello, how can I help?"          (neutral)
    """
    salutation = service.get_salutation()
    if salutation:
        return template.replace("{caller_salutation}", salutation)
    resolved = template.replace("{caller_salutation}, ", "")
    resolved = resolved.replace("{caller_salutation} ", "")
    resolved = resolved.replace("{caller_salutation}", "")
    return resolved


# ─────────────────────────────────────────
#  Quick Test
# ─────────────────────────────────────────

if __name__ == "__main__":
    import sys
    import torch
    import torchaudio

    audio_file = sys.argv[1] if len(sys.argv) > 1 else "test_audio.wav"
    print(f"Testing with: {audio_file}\n")

    # Read and preprocess audio
    audio_np, sr = sf.read(audio_file)
    if len(audio_np.shape) > 1:
        audio_np = audio_np.mean(axis=1)
    audio_np = audio_np.astype(np.float32)

    # Resample to platform sample rate if needed
    if sr != SAMPLE_RATE:
        audio_tensor = torch.tensor(audio_np).unsqueeze(0)
        resampler    = torchaudio.transforms.Resample(orig_freq=sr, new_freq=SAMPLE_RATE)
        audio_np     = resampler(audio_tensor).squeeze(0).numpy()

    # Simulate WebSocket streaming
    pcm_bytes  = (audio_np * 32768.0).astype(np.int16).tobytes()
    service    = MLGenderService(enabled=True, sample_rate=SAMPLE_RATE)
    chunk_size = 1024

    for i in range(0, len(pcm_bytes), chunk_size):
        service.feed(pcm_bytes[i:i + chunk_size])
        if service.is_ready():
            break

    # Print results
    result = service.get_result()
    print(f"\n--- Result ---")
    print(f"Gender     : {result['gender']}")
    print(f"Salutation : {result['salutation'] or '(neutral - skip)'}")
    print(f"Confidence : {round(result['confidence'] * 100, 2)}%")
    print(f"Raw Label  : {result['raw_label']}")
    print(f"Provider   : {result['provider']}")

    # Test prompt injection
    template = "Hello {caller_salutation}, how can I help you today?"
    print(f"\nPrompt     : {resolve_salutation(template, service)}")
