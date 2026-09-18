#!/usr/bin/env python3
"""No-telephony PersonaPlex latency probe against local pcm_bridge.

Measures handshake (prompt bake) and first model audio without VoBiz/Railway.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import time

import numpy as np
import websockets

HELLO = {
    "type": "hello",
    "voice": "NATM1",
    "textPrompt": (
        "You work for Jobshop, a recruitment firm in India, and your name is Irfan. "
        "Speak short warm Indian English. Never say you are an AI. "
        'Speak first: "Hello, this is Irfan from Jobshop. How may I assist you?"'
    ),
    "sampleRate": 8000,
}


async def probe(url: str, seconds: float) -> None:
    silence = np.zeros(160, dtype="<i2").tobytes()
    t0 = time.monotonic()
    ready_at = first_pcm_at = None
    pcm_bytes = 0
    async with websockets.connect(url, max_size=None, open_timeout=30) as ws:
        await ws.send(json.dumps(HELLO))
        hello_at = time.monotonic()
        print(f"hello_sent_ms={(hello_at - t0) * 1000:.0f}")

        async def feed() -> None:
            while time.monotonic() - t0 < seconds:
                await ws.send(silence)
                await asyncio.sleep(0.02)

        async def recv() -> None:
            nonlocal ready_at, first_pcm_at, pcm_bytes
            async for msg in ws:
                if isinstance(msg, (bytes, bytearray)):
                    if len(msg) >= 2 and msg[:1] not in (b"{", b"["):
                        pcm_bytes += len(msg)
                        if first_pcm_at is None:
                            first_pcm_at = time.monotonic()
                            print(
                                f"T2_first_pcm handshake_to_audio_ms="
                                f"{(first_pcm_at - (ready_at or hello_at)) * 1000:.0f} "
                                f"hello_to_audio_ms={(first_pcm_at - hello_at) * 1000:.0f}"
                            )
                    continue
                try:
                    data = json.loads(msg)
                except json.JSONDecodeError:
                    continue
                if data.get("type") == "ready" and ready_at is None:
                    ready_at = time.monotonic()
                    print(f"handshake_ready_ms={(ready_at - hello_at) * 1000:.0f}")
                elif data.get("type") == "text" and data.get("text"):
                    print(f"text={data['text']!r}")

        try:
            await asyncio.wait_for(
                asyncio.gather(feed(), recv()),
                timeout=seconds + 5,
            )
        except asyncio.TimeoutError:
            pass
        except Exception as exc:
            print(f"probe_error={exc}")

    print(
        f"done ready={'yes' if ready_at else 'no'} "
        f"first_pcm={'yes' if first_pcm_at else 'no'} "
        f"pcm_bytes={pcm_bytes}"
    )


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--url", default="ws://127.0.0.1:9000")
    p.add_argument("--seconds", type=float, default=12)
    args = p.parse_args()
    asyncio.run(probe(args.url, args.seconds))


if __name__ == "__main__":
    main()
