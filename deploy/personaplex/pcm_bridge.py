#!/usr/bin/env python3
"""PCM bridge: SnapServe 8 kHz s16le ↔ NVIDIA moshi.server OGG Opus 24 kHz.

SnapServe protocol (this port, default 9000):
  1. First text frame: {"type":"hello","voice":"NATM1","textPrompt":"...","sampleRate":8000}
  2. Then binary frames: little-endian PCM16 mono @ 8 kHz
  3. We send: text {"type":"ready"} then binary PCM16 @ 8 kHz
     and text {"type":"text","role":"assistant","text":"..."} for Moshi tokens.

Moshi protocol (wss://127.0.0.1:8998/api/chat):
  kind 0x00 handshake, 0x01 + opus, 0x02 + utf-8 text.
  Client sends 0x01 + opus.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import ssl
import urllib.parse

import numpy as np
import sphn
import websockets

logging.basicConfig(level=logging.INFO, format="%(asctime)s pcm_bridge %(levelname)s %(message)s")
log = logging.getLogger("pcm_bridge")

MOSHI_URL = os.environ.get("MOSHI_URL", "wss://127.0.0.1:8998/api/chat")
LISTEN_HOST = os.environ.get("PCM_BRIDGE_HOST", "0.0.0.0")
LISTEN_PORT = int(os.environ.get("PCM_BRIDGE_PORT", "9000"))
MOSHI_RATE = 24000
SNAP_RATE = 8000
# sphn OpusStreamWriter only accepts these 24 kHz frame sizes.
OPUS_FRAME_24 = 960  # 40 ms


def upsample_8_to_24(pcm_i16: np.ndarray) -> np.ndarray:
    if pcm_i16.size == 0:
        return pcm_i16
    n = pcm_i16.shape[0]
    t = np.linspace(0, n - 1, n * 3, endpoint=False)
    return np.interp(t, np.arange(n), pcm_i16.astype(np.float64)).astype(np.int16)


def downsample_24_to_8(pcm_i16: np.ndarray) -> np.ndarray:
    n = (pcm_i16.size // 3) * 3
    if n == 0:
        return np.zeros(0, dtype=np.int16)
    grouped = pcm_i16[:n].astype(np.float32).reshape(-1, 3).mean(axis=1)
    return np.clip(grouped, -32768, 32767).astype(np.int16)


def i16_to_f32(pcm: np.ndarray) -> np.ndarray:
    return pcm.astype(np.float32) / 32768.0


def f32_to_i16(pcm: np.ndarray) -> np.ndarray:
    return np.clip(np.asarray(pcm, dtype=np.float32) * 32768.0, -32768, 32767).astype(np.int16)


def moshi_ssl() -> ssl.SSLContext:
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


async def handle_snapserve(snap_ws) -> None:
    raw = await snap_ws.recv()
    if isinstance(raw, bytes):
        hello = json.loads(raw.decode("utf-8"))
    else:
        hello = json.loads(raw)
    voice = str(hello.get("voice") or "NATM1").replace(".pt", "")
    text_prompt = str(hello.get("textPrompt") or "")
    params = urllib.parse.urlencode({
        "voice_prompt": f"{voice}.pt",
        "text_prompt": text_prompt,
    })
    moshi_url = f"{MOSHI_URL}?{params}"
    log.info("opening moshi voice=%s prompt_chars=%s", voice, len(text_prompt))

    opus_writer = sphn.OpusStreamWriter(MOSHI_RATE)
    opus_reader = sphn.OpusStreamReader(MOSHI_RATE)
    close = False
    pending_24 = np.zeros(0, dtype=np.int16)
    pending_in_24 = np.zeros(0, dtype=np.int16)

    ssl_ctx = moshi_ssl() if moshi_url.startswith("wss://") else None

    try:
        async with websockets.connect(moshi_url, ssl=ssl_ctx, max_size=None) as moshi:
            async def snap_to_moshi() -> None:
                nonlocal close, pending_in_24
                try:
                    async for message in snap_ws:
                        if close:
                            return
                        if isinstance(message, str):
                            try:
                                ctrl = json.loads(message)
                            except json.JSONDecodeError:
                                continue
                            if ctrl.get("type") == "speak":
                                # Moshi has no text-inject on the live socket; ignore.
                                continue
                            continue
                        pcm8 = np.frombuffer(message, dtype="<i2")
                        pending_in_24 = np.concatenate([pending_in_24, upsample_8_to_24(pcm8)])
                        while pending_in_24.size >= OPUS_FRAME_24:
                            frame = pending_in_24[:OPUS_FRAME_24]
                            pending_in_24 = pending_in_24[OPUS_FRAME_24:]
                            opus_writer.append_pcm(i16_to_f32(frame))
                            blob = opus_writer.read_bytes()
                            if len(blob) > 0:
                                await moshi.send(b"\x01" + blob)
                finally:
                    close = True

            async def moshi_to_snap() -> None:
                nonlocal close, pending_24
                try:
                    async for message in moshi:
                        if close:
                            return
                        if not isinstance(message, (bytes, bytearray)) or len(message) == 0:
                            continue
                        kind = message[0]
                        payload = message[1:]
                        if kind == 0x00:
                            await snap_ws.send(json.dumps({"type": "ready"}))
                            log.info("moshi handshake → snapserve ready")
                            continue
                        if kind == 0x02:
                            token = payload.decode("utf-8", errors="replace")
                            if token:
                                await snap_ws.send(json.dumps({
                                    "type": "text",
                                    "role": "assistant",
                                    "text": token,
                                }))
                            continue
                        if kind != 0x01 or not payload:
                            continue
                        opus_reader.append_bytes(payload)
                        pcm_f = opus_reader.read_pcm()
                        if pcm_f is None or np.asarray(pcm_f).size == 0:
                            continue
                        pcm24 = f32_to_i16(np.asarray(pcm_f).reshape(-1))
                        pending_24 = np.concatenate([pending_24, pcm24])
                        emit_n = (pending_24.size // 3) * 3
                        if emit_n == 0:
                            continue
                        pcm8 = downsample_24_to_8(pending_24[:emit_n])
                        pending_24 = pending_24[emit_n:]
                        await snap_ws.send(pcm8.tobytes())
                finally:
                    close = True

            done, pending = await asyncio.wait(
                [
                    asyncio.create_task(snap_to_moshi()),
                    asyncio.create_task(moshi_to_snap()),
                ],
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()
            for task in done:
                exc = task.exception()
                if exc:
                    log.warning("bridge task failed: %s", exc)
    except Exception as exc:
        log.exception("moshi connect failed")
        try:
            await snap_ws.send(json.dumps({"type": "error", "error": str(exc)}))
        except Exception:
            pass


async def main() -> None:
    log.info("listening ws://%s:%s  →  %s", LISTEN_HOST, LISTEN_PORT, MOSHI_URL)
    async with websockets.serve(handle_snapserve, LISTEN_HOST, LISTEN_PORT, max_size=None):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
