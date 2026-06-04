import numpy as np
import soundfile as sf
import torch
import torchaudio


# ─────────────────────────────────────────
#  Configuration
# ─────────────────────────────────────────

SAMPLE_RATE        = 8000       # change to 16000 if your pipeline uses 16kHz
BUFFER_SECONDS     = 4          # seconds of audio to collect before detecting
BUFFER_SIZE        = SAMPLE_RATE * 2 * BUFFER_SECONDS  # PCM16 = 2 bytes/sample

MALE_MIN_HZ        = 80
MALE_MAX_HZ        = 165
FEMALE_MIN_HZ      = 180
FEMALE_MAX_HZ      = 300
NEUTRAL_ZONE_LOW   = 165        # overlap zone start
NEUTRAL_ZONE_HIGH  = 180        # overlap zone end

CONFIDENCE_SCORE   = 0.90       # returned for clear male/female detections


# ─────────────────────────────────────────
#  Core Pitch Analyzer
# ─────────────────────────────────────────

class PitchAnalyzer:
    """
    Estimates the fundamental frequency (F0) of a voice
    using autocorrelation on short frames.
    """

    def __init__(self, sample_rate: int = SAMPLE_RATE):
        self.sample_rate = sample_rate

    def analyze(self, audio: np.ndarray) -> float:
        """
        Returns the median pitch in Hz across all voiced frames.
        Returns 0.0 if no voiced frames are found.
        """
        frame_length = int(self.sample_rate * 0.025)  # 25ms frames
        pitches = []

        for i in range(0, len(audio) - frame_length, frame_length):
            frame = audio[i:i + frame_length]

            # Skip silent frames
            if np.max(np.abs(frame)) < 0.01:
                continue

            pitch = self._autocorrelation_pitch(frame)
            if pitch > 0:
                pitches.append(pitch)

        return float(np.median(pitches)) if pitches else 0.0

    def _autocorrelation_pitch(self, frame: np.ndarray) -> float:
        """Autocorrelation-based pitch estimator for a single frame."""
        corr = np.correlate(frame, frame, mode='full')
        corr = corr[len(corr) // 2:]

        min_lag = int(self.sample_rate / FEMALE_MAX_HZ)   # 300 Hz upper limit
        max_lag = int(self.sample_rate / MALE_MIN_HZ)     # 80 Hz lower limit

        if max_lag >= len(corr):
            return 0.0

        peak_lag = np.argmax(corr[min_lag:max_lag]) + min_lag
        if peak_lag == 0:
            return 0.0

        return self.sample_rate / peak_lag


# ─────────────────────────────────────────
#  Gender Classifier
# ─────────────────────────────────────────

class GenderClassifier:
    """
    Classifies gender from a pitch value.

    Ranges:
        Male    →  80–165 Hz
        Neutral → 165–180 Hz  (overlap zone, never guess)
        Female  → 180–300 Hz
    """

    def classify(self, pitch_hz: float) -> dict:
        if pitch_hz == 0.0:
            return self._result("neutral", "", 0.0, pitch_hz)

        if MALE_MIN_HZ <= pitch_hz <= MALE_MAX_HZ:
            return self._result("male", "sir", CONFIDENCE_SCORE, pitch_hz)

        elif FEMALE_MIN_HZ <= pitch_hz <= FEMALE_MAX_HZ:
            return self._result("female", "ma'am", CONFIDENCE_SCORE, pitch_hz)

        else:
            # Overlap zone (165–180 Hz) → neutral
            return self._result("neutral", "", 0.50, pitch_hz)

    def _result(self, gender: str, salutation: str, confidence: float, pitch_hz: float) -> dict:
        return {
            "gender":     gender,
            "salutation": salutation,
            "confidence": round(confidence, 2),
            "pitch_hz":   round(pitch_hz, 2),
        }


# ─────────────────────────────────────────
#  Gender Service  (main interface)
# ─────────────────────────────────────────

class GenderService:
    """
    Drop-in service for gender detection in a voice agent pipeline.

    Usage:
        service = GenderService(enabled=True, sample_rate=8000)

        # Feed audio chunks from your WebSocket stream:
        service.feed(chunk)

        # Once ready, get the salutation:
        if service.is_ready():
            salutation = service.get_salutation()   # "sir" | "ma'am" | ""
            result     = service.get_result()       # full dict
    """

    def __init__(self, enabled: bool = True, sample_rate: int = SAMPLE_RATE):
        self.enabled       = enabled
        self.sample_rate   = sample_rate
        self.buffer_size   = sample_rate * 2 * BUFFER_SECONDS

        self._audio_buffer = bytearray()
        self._result       = None
        self._analyzer     = PitchAnalyzer(sample_rate=sample_rate)
        self._classifier   = GenderClassifier()

    # ── Public API ──────────────────────────────────────────

    def feed(self, audio_chunk: bytes) -> None:
        """
        Feed a raw PCM16 audio chunk from your WebSocket stream.
        Detection runs automatically once enough audio is buffered.
        """
        if not self.enabled or self._result is not None:
            return

        self._audio_buffer.extend(audio_chunk)

        if len(self._audio_buffer) >= self.buffer_size:
            self._run_detection()

    def is_ready(self) -> bool:
        """Returns True once gender detection has completed."""
        return self._result is not None

    def get_salutation(self) -> str:
        """
        Returns the salutation string for prompt injection.
        Returns "" if detection is pending or gender is neutral.
        """
        if not self.enabled or self._result is None:
            return ""
        return self._result.get("salutation", "")

    def get_result(self) -> dict:
        """Returns the full detection result dict."""
        return self._result or {}

    def reset(self) -> None:
        """Reset for a new call session."""
        self._audio_buffer = bytearray()
        self._result       = None

    # ── Internal ────────────────────────────────────────────

    def _run_detection(self) -> None:
        try:
            audio = self._pcm_to_float(bytes(self._audio_buffer))
            pitch = self._analyzer.analyze(audio)
            self._result = self._classifier.classify(pitch_hz=pitch)
            print(f"[GenderService] {self._result}")
        except Exception as e:
            print(f"[GenderService] Detection error: {e}")
            self._result = {
                "gender": "neutral", "salutation": "",
                "confidence": 0.0,   "pitch_hz": 0.0
            }

    def _pcm_to_float(self, pcm_bytes: bytes) -> np.ndarray:
        """Convert raw PCM16 bytes to normalized float32 numpy array."""
        audio = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32)
        audio /= 32768.0
        return audio


# ─────────────────────────────────────────
#  Prompt Resolver
# ─────────────────────────────────────────

def resolve_salutation(template: str, gender_service: GenderService) -> str:
    """
    Replaces {caller_salutation} in your agent prompt template.

    Examples:
        "Hello {caller_salutation}, how can I help?"
        → "Hello sir, how can I help?"          (male)
        → "Hello ma'am, how can I help?"        (female)
        → "Hello, how can I help?"              (neutral)
    """
    salutation = gender_service.get_salutation()

    if salutation:
        return template.replace("{caller_salutation}", salutation)
    else:
        # Clean removal — handles both "Hello {caller_salutation}," and "{caller_salutation}"
        resolved = template.replace("{caller_salutation}, ", "")
        resolved = resolved.replace("{caller_salutation} ", "")
        resolved = resolved.replace("{caller_salutation}", "")
        return resolved


# ─────────────────────────────────────────
#  Quick Test  (run: python gender_service.py)
# ─────────────────────────────────────────

if __name__ == "__main__":
    import sys

    audio_file = sys.argv[1] if len(sys.argv) > 1 else "test_audio.wav"
    print(f"Testing with: {audio_file}\n")

    # Read WAV file and simulate streaming chunks
    audio_np, sr = sf.read(audio_file)
    if len(audio_np.shape) > 1:
        audio_np = audio_np.mean(axis=1)
    audio_np = audio_np.astype(np.float32)

    # Resample to service sample rate if needed
    if sr != SAMPLE_RATE:
        audio_tensor = torch.tensor(audio_np).unsqueeze(0)
        resampler = torchaudio.transforms.Resample(orig_freq=sr, new_freq=SAMPLE_RATE)
        audio_np = resampler(audio_tensor).squeeze(0).numpy()

    # Convert float → PCM16 bytes (simulate WebSocket stream)
    pcm_bytes = (audio_np * 32768.0).astype(np.int16).tobytes()

    # Simulate streaming in 1024-byte chunks
    service = GenderService(enabled=True, sample_rate=SAMPLE_RATE)
    chunk_size = 1024

    for i in range(0, len(pcm_bytes), chunk_size):
        chunk = pcm_bytes[i:i + chunk_size]
        service.feed(chunk)
        if service.is_ready():
            break

    # Results
    result = service.get_result()
    print(f"Pitch      : {result['pitch_hz']} Hz")
    print(f"Gender     : {result['gender']}")
    print(f"Salutation : {result['salutation'] or '(neutral - skip)'}")
    print(f"Confidence : {result['confidence'] * 100}%")

    # Test prompt injection
    template = "Hello {caller_salutation}, how can I help you today?"
    resolved = resolve_salutation(template, service)
    print(f"\nPrompt     : {resolved}")
