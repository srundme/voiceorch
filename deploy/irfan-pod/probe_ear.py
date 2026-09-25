"""Play a WAV into /v1/stt in real time and time the transcripts against the end of speech.

/workspace/envs/tts/bin/python probe_ear.py WAV [WS_URL]
"""
import asyncio
import json
import sys
import time
import wave

import aiohttp
import numpy as np
import soxr

WAV = sys.argv[1]
URL = sys.argv[2] if len(sys.argv) > 2 else "ws://127.0.0.1:8787/v1/stt"
FRAME = 320  # 20 ms at 16 kHz


async def main() -> None:
    with wave.open(WAV) as w:
        rate = w.getframerate()
        audio = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)
    if rate != 16000:
        audio = soxr.resample(audio, rate, 16000).astype(np.int16)
    audio = np.concatenate([audio, np.zeros(16000 * 2, dtype=np.int16)])
    speech_end = None
    async with aiohttp.ClientSession() as session, session.ws_connect(URL) as ws:

        async def read() -> None:
            async for msg in ws:
                data = json.loads(msg.data)
                ref = speech_end or time.monotonic()
                kind = "FINAL  " if data["is_final"] else "partial"
                print(f"{kind} {time.monotonic() - ref:+.2f}s after speech end | {data['text']}")
                if data["is_final"]:
                    return

        reader = asyncio.create_task(read())
        speech_samples = len(audio) - 16000 * 2
        start = time.monotonic()
        for i in range(0, len(audio), FRAME):
            if speech_end is None and i >= speech_samples:
                speech_end = time.monotonic()
            await ws.send_bytes(audio[i : i + FRAME].tobytes())
            await asyncio.sleep(max(0.0, start + (i + FRAME) / 16000 - time.monotonic()))
        await asyncio.wait_for(reader, timeout=5)


asyncio.run(main())
