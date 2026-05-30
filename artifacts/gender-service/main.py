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

import io
import math
import os
import struct

import httpx
import uvicorn
from fastapi import APIRouter, FastAPI, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# gender_detector is imported lazily (inside each handler) so uvicorn binds
# to the port immediately. librosa/numpy JIT compilation happens in the
# background warmup thread and does not block server startup.


def _make_warmup_wav() -> bytes:
    """Generate a minimal 0.5-second 200 Hz WAV for warmup — no deps needed."""
    sr, freq, dur = 16_000, 200, 0.5
    n = int(sr * dur)
    samples = [int(32767 * math.sin(2 * math.pi * freq * i / sr)) for i in range(n)]
    data = struct.pack(f"<{n}h", *samples)
    hdr = (
        b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVE" +
        b"fmt " + struct.pack("<I", 16) +
        struct.pack("<HHIIHH", 1, 1, sr, sr * 2, 2, 16) +
        b"data" + struct.pack("<I", len(data))
    )
    return hdr + data

# ── App setup ─────────────────────────────────────────────────────────────────

app = FastAPI(
    title="SnapServe Voice Analysis",
    version="1.0.0",
    description="Real-time speaker characteristic detection from audio",
)


@app.on_event("startup")
async def _warmup():
    """
    Pre-load librosa / numpy JIT so the first real request isn't slow.

    Runs in a thread so the server binds to port 5000 immediately.
    The deployment health check responds right away; librosa loads in the
    background (~40 s on cold start). Any gender request that arrives before
    warmup finishes pays the cold-start cost once — subsequent calls are fast.
    """
    import asyncio, concurrent.futures
    loop = asyncio.get_event_loop()
    def _do_warmup():
        try:
            from gender_detector import classify_audio_bytes  # noqa: PLC0415
            classify_audio_bytes(_make_warmup_wav())
        except Exception:
            pass
    loop.run_in_executor(concurrent.futures.ThreadPoolExecutor(max_workers=1), _do_warmup)


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


# ── Register router & run ─────────────────────────────────────────────────────

app.include_router(router)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False, log_level="info")
