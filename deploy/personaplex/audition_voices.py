#!/usr/bin/env python3
"""Record a few seconds of Irfan from each male PersonaPlex voice.

Stop pcm_bridge first — moshi.server allows one live /api/chat.
Does not stop moshi.server. Writes 8 kHz wavs.
"""
from __future__ import annotations

import asyncio
import sys
import time
import urllib.parse
import wave
from pathlib import Path

import numpy as np
import sphn
import websockets

from pcm_bridge import (  # type: ignore
    IRFAN_PERSONA,
    MOSHI_RATE,
    OPUS_FRAME_24,
    SNAP_RATE,
    dither_f32,
    downsample_24_to_8,
    f32_to_i16,
    moshi_ssl,
    pcm_rms,
    voice_prompt_name,
)

MOSHI_URL = "wss://127.0.0.1:8998/api/chat"
MALE_VOICES = (
    "NATM0", "NATM1", "NATM2", "NATM3",
    "VARM0", "VARM1", "VARM2", "VARM3", "VARM4",
)
OUT_DIR = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/personaplex-voices")
LISTEN_S = 8.0
MIN_SPEECH_RMS = 80.0


def chat_url(voice: str) -> str:
    params = urllib.parse.urlencode({
        "voice_prompt": voice_prompt_name(voice),
        "text_prompt": IRFAN_PERSONA,
    })
    return f"{MOSHI_URL}?{params}"


async def capture(voice: str, dest: Path) -> int:
    ssl_ctx = moshi_ssl()
    url = chat_url(voice)
    writer = sphn.OpusStreamWriter(MOSHI_RATE)
    reader = sphn.OpusStreamReader(MOSHI_RATE)
    pending_24 = np.zeros(0, dtype=np.int16)
    collected = np.zeros(0, dtype=np.int16)
    t0 = time.monotonic()
    handshake = False
    async with websockets.connect(url, ssl=ssl_ctx, max_size=None, open_timeout=30, ping_interval=None) as ws:
        while time.monotonic() - t0 < 20:
            try:
                message = await asyncio.wait_for(ws.recv(), timeout=2.0)
            except TimeoutError:
                if handshake:
                    break
                continue
            if not isinstance(message, (bytes, bytearray)) or len(message) == 0:
                continue
            kind = message[0]
            payload = message[1:]
            if kind == 0x00:
                handshake = True
                print(f"{voice} handshake_ms={(time.monotonic() - t0) * 1000:.0f}", flush=True)
                start = time.monotonic()
                while time.monotonic() - start < LISTEN_S:
                    writer.append_pcm(dither_f32(OPUS_FRAME_24))
                    blob = writer.read_bytes()
                    if blob:
                        await ws.send(b"\x01" + blob)
                    try:
                        out = await asyncio.wait_for(ws.recv(), timeout=OPUS_FRAME_24 / MOSHI_RATE + 0.05)
                    except TimeoutError:
                        continue
                    if not isinstance(out, (bytes, bytearray)) or len(out) == 0:
                        continue
                    if out[0] != 0x01 or len(out) < 2:
                        continue
                    reader.append_bytes(out[1:])
                    pcm_f = reader.read_pcm()
                    if pcm_f is None or np.asarray(pcm_f).size == 0:
                        continue
                    pcm24 = f32_to_i16(np.asarray(pcm_f).reshape(-1))
                    pending_24 = np.concatenate([pending_24, pcm24])
                    emit_n = (pending_24.size // 3) * 3
                    if emit_n == 0:
                        continue
                    collected = np.concatenate([collected, downsample_24_to_8(pending_24[:emit_n])])
                    pending_24 = pending_24[emit_n:]
                break
    dest.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(dest), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(SNAP_RATE)
        wav.writeframes(collected.tobytes())
    speech = int(pcm_rms(collected) >= MIN_SPEECH_RMS)
    print(f"{voice} samples={collected.size} rms={pcm_rms(collected):.0f} speech={speech} -> {dest}", flush=True)
    return collected.size


async def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for voice in MALE_VOICES:
        await capture(voice, OUT_DIR / f"{voice}.wav")
        await asyncio.sleep(0.5)


if __name__ == "__main__":
    asyncio.run(main())
