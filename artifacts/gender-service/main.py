"""
SnapServe Voice Analysis Service
---------------------------------
REST:      POST /voice-analysis/gender        (multipart file upload)
           POST /voice-analysis/gender/url    (JSON { "audio_url": "..." })
WebSocket: WS   /voice-analysis/ws/gender     (streaming binary audio)
Health:    GET  /voice-analysis/health

Future modules (same router):
  /voice-analysis/age          age estimation
  /voice-analysis/sentiment    sentiment detection
  /voice-analysis/accent       accent detection
  /voice-analysis/emotion      emotion detection
  /voice-analysis/verify       speaker verification
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import io
import os

import httpx
import uvicorn
from contextlib import asynccontextmanager
from fastapi import APIRouter, FastAPI, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from typing import List
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel


async def _bg_warmup() -> None:
    """Import librosa, wav2vec2, and ECAPA-TDNN models in threads so the first real request is not slow.

    Uses asyncio.create_task() (called from lifespan) so uvicorn completes
    startup immediately — this coroutine runs fully in the background.
    """
    loop = asyncio.get_running_loop()
    def _load():
        try:
            from gender_detector import classify_audio_bytes  # noqa: PLC0415
        except Exception:
            pass
    await loop.run_in_executor(concurrent.futures.ThreadPoolExecutor(max_workers=1), _load)

    def _load_ml_v2():
        try:
            from gender_service_ml import _ModelLoader  # noqa: PLC0415
            _ModelLoader.get()  # actually loads wav2vec2 weights into memory
        except Exception:
            pass
    await loop.run_in_executor(concurrent.futures.ThreadPoolExecutor(max_workers=1), _load_ml_v2)

    def _load_speaker():
        try:
            from speaker_recognition import warmup  # noqa: PLC0415
            warmup()  # downloads ECAPA-TDNN weights from HuggingFace if not cached
        except Exception:
            pass
    await loop.run_in_executor(concurrent.futures.ThreadPoolExecutor(max_workers=1), _load_speaker)


@asynccontextmanager
async def lifespan(app: FastAPI):
    asyncio.create_task(_bg_warmup())
    yield


# ── App setup ─────────────────────────────────────────────────────────────────

app = FastAPI(
    title="SnapServe Voice Analysis",
    version="1.0.0",
    description="Real-time speaker characteristic detection from audio",
    lifespan=lifespan,
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

router = APIRouter(prefix="/voice-analysis")


# ── Health ────────────────────────────────────────────────────────────────────

@router.get("/health")
def health():
    """Service health check."""
    return {"status": "ok", "service": "voice-analysis", "version": "1.0.0"}


# ── Gender — file upload ──────────────────────────────────────────────────────

@router.post("/gender")
async def detect_gender_upload(file: UploadFile = File(...)):
    """
    Detect perceived gender from an uploaded audio file.

    Accepts: WAV, FLAC, OGG, MP3 (any format soundfile / libsndfile can read).
    Uses the first 3–5 seconds of speech for analysis.

    Returns:
        {
            "estimated_gender": "male" | "female" | "unknown",
            "confidence": float,
            "processing_time_ms": int
        }
    """
    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio file")
    from gender_detector import classify_audio_bytes  # noqa: PLC0415
    return classify_audio_bytes(audio_bytes)


# ── Gender — URL ──────────────────────────────────────────────────────────────

class GenderByUrlRequest(BaseModel):
    audio_url: str


@router.post("/gender/url")
async def detect_gender_url(req: GenderByUrlRequest):
    """
    Detect perceived gender by downloading audio from a URL.

    Request body: { "audio_url": "https://example.com/sample.wav" }
    """
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(req.audio_url)
        resp.raise_for_status()
        audio_bytes = resp.content
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Failed to fetch audio (HTTP {exc.response.status_code}): {req.audio_url}",
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to fetch audio: {exc}")

    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Downloaded audio is empty")

    from gender_detector import classify_audio_bytes  # noqa: PLC0415
    return classify_audio_bytes(audio_bytes)


# ── Gender — WebSocket (streaming) ────────────────────────────────────────────

# Minimum audio buffer before running inference.
# At 16 kHz mono 16-bit PCM: 3 s ≈ 96 000 bytes.
# We use a slightly larger window to ensure enough voiced frames.
WS_TRIGGER_BYTES = 80_000   # ~2.5 s of 16kHz 16-bit mono PCM


@router.websocket("/ws/gender")
async def ws_gender(websocket: WebSocket):
    """
    WebSocket endpoint for streaming gender detection.

    Protocol:
      • Client  → server: raw binary audio chunks
                           (WAV with header is easiest; raw PCM @ 16kHz 16-bit mono also works)
      • Server  → client: JSON result after enough audio has accumulated:
                          {"estimated_gender": "...", "confidence": ..., "processing_time_ms": ...}

    The server analyses the accumulated buffer every WS_TRIGGER_BYTES bytes,
    then clears the buffer so the next window starts fresh.
    The connection remains open for continuous re-analysis.
    """
    await websocket.accept()
    buffer = bytearray()

    try:
        while True:
            data = await websocket.receive_bytes()
            buffer.extend(data)

            if len(buffer) >= WS_TRIGGER_BYTES:
                from gender_detector import classify_audio_bytes  # noqa: PLC0415
                result = classify_audio_bytes(bytes(buffer))
                await websocket.send_json(result)
                buffer.clear()

    except WebSocketDisconnect:
        pass
    except Exception:
        pass


# ── Gender ML — file upload (autocorrelation, pure NumPy) ────────────────────

@router.post("/gender-ml")
async def detect_gender_ml_upload(file: UploadFile = File(...)):
    """
    Detect perceived gender using the autocorrelation-based ML model provider.

    Accepts: WAV (PCM16, 8 kHz mono from telephony path).
    Buffers 4 seconds of caller audio and runs pure-NumPy pitch analysis.

    Returns:
        {
            "estimated_gender": "male" | "female" | "unknown",
            "confidence": float,
            "processing_time_ms": int
        }
    """
    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio file")
    from gender_service import GenderService  # noqa: PLC0415
    svc = GenderService()
    return svc._run_detection(audio_bytes)


# ── Gender ML v2 — file upload (wav2vec2 transformer) ────────────────────────

@router.post("/gender-ml-v2")
async def detect_gender_ml_v2_upload(file: UploadFile = File(...)):
    """
    Detect perceived gender using the wav2vec2 transformer ML model (v2).

    Accepts: WAV (PCM16, 8 kHz mono from telephony path).
    Buffers 2 seconds of caller audio and runs wav2vec2 inference.

    Returns:
        {
            "estimated_gender": "male" | "female" | "unknown",
            "confidence": float,
            "processing_time_ms": int
        }
    """
    import io    # noqa: PLC0415
    import time  # noqa: PLC0415
    import numpy as np   # noqa: PLC0415
    import soundfile as sf  # noqa: PLC0415
    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio file")
    from gender_service_ml import MLGenderService  # noqa: PLC0415
    t0 = time.monotonic()

    # Decode WAV → mono float32 → int16 PCM bytes (MLGenderService buffer format)
    audio_float, sr = sf.read(io.BytesIO(audio_bytes), dtype="float32", always_2d=False)
    if audio_float.ndim > 1:
        audio_float = audio_float.mean(axis=1)
    pcm_bytes = (audio_float * 32768.0).astype(np.int16).tobytes()

    svc = MLGenderService(enabled=True, sample_rate=int(sr))
    svc._buffer.extend(pcm_bytes)
    svc._run_detection()

    result = svc.get_result()
    processing_time_ms = int((time.monotonic() - t0) * 1000)
    gender = result.get("gender", "neutral")
    estimated_gender = gender if gender in ("male", "female") else "unknown"
    return {
        "estimated_gender": estimated_gender,
        "confidence": result.get("confidence", 0.0),
        "processing_time_ms": processing_time_ms,
    }


# ── Speaker Recognition — ECAPA-TDNN (SpeechBrain) ───────────────────────────


class SpeakerVerifyRequest(BaseModel):
    reference_embedding: List[float]


@router.post("/speaker/embed")
async def speaker_embed(file: UploadFile = File(...)):
    """
    Extract a 192-dim ECAPA-TDNN speaker embedding from an uploaded audio file.

    Accepts: WAV, FLAC, OGG, or any format soundfile can read.
    Audio is resampled to 16 kHz mono automatically.

    Returns:
        {
            "embedding": [float, ...],   // 192-dimensional d-vector
            "duration_seconds": float
        }
    """
    import time  # noqa: PLC0415
    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio file")
    t0 = time.monotonic()
    try:
        from speaker_recognition import extract_embedding  # noqa: PLC0415
        embedding = extract_embedding(audio_bytes)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Embedding extraction failed: {exc}")
    processing_ms = int((time.monotonic() - t0) * 1000)
    return {"embedding": embedding, "processing_ms": processing_ms}


@router.post("/speaker/verify")
async def speaker_verify(file: UploadFile = File(...), reference_embedding: str = ""):
    """
    Compare an audio file's speaker embedding against a reference embedding.

    Multipart form fields:
      - file: audio file (WAV / FLAC / OGG)
      - reference_embedding: JSON string of the reference float[] embedding

    Returns:
        {
            "similarity": float,  // cosine similarity, −1 to 1
            "embedding":  [float, ...]  // embedding of the uploaded audio
        }
    """
    import json  # noqa: PLC0415
    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio file")
    if not reference_embedding:
        raise HTTPException(status_code=400, detail="reference_embedding is required")
    try:
        ref = json.loads(reference_embedding)
    except Exception:
        raise HTTPException(status_code=400, detail="reference_embedding must be a JSON float array")
    try:
        from speaker_recognition import extract_embedding, cosine_similarity  # noqa: PLC0415
        embedding = extract_embedding(audio_bytes)
        similarity = cosine_similarity(embedding, ref)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Speaker verification failed: {exc}")
    return {"similarity": similarity, "embedding": embedding}


@router.get("/speaker/health")
async def speaker_health():
    """Check if the ECAPA-TDNN speaker recognition model is loaded."""
    try:
        from speaker_recognition import _model  # noqa: PLC0415
        loaded = _model is not None
    except Exception:
        loaded = False
    return {"model": "speechbrain/spkrec-ecapa-voxceleb", "loaded": loaded}


# ── Register router & run ─────────────────────────────────────────────────────

app.include_router(router)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False, log_level="info")
