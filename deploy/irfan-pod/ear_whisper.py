"""Irfan's ear: Whisper large-v3-turbo.

English letters only. The front door already decided the end of the turn,
so this server does not run its own voice-activity gate.
"""
from __future__ import annotations

import inspect
import io
import os
import re
import time
import wave

import numpy as np
from aiohttp import web
from faster_whisper import WhisperModel

MODEL = os.environ.get("IRFAN_EAR_MODEL", "/workspace/models/whisper-large-v3-turbo")
PORT = 8001
SAMPLE_RATE = 16000

model = WhisperModel(MODEL, device="cuda", compute_type="float16")
_HAS_HOTWORDS = "hotwords" in inspect.signature(model.transcribe).parameters


def log(msg: str) -> None:
    print(time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()) + " " + msg, flush=True)


def to_audio(data: bytes) -> np.ndarray:
    if data[:4] == b"RIFF":
        with wave.open(io.BytesIO(data)) as handle:
            rate = handle.getframerate()
            pcm = np.frombuffer(handle.readframes(handle.getnframes()), dtype=np.int16)
    else:
        rate = SAMPLE_RATE
        pcm = np.frombuffer(data, dtype=np.int16)
    audio = pcm.astype(np.float32) / 32768.0
    if rate != SAMPLE_RATE and len(audio):
        import soxr
        audio = soxr.resample(audio, rate, SAMPLE_RATE).astype(np.float32)
    return audio


def trim(audio: np.ndarray) -> np.ndarray:
    loud = np.flatnonzero(np.abs(audio) > 0.01)
    if len(loud) == 0:
        return audio[: SAMPLE_RATE // 5]
    start = max(0, int(loud[0]) - SAMPLE_RATE // 20)
    end = min(len(audio), int(loud[-1]) + SAMPLE_RATE // 10)
    return audio[start:end]


def cut_repeat(text: str) -> str:
    """Drop a letter loop. Spelling was coming back as K-O-K-O until the turn ended."""
    match = re.search(r"((?:[A-Za-z][- ]){1,6}?)\1{3,}", text)
    if not match:
        return text
    return text[:match.start()].rstrip(" -,")


def transcribe(audio: np.ndarray, prompt: str) -> str:
    audio = trim(audio)
    if len(audio) < SAMPLE_RATE // 5:
        return ""
    kwargs = {
        "language": "en",
        "task": "transcribe",
        "beam_size": 5,
        "best_of": 5,
        "temperature": 0.0,
        "vad_filter": False,
        "without_timestamps": True,
        "condition_on_previous_text": False,
    }
    # A word list passed as initial_prompt is previous text, so the model
    # continues it. Hotwords only bias the vocabulary.
    if prompt and _HAS_HOTWORDS:
        kwargs["hotwords"] = prompt
    segments, _info = model.transcribe(audio, **kwargs)
    text = " ".join(segment.text.strip() for segment in segments).strip()
    return cut_repeat(text)


async def health(_request: web.Request) -> web.Response:
    return web.json_response({"ok": True, "model": "whisper-large-v3-turbo"})


async def transcriptions(request: web.Request) -> web.Response:
    prompt = ""
    if request.content_type.startswith("multipart/"):
        form = await request.post()
        field = form.get("file")
        data = field.file.read() if hasattr(field, "file") else bytes(field)
        raw_prompt = form.get("prompt")
        if isinstance(raw_prompt, str):
            prompt = raw_prompt.strip()
    else:
        data = await request.read()
    started = time.monotonic()
    text = transcribe(to_audio(data), prompt)
    log(f"ear {len(data)} bytes in {time.monotonic() - started:.2f}s: {text[:80]}")
    return web.json_response({"text": text})


def main() -> None:
    rng = np.random.default_rng(0)
    for seconds in (2, 4, 8):
        transcribe(rng.normal(0, 0.01, SAMPLE_RATE * seconds).astype(np.float32), "")
    log(f"listen 0.0.0.0:{PORT}")
    app = web.Application(client_max_size=20 * 1024 * 1024)
    app.router.add_get("/health", health)
    app.router.add_post("/v1/audio/transcriptions", transcriptions)
    web.run_app(app, host="0.0.0.0", port=PORT, print=None)


if __name__ == "__main__":
    main()
