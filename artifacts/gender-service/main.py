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
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel


async def _bg_warmup() -> None:
    """Import librosa in a thread so the first real request is not slow.

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


# ── Register router & run ─────────────────────────────────────────────────────

app.include_router(router)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False, log_level="info")
