"""
speaker_recognition.py
──────────────────────
ECAPA-TDNN speaker embeddings for voice biometric verification.

Used by the orchestrator's SpeakerVerifier to detect mid-call speaker hand-offs
(anti-impersonation). The model produces a 192-dim d-vector that is robust to
8 kHz telephony codecs (trained on VoxCeleb, which includes telephone audio).

Design notes:
  • ALL heavy imports (torch, speechbrain, librosa, soundfile) are lazy — done
    inside functions — so importing this module never blocks uvicorn port binding.
  • The model is loaded once and cached (singleton).
  • Embeddings are L2-normalised so cosine similarity is a plain dot product.
"""

from __future__ import annotations

import io

# Singleton model handle — populated on first use.
_MODEL = None
_SAVEDIR = "/tmp/speechbrain_ecapa"
_TARGET_SR = 16000


def _get_model():
    """Load the ECAPA-TDNN encoder once and reuse it. Lazy + cached."""
    global _MODEL
    if _MODEL is None:
        # speechbrain >= 1.0 moved the inference classes under .inference;
        # fall back to the legacy .pretrained path for older installs.
        try:
            from speechbrain.inference.speaker import EncoderClassifier  # noqa: PLC0415
        except Exception:  # noqa: BLE001
            from speechbrain.pretrained import EncoderClassifier  # noqa: PLC0415
        print("[speaker] Loading ECAPA-TDNN model (first time only)...", flush=True)
        _MODEL = EncoderClassifier.from_hparams(
            source="speechbrain/spkrec-ecapa-voxceleb",
            savedir=_SAVEDIR,
            run_opts={"device": "cpu"},
        )
        print("[speaker] ECAPA-TDNN model ready.", flush=True)
    return _MODEL


def _decode_to_mono16k(audio_bytes: bytes):
    """Decode arbitrary WAV/FLAC/etc bytes → mono float32 @ 16 kHz numpy array."""
    import numpy as np       # noqa: PLC0415
    import soundfile as sf   # noqa: PLC0415

    audio, sr = sf.read(io.BytesIO(audio_bytes), dtype="float32", always_2d=False)
    if getattr(audio, "ndim", 1) > 1:
        audio = audio.mean(axis=1)
    if sr != _TARGET_SR:
        import librosa  # noqa: PLC0415
        audio = librosa.resample(audio, orig_sr=sr, target_sr=_TARGET_SR)
    return audio.astype(np.float32)


def embed_audio_bytes(audio_bytes: bytes):
    """Return the 192-dim L2-normalised ECAPA embedding for the given audio."""
    import numpy as np  # noqa: PLC0415
    import torch        # noqa: PLC0415

    audio = _decode_to_mono16k(audio_bytes)
    model = _get_model()
    with torch.no_grad():
        emb = model.encode_batch(torch.tensor(audio).unsqueeze(0))
    vec = emb.squeeze().detach().cpu().numpy().astype(np.float32)
    norm = float(np.linalg.norm(vec))
    if norm > 0:
        vec = vec / norm
    return vec.tolist()


def audio_rms(audio_bytes: bytes) -> float:
    """Root-mean-square level of the audio (0..1) — cheap speech-presence proxy."""
    import numpy as np  # noqa: PLC0415

    audio = _decode_to_mono16k(audio_bytes)
    if audio.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(audio ** 2)))


def cosine_similarity(a, b) -> float:
    """Cosine similarity between two embedding vectors (−1..1)."""
    import numpy as np  # noqa: PLC0415

    va = np.asarray(a, dtype=np.float32)
    vb = np.asarray(b, dtype=np.float32)
    na = float(np.linalg.norm(va))
    nb = float(np.linalg.norm(vb))
    if na == 0.0 or nb == 0.0 or va.shape != vb.shape:
        return 0.0
    return float(np.dot(va, vb) / (na * nb))


def check_speaker_dependencies() -> dict:
    """Verify the ECAPA model can load. Returns a structured status dict; never raises."""
    import traceback  # noqa: PLC0415

    checks = {"torch": False, "speechbrain": False, "ecapa_model": False}
    errors: dict = {}

    try:
        import torch  # noqa: PLC0415, F401
        checks["torch"] = True
    except Exception as exc:  # noqa: BLE001
        errors["torch"] = f"{type(exc).__name__}: {exc}"

    try:
        import speechbrain  # noqa: PLC0415, F401
        checks["speechbrain"] = True
    except Exception as exc:  # noqa: BLE001
        errors["speechbrain"] = f"{type(exc).__name__}: {exc}"

    try:
        _get_model()
        checks["ecapa_model"] = True
    except Exception as exc:  # noqa: BLE001
        errors["ecapa_model"] = f"{type(exc).__name__}: {exc}"
        print(f"[speaker] ECAPA model load failed: {traceback.format_exc()}", flush=True)

    return {"ok": all(checks.values()), "checks": checks, "errors": errors, "checked": True}
