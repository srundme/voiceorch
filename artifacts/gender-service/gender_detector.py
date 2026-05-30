"""
SnapServe Voice Analysis — Gender Detector (V1)

Algorithm: Pitch (fundamental frequency F0) analysis via librosa.pyin()
  - Male voices:   median F0 ~85–155 Hz (mean ~120 Hz)
  - Female voices: median F0 ~165–265 Hz (mean ~210 Hz)

Architecture is modular: the `classify_audio_bytes` function is the single
entry point. A V2 upgrade can replace _extract_features() with SpeechBrain
ECAPA-TDNN embeddings and a trained linear classifier while keeping the same
public interface.

Confidence rules (per spec):
  >= 0.75 → return "male" or "female"
  <  0.75 → return "unknown"
"""

from __future__ import annotations

import io
import time
from typing import Tuple

import numpy as np
import librosa
import soundfile as sf


# ── F0 statistics (Hz) — sourced from ITU-T P.10 / VoxCeleb research ─────────
MALE_F0_MEAN       = 120.0   # typical male fundamental
FEMALE_F0_MEAN     = 210.0   # typical female fundamental
F0_DECISION_HZ     = 165.0   # crossover threshold
MIN_VOICED_FRAMES  = 10      # fewer than this → not enough speech
CONFIDENCE_MIN     = 0.75    # below this confidence → return "unknown"
TARGET_SR          = 16_000  # resample everything to 16 kHz
MAX_DURATION_S     = 5       # analyse at most 5 s for speed


def classify_audio_bytes(audio_bytes: bytes) -> dict:
    """
    Classify perceived gender from raw audio bytes.

    Accepts any format that soundfile can decode (WAV, FLAC, OGG, MP3 via
    soundfile/libsndfile, raw PCM).

    Returns:
        {
            "estimated_gender": "male" | "female" | "unknown",
            "confidence":       float   (0.0 – 0.95),
            "processing_time_ms": int,
        }
    """
    t0 = time.monotonic()

    try:
        audio, sr = _load_mono_16k(audio_bytes)
    except Exception as exc:
        return {
            "estimated_gender": "unknown",
            "confidence": 0.0,
            "processing_time_ms": int((time.monotonic() - t0) * 1000),
            "error": f"audio decode failed: {exc}",
        }

    # Trim to first MAX_DURATION_S seconds
    max_samples = MAX_DURATION_S * sr
    if len(audio) > max_samples:
        audio = audio[:max_samples]

    median_f0, voiced_count = _median_f0(audio, sr)

    if voiced_count < MIN_VOICED_FRAMES or median_f0 is None:
        return {
            "estimated_gender": "unknown",
            "confidence": 0.0,
            "processing_time_ms": int((time.monotonic() - t0) * 1000),
        }

    gender, confidence = _score(median_f0)

    return {
        "estimated_gender": gender,
        "confidence": round(confidence, 2),
        "processing_time_ms": int((time.monotonic() - t0) * 1000),
    }


# ── Internal helpers ──────────────────────────────────────────────────────────

def _load_mono_16k(audio_bytes: bytes) -> Tuple[np.ndarray, int]:
    """Load audio bytes → (mono float32 array, sample_rate at 16 kHz)."""
    audio, sr = sf.read(io.BytesIO(audio_bytes), dtype="float32", always_2d=False)
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    if sr != TARGET_SR:
        audio = librosa.resample(audio, orig_sr=sr, target_sr=TARGET_SR)
        sr = TARGET_SR
    return audio, sr


def _median_f0(audio: np.ndarray, sr: int) -> Tuple[float | None, int]:
    """
    Extract median fundamental frequency from voiced frames.

    Returns (median_hz, voiced_frame_count).
    Returns (None, 0) if there is insufficient voiced speech.
    """
    f0, voiced_flag, _ = librosa.pyin(
        audio,
        fmin=librosa.note_to_hz("C2"),   # ~65 Hz — well below male floor
        fmax=librosa.note_to_hz("C6"),   # ~1047 Hz — well above female ceiling
        sr=sr,
        frame_length=2048,
        hop_length=512,
    )

    valid_mask = voiced_flag & ~np.isnan(f0)
    voiced_f0  = f0[valid_mask]

    if len(voiced_f0) < MIN_VOICED_FRAMES:
        return None, int(len(voiced_f0))

    return float(np.median(voiced_f0)), int(len(voiced_f0))


def _score(median_f0: float) -> Tuple[str, float]:
    """
    Map median F0 → (gender, confidence).

    Confidence is proportional to the distance from the decision boundary,
    normalised so that a median exactly at the opposite gender's mean gives 0.95.
    """
    d_male   = abs(median_f0 - MALE_F0_MEAN)
    d_female = abs(median_f0 - FEMALE_F0_MEAN)
    total    = d_male + d_female

    if total < 1e-6:
        return "unknown", 0.0

    if median_f0 < F0_DECISION_HZ:
        gender  = "male"
        raw_conf = d_female / total    # farther from female → more confident male
    else:
        gender  = "female"
        raw_conf = d_male / total      # farther from male → more confident female

    # raw_conf ∈ [0.5, 1.0] when on the correct side of the boundary
    # Map to [0.50, 0.95] to stay honest about model uncertainty
    confidence = float(np.clip(0.50 + raw_conf * 0.45, 0.0, 0.95))

    if confidence < CONFIDENCE_MIN:
        return "unknown", confidence

    return gender, confidence
