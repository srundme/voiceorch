"""
SpeechBrain ECAPA-TDNN speaker recognition module.

Extracts 192-dimensional speaker embeddings using the pre-trained
speechbrain/spkrec-ecapa-voxceleb model (VoxCeleb-trained ECAPA-TDNN).

The model is loaded lazily on first request and cached in memory.
On first load it downloads ~80 MB of weights from HuggingFace to
/tmp/speechbrain_ecapa (no token required).
"""
from __future__ import annotations

import io
import threading

import numpy as np
import soundfile as sf

_model = None
_model_lock = threading.Lock()


def _get_model():
    global _model
    if _model is not None:
        return _model
    with _model_lock:
        if _model is not None:
            return _model
        try:
            from speechbrain.inference.speaker import EncoderClassifier  # SpeechBrain >= 1.0
        except ImportError:
            from speechbrain.pretrained import EncoderClassifier          # SpeechBrain < 1.0
        _model = EncoderClassifier.from_hparams(
            source="speechbrain/spkrec-ecapa-voxceleb",
            savedir="/tmp/speechbrain_ecapa",
            run_opts={"device": "cpu"},
        )
    return _model


def extract_embedding(audio_bytes: bytes) -> list[float]:
    """
    Extract a 192-dim ECAPA-TDNN speaker embedding from raw audio bytes.

    Accepts any format soundfile/libsndfile can read (WAV, FLAC, OGG, PCM).
    Resamples to 16 kHz mono if necessary — ECAPA-TDNN was trained on 16 kHz.

    Returns a list of 192 floats (the d-vector / x-vector embedding).
    """
    import torch  # noqa: PLC0415

    audio_float, sr = sf.read(io.BytesIO(audio_bytes), dtype="float32", always_2d=False)
    if audio_float.ndim > 1:
        audio_float = audio_float.mean(axis=1)

    if sr != 16_000:
        import librosa  # noqa: PLC0415
        audio_float = librosa.resample(audio_float, orig_sr=int(sr), target_sr=16_000)

    model = _get_model()
    waveform = torch.tensor(audio_float, dtype=torch.float32).unsqueeze(0)  # [1, T]

    with torch.no_grad():
        embedding = model.encode_batch(waveform)   # [1, 1, 192]

    return embedding.squeeze().cpu().numpy().tolist()


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """
    Cosine similarity between two embedding vectors (range −1 to 1).
    Returns 0.0 for zero-norm vectors.
    """
    a_np = np.array(a, dtype=np.float32)
    b_np = np.array(b, dtype=np.float32)
    dot  = float(np.dot(a_np, b_np))
    norm = float(np.linalg.norm(a_np)) * float(np.linalg.norm(b_np))
    return dot / norm if norm > 0 else 0.0


def warmup() -> None:
    """Pre-load the model so the first real request is not slow."""
    try:
        _get_model()
    except Exception:
        pass
