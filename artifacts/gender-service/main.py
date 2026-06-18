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
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import io
import os

import httpx
import uvicorn
from contextlib import asynccontextmanager
from fastapi import APIRouter, FastAPI, File, HTTPException, Response, UploadFile, WebSocket, WebSocketDisconnect
from typing import List
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel


# Readiness state for the gender-ml-v2 pipeline. Populated by the background
# warmup at startup and surfaced via GET /voice-analysis/ready so a missing
# heavy dependency fails fast and visibly instead of as per-call 500s.
_ml_v2_readiness: dict = {
    "ok": False,
    "checks": {"soundfile": False, "torch": False, "transformers": False, "wav2vec2_model": False},
    "errors": {},
    "checked": False,
}


def _check_ml_v2_dependencies() -> dict:
    """Verify every heavy dependency the gender-ml-v2 handler relies on.

    Decodes a tiny WAV through soundfile/libsndfile, imports torch + transformers,
    and forces the wav2vec2 model to load. Returns a structured status dict and
    never raises — each check is isolated so one failure does not mask others.
    """
    import io          # noqa: PLC0415
    import traceback   # noqa: PLC0415

    checks = {"soundfile": False, "torch": False, "transformers": False, "wav2vec2_model": False}
    errors: dict = {}

    try:
        import numpy as np       # noqa: PLC0415
        import soundfile as sf   # noqa: PLC0415
        sr = 16000
        tone = (0.1 * np.sin(2 * np.pi * 220 * np.linspace(0, 0.1, int(sr * 0.1), endpoint=False))).astype(np.float32)
        b = io.BytesIO()
        sf.write(b, tone, sr, format="WAV", subtype="PCM_16")
        b.seek(0)
        sf.read(b, dtype="float32")
        checks["soundfile"] = True
    except Exception as exc:  # noqa: BLE001
        errors["soundfile"] = f"{type(exc).__name__}: {exc}"
        print(f"[readiness] soundfile/libsndfile check failed: {traceback.format_exc()}", flush=True)

    try:
        import torch  # noqa: PLC0415, F401
        checks["torch"] = True
    except Exception as exc:  # noqa: BLE001
        errors["torch"] = f"{type(exc).__name__}: {exc}"
        print(f"[readiness] torch import failed: {traceback.format_exc()}", flush=True)

    try:
        import transformers  # noqa: PLC0415, F401
        checks["transformers"] = True
    except Exception as exc:  # noqa: BLE001
        errors["transformers"] = f"{type(exc).__name__}: {exc}"
        print(f"[readiness] transformers import failed: {traceback.format_exc()}", flush=True)

    try:
        from gender_service_ml import _ModelLoader  # noqa: PLC0415
        _ModelLoader.get()  # actually loads wav2vec2 weights into memory
        checks["wav2vec2_model"] = True
    except Exception as exc:  # noqa: BLE001
        errors["wav2vec2_model"] = f"{type(exc).__name__}: {exc}"
        print(f"[readiness] wav2vec2 model load failed: {traceback.format_exc()}", flush=True)

    return {"ok": all(checks.values()), "checks": checks, "errors": errors, "checked": True}


async def _bg_warmup() -> None:
    """Import librosa, wav2vec2, and ECAPA-TDNN models in threads so the first real request is not slow.

    Uses asyncio.create_task() (called from lifespan) so uvicorn completes
    startup immediately — this coroutine runs fully in the background.
    """
    loop = asyncio.get_running_loop()

    def _load_v1():
        try:
            from gender_detector import classify_audio_bytes  # noqa: PLC0415, F401
        except Exception:
            import traceback  # noqa: PLC0415
            print(f"[warmup] gender_detector (v1) load failed: {traceback.format_exc()}", flush=True)
    await loop.run_in_executor(concurrent.futures.ThreadPoolExecutor(max_workers=1), _load_v1)

    def _warmup_ml_v2():
        global _ml_v2_readiness
        _ml_v2_readiness = _check_ml_v2_dependencies()
        if _ml_v2_readiness["ok"]:
            print("[warmup] gender-ml-v2 dependencies ready (soundfile, torch, transformers, wav2vec2)", flush=True)
        else:
            print(f"[warmup] gender-ml-v2 NOT ready — errors: {_ml_v2_readiness['errors']}", flush=True)
    await loop.run_in_executor(concurrent.futures.ThreadPoolExecutor(max_workers=1), _warmup_ml_v2)




@asynccontextmanager
async def lifespan(app: FastAPI):
    asyncio.create_task(_bg_warmup())
    yield


# ── App setup ─────────────────────────────────────────────────────────────────

app = FastAPI(
    title="SnapServe Voice Analysis",
    version="1.0.0",
    description="Real-time voice characteristic detection from audio (gender, age, emotion, accent, sentiment)",
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
    """Service health check (liveness) — returns as soon as the process is up."""
    return {"status": "ok", "service": "voice-analysis", "version": "1.0.0"}


# ── Readiness ─────────────────────────────────────────────────────────────────

@router.get("/ready")
def ready(response: Response):
    """Readiness probe for the gender-ml-v2 pipeline.

    Verifies soundfile/libsndfile can decode audio, torch + transformers import,
    and the wav2vec2 model loads. Returns 200 only when every dependency is
    available; otherwise 503 with the failing checks so missing dependencies
    surface immediately instead of as per-call 500s.
    """
    result = _ml_v2_readiness if _ml_v2_readiness.get("checked") else _check_ml_v2_dependencies()
    if not result.get("ok"):
        response.status_code = 503
    return {"service": "voice-analysis", **result}


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
    import io          # noqa: PLC0415
    import time        # noqa: PLC0415
    import traceback   # noqa: PLC0415

    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio file")

    t0 = time.monotonic()
    try:
        import numpy as np       # noqa: PLC0415
        import soundfile as sf   # noqa: PLC0415
        from gender_service_ml import MLGenderService  # noqa: PLC0415

        # Decode WAV → mono float32 → int16 PCM bytes (MLGenderService buffer format)
        audio_float, sr = sf.read(io.BytesIO(audio_bytes), dtype="float32", always_2d=False)
        if audio_float.ndim > 1:
            audio_float = audio_float.mean(axis=1)
        pcm_bytes = (audio_float * 32768.0).astype(np.int16).tobytes()

        svc = MLGenderService(enabled=True, sample_rate=int(sr))
        svc._buffer.extend(pcm_bytes)
        svc._run_detection()

        result = svc.get_result()
        gender = result.get("gender", "neutral")
        estimated_gender = gender if gender in ("male", "female") else "unknown"
        return {
            "estimated_gender": estimated_gender,
            "confidence": result.get("confidence", 0.0),
            "processing_time_ms": int((time.monotonic() - t0) * 1000),
        }
    except Exception as exc:  # noqa: BLE001
        # Never 500 on decode/processing failures — the orchestrator treats any
        # non-200 as a hard error. Log the real exception and degrade gracefully.
        # Full exception + traceback go to the server logs only; the response
        # carries a generic, client-safe flag (no internal details leaked).
        print(
            f"[gender-ml-v2] handler failure: {type(exc).__name__}: {exc}\n{traceback.format_exc()}",
            flush=True,
        )
        return {
            "estimated_gender": "unknown",
            "confidence": 0.0,
            "processing_time_ms": int((time.monotonic() - t0) * 1000),
            "error": "processing_failed",
        }



# ── Register router & run ─────────────────────────────────────────────────────

app.include_router(router)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False, log_level="info")
