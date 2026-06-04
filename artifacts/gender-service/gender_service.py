"""
SnapServe Voice Analysis — Gender Service (ML Model Provider)

Algorithm: Autocorrelation-based pitch (F0) detection using pure NumPy.
  - Computes the autocorrelation of windowed frames to find the dominant
    fundamental frequency via parabolic interpolation around the lag peak.
  - Male voices:   median F0 ~85–155 Hz
  - Female voices: median F0 ~165–265 Hz

No external ML weights, no librosa — pure NumPy + soundfile only.
"""

from __future__ import annotations

import io
import time
from typing import Optional, Tuple

import numpy as np
import soundfile as sf


# ── Constants ─────────────────────────────────────────────────────────────────

TARGET_SR          = 8_000    # Input is 8 kHz PCM16 from the telephony path
FRAME_SIZE         = 512      # ~64 ms at 8 kHz
HOP_SIZE           = 256      # 50% overlap
F0_MIN_HZ          = 70.0     # Below typical male floor
F0_MAX_HZ          = 400.0    # Above typical female ceiling
F0_DECISION_HZ     = 165.0    # Decision boundary (male < 165 Hz, female >= 165 Hz)
MALE_F0_MEAN       = 120.0
FEMALE_F0_MEAN     = 210.0
MIN_VOICED_FRAMES  = 5        # Need at least this many voiced frames
CONFIDENCE_MIN     = 0.75     # Below this confidence → "unknown"
MAX_DURATION_S     = 5        # Analyse at most 5 s for speed


class GenderService:
    """
    Autocorrelation-based pitch analyser.

    Usage:
        svc = GenderService()
        result = svc._run_detection(audio_bytes)
    """

    def _run_detection(self, audio_bytes: bytes) -> dict:
        """
        Classify perceived gender from raw audio bytes.

        Accepts WAV (PCM16, 8 kHz mono) or any format soundfile can decode.

        Returns:
            {
                "estimated_gender": "male" | "female" | "unknown",
                "confidence":       float  (0.0 – 0.95),
                "processing_time_ms": int,
            }
        """
        t0 = time.monotonic()

        try:
            audio, sr = self._load_mono(audio_bytes)
        except Exception as exc:
            return {
                "estimated_gender": "unknown",
                "confidence": 0.0,
                "processing_time_ms": int((time.monotonic() - t0) * 1000),
                "error": f"audio decode failed: {exc}",
            }

        # Trim to first MAX_DURATION_S seconds
        max_samples = int(MAX_DURATION_S * sr)
        if len(audio) > max_samples:
            audio = audio[:max_samples]

        median_f0, voiced_count = self._median_f0_autocorr(audio, sr)

        if voiced_count < MIN_VOICED_FRAMES or median_f0 is None:
            return {
                "estimated_gender": "unknown",
                "confidence": 0.0,
                "processing_time_ms": int((time.monotonic() - t0) * 1000),
            }

        gender, confidence = self._score(median_f0)

        return {
            "estimated_gender": gender,
            "confidence": round(confidence, 2),
            "processing_time_ms": int((time.monotonic() - t0) * 1000),
        }

    # ── Internal helpers ───────────────────────────────────────────────────────

    def _load_mono(self, audio_bytes: bytes) -> Tuple[np.ndarray, int]:
        """Load audio bytes → (mono float32 array, sample_rate)."""
        audio, sr = sf.read(io.BytesIO(audio_bytes), dtype="float32", always_2d=False)
        if audio.ndim > 1:
            audio = audio.mean(axis=1)
        return audio, sr

    def _autocorr_f0(self, frame: np.ndarray, sr: int) -> Optional[float]:
        """
        Estimate F0 of a single frame via normalised autocorrelation.

        Returns the fundamental frequency in Hz, or None if the frame is
        unvoiced / no clear periodicity was found.
        """
        n = len(frame)
        # Apply Hann window to reduce spectral leakage
        windowed = frame * np.hanning(n)

        # Compute full autocorrelation via FFT (O(n log n))
        fft_size = 2 * n - 1
        # Next power-of-two for efficiency
        fft_size = 1 << (fft_size - 1).bit_length()
        F = np.fft.rfft(windowed, n=fft_size)
        acf = np.fft.irfft(F * np.conj(F))[:n]

        # Normalise so acf[0] == 1 (avoids issues with silent frames)
        if acf[0] < 1e-10:
            return None
        acf /= acf[0]

        # Convert F0 range to lag range
        lag_min = max(1, int(sr / F0_MAX_HZ))
        lag_max = min(n - 1, int(sr / F0_MIN_HZ))

        if lag_min >= lag_max:
            return None

        search = acf[lag_min:lag_max + 1]
        peak_idx = int(np.argmax(search))
        peak_val = search[peak_idx]

        # Voiced threshold: peak of normalised ACF must be > 0.3
        if peak_val < 0.3:
            return None

        lag = peak_idx + lag_min

        # Parabolic interpolation around the peak for sub-sample precision
        if 0 < lag < n - 1:
            alpha = acf[lag - 1]
            beta  = acf[lag]
            gamma = acf[lag + 1]
            denom = (alpha - 2 * beta + gamma)
            if abs(denom) > 1e-10:
                delta = 0.5 * (alpha - gamma) / denom
                lag = lag + delta

        if lag <= 0:
            return None

        return float(sr / lag)

    def _median_f0_autocorr(
        self, audio: np.ndarray, sr: int
    ) -> Tuple[Optional[float], int]:
        """
        Slide a window over `audio` and collect per-frame F0 estimates.

        Returns (median_hz, voiced_frame_count).
        Returns (None, 0) if there is insufficient voiced speech.
        """
        voiced_f0s = []
        n = len(audio)

        for start in range(0, n - FRAME_SIZE + 1, HOP_SIZE):
            frame = audio[start : start + FRAME_SIZE]
            f0 = self._autocorr_f0(frame, sr)
            if f0 is not None:
                voiced_f0s.append(f0)

        if len(voiced_f0s) < MIN_VOICED_FRAMES:
            return None, len(voiced_f0s)

        return float(np.median(voiced_f0s)), len(voiced_f0s)

    def _score(self, median_f0: float) -> Tuple[str, float]:
        """
        Map median F0 → (gender, confidence).

        Confidence is proportional to the distance from the decision boundary,
        normalised so that a median at the opposite gender's mean gives 0.95.
        """
        d_male   = abs(median_f0 - MALE_F0_MEAN)
        d_female = abs(median_f0 - FEMALE_F0_MEAN)
        total    = d_male + d_female

        if total < 1e-6:
            return "unknown", 0.0

        if median_f0 < F0_DECISION_HZ:
            gender   = "male"
            raw_conf = d_female / total
        else:
            gender   = "female"
            raw_conf = d_male / total

        # Map raw_conf ∈ [0.5, 1.0] → [0.50, 0.95]
        confidence = float(np.clip(0.50 + raw_conf * 0.45, 0.0, 0.95))

        if confidence < CONFIDENCE_MIN:
            return "unknown", confidence

        return gender, confidence
