"""Irfan's front door on the GPU pod. No models load here.

Ear, brain and voice each run in their own vLLM server:
  ear    Qwen3-ASR-1.7B        :8001  (start-ear.sh)
  brain  Qwen3-32B-AWQ         :8000  (start-brain.sh)
  voice  Qwen3-TTS Base clone  :8091  (start-tts.sh)

SnapServe calls:
  GET  /health
  WS   /v1/stt                    PCM16 mono 16 kHz in, JSON transcripts out
  POST /v1/audio/transcriptions   PCM16 mono 16 kHz body -> {"text": ...}
  POST /v1/chat/completions       OpenAI streaming chat, including tool calls
  POST /v1/audio/speech           JSON {"input": "..."} -> chunked PCM16 mono 16 kHz
"""

from __future__ import annotations

import asyncio
import io
import json
import os
import time
import wave

import aiohttp
import numpy as np
import soxr
from aiohttp import WSMsgType, web

EAR_URL = os.environ.get("IRFAN_EAR_URL", "http://127.0.0.1:8001")
BRAIN_URL = os.environ.get("IRFAN_BRAIN_URL", "http://127.0.0.1:8000")
VOICE_URL = os.environ.get("IRFAN_VOICE_URL", "http://127.0.0.1:8091")
VOICE_NAME = os.environ.get("IRFAN_VOICE_NAME", "irfan")
PORT = int(os.environ.get("IRFAN_POD_PORT", "8787"))

SAMPLE_RATE = 16000
VOICE_RATE = 24000
SPEECH_RMS = 0.01
SILENCE_MS = 450
MIN_SPEECH_MS = 250
PARTIAL_EVERY_MS = 600

http: aiohttp.ClientSession | None = None


def log(msg: str) -> None:
    print(time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()) + " " + msg, flush=True)


def rms(pcm: bytes) -> float:
    audio = np.frombuffer(pcm[: len(pcm) // 2 * 2], dtype=np.int16).astype(np.float32) / 32768.0
    if len(audio) == 0:
        return 0.0
    return float(np.sqrt(np.mean(np.square(audio))))


def to_wav(pcm: bytes) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(pcm)
    return buf.getvalue()


async def transcribe(pcm: bytes) -> str:
    if len(pcm) < SAMPLE_RATE // 5 * 2:
        return ""
    form = aiohttp.FormData()
    form.add_field("file", to_wav(pcm), filename="audio.wav", content_type="audio/wav")
    form.add_field("model", "irfan-ear")
    form.add_field("language", "en")
    async with http.post(f"{EAR_URL}/v1/audio/transcriptions", data=form) as resp:
        if resp.status != 200:
            log(f"ear HTTP {resp.status}: {(await resp.text())[:200]}")
            return ""
        return str((await resp.json()).get("text") or "").strip()


async def upstream_ok(url: str) -> bool:
    try:
        async with http.get(f"{url}/health", timeout=aiohttp.ClientTimeout(total=3)) as resp:
            return resp.status == 200
    except (aiohttp.ClientError, asyncio.TimeoutError):
        return False


async def health(_request: web.Request) -> web.Response:
    ear, brain, voice = await asyncio.gather(upstream_ok(EAR_URL), upstream_ok(BRAIN_URL), upstream_ok(VOICE_URL))
    return web.json_response({"ok": ear and brain and voice, "ear": ear, "brain": brain, "voice": voice})


async def transcribe_http(request: web.Request) -> web.Response:
    return web.json_response({"text": await transcribe(await request.read())})


async def speech(request: web.Request) -> web.StreamResponse:
    body = await request.json()
    text = str(body.get("input") or body.get("text") or "").strip()
    payload = {
        "input": text,
        "voice": VOICE_NAME,
        "language": "English",
        "stream": True,
        "stream_format": "audio",
        "response_format": "pcm",
    }
    started = time.monotonic()
    first = None
    out = web.StreamResponse(status=200, headers={"Content-Type": "audio/L16"})
    resampler = soxr.ResampleStream(VOICE_RATE, SAMPLE_RATE, 1, dtype="int16", quality="HQ")
    carry = b""
    async with http.post(f"{VOICE_URL}/v1/audio/speech", json=payload) as upstream:
        if upstream.status != 200:
            detail = (await upstream.text())[:200]
            log(f"voice HTTP {upstream.status}: {detail}")
            return web.Response(status=502, text=f"voice HTTP {upstream.status}")
        await out.prepare(request)
        try:
            async for chunk in upstream.content.iter_any():
                data = carry + chunk
                even = len(data) // 2 * 2
                carry = data[even:]
                if not even:
                    continue
                pcm = resampler.resample_chunk(np.frombuffer(data[:even], dtype=np.int16))
                if len(pcm):
                    if first is None:
                        first = time.monotonic() - started
                    await out.write(pcm.tobytes())
            tail = resampler.resample_chunk(np.zeros(0, dtype=np.int16), last=True)
            if len(tail):
                await out.write(tail.tobytes())
        except ConnectionResetError:
            return out
    log(f"speak {len(text)} chars first={first or 0:.2f}s total={time.monotonic() - started:.2f}s")
    await out.write_eof()
    return out


async def chat(request: web.Request) -> web.StreamResponse:
    body = await request.json()
    body["model"] = "irfan-brain"
    out = web.StreamResponse(
        status=200,
        headers={"Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive"},
    )
    async with http.post(f"{BRAIN_URL}/v1/chat/completions", json=body) as upstream:
        if upstream.status != 200:
            detail = await upstream.text()
            log(f"brain HTTP {upstream.status}: {detail[:300]}")
            return web.Response(status=upstream.status, text=detail, content_type="application/json")
        await out.prepare(request)
        try:
            async for chunk in upstream.content.iter_any():
                await out.write(chunk)
        except ConnectionResetError:
            return out
    await out.write_eof()
    return out


class Utterance:
    def __init__(self) -> None:
        self.buf = bytearray()
        self.speech_ms = 0.0
        self.silence_ms = 0.0
        self.in_speech = False
        self.last_partial_at = 0.0
        self.last_text = ""

    def reset(self) -> None:
        self.__init__()


async def stt_socket(request: web.Request) -> web.WebSocketResponse:
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    utter = Utterance()
    infer_lock = asyncio.Lock()

    async def send(text: str, final: bool) -> None:
        if not ws.closed:
            await ws.send_str(json.dumps({"text": text, "is_final": final}))

    async def run_asr(final: bool) -> None:
        if infer_lock.locked() and not final:
            return
        async with infer_lock:
            pcm = bytes(utter.buf)
            started = time.monotonic()
            text = await transcribe(pcm)
            if final:
                log(f"hear final {len(pcm) / 2 / SAMPLE_RATE:.1f}s audio in {time.monotonic() - started:.2f}s: {text[:80]}")
                utter.reset()
                if text:
                    await send(text, True)
                return
            if text and text != utter.last_text:
                utter.last_text = text
                await send(text, False)

    async for msg in ws:
        if msg.type == WSMsgType.ERROR:
            break
        if msg.type != WSMsgType.BINARY or not msg.data:
            continue
        pcm = msg.data
        frame_ms = (len(pcm) / 2) / SAMPLE_RATE * 1000
        if rms(pcm) >= SPEECH_RMS:
            if not utter.in_speech:
                utter.in_speech = True
                utter.buf.clear()
                utter.speech_ms = 0.0
            utter.buf.extend(pcm)
            utter.speech_ms += frame_ms
            utter.silence_ms = 0.0
            if (
                utter.speech_ms >= MIN_SPEECH_MS
                and (time.monotonic() - utter.last_partial_at) * 1000 >= PARTIAL_EVERY_MS
            ):
                utter.last_partial_at = time.monotonic()
                asyncio.create_task(run_asr(False))
            continue
        if not utter.in_speech:
            continue
        utter.buf.extend(pcm)
        utter.silence_ms += frame_ms
        if utter.silence_ms >= SILENCE_MS and utter.speech_ms >= MIN_SPEECH_MS:
            await run_asr(True)

    return ws


def main() -> None:
    app = web.Application()

    async def open_http(_app: web.Application) -> None:
        global http
        http = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=120))

    async def close_http(_app: web.Application) -> None:
        if http is not None:
            await http.close()

    app.on_startup.append(open_http)
    app.on_cleanup.append(close_http)
    app.router.add_get("/health", health)
    app.router.add_post("/v1/audio/transcriptions", transcribe_http)
    app.router.add_post("/v1/audio/speech", speech)
    app.router.add_post("/v1/chat/completions", chat)
    app.router.add_get("/v1/stt", stt_socket)
    log(f"listen 0.0.0.0:{PORT}")
    web.run_app(app, host="0.0.0.0", port=PORT, print=None)


if __name__ == "__main__":
    main()
