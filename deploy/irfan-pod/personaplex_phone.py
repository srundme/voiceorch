"""Full-duplex phone bridge. Vobiz 8 kHz frames in, Sruthi's PersonaPlex audio out."""
from __future__ import annotations

import asyncio
import base64
import json
import os
import time

import aiohttp
from aiohttp import WSMsgType, web

from phone_audio import LineCleaner

DUPLEX_URL = os.environ.get("PERSONAPLEX_WS", "ws://127.0.0.1:8998/duplex")
PHONE_RATE = 8000
FRAME_BYTES = 320  # 20 ms at 8 kHz, 16-bit


def log(msg: str) -> None:
    print(f"[orch] {msg}", flush=True)


async def personaplex_socket(request: web.Request) -> web.WebSocketResponse:
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    stream_id = ""
    closed = False
    cleaner = LineCleaner()
    played = bytearray()
    http: aiohttp.ClientSession = request.app["http"]

    async def send(payload: dict) -> None:
        if not ws.closed:
            await ws.send_str(json.dumps(payload))

    async def play(duplex: aiohttp.ClientWebSocketResponse) -> None:
        nonlocal closed
        while not closed:
            msg = await duplex.receive()
            if msg.type in (WSMsgType.CLOSE, WSMsgType.CLOSED, WSMsgType.ERROR):
                closed = True
                return
            if msg.type == WSMsgType.TEXT:
                try:
                    data = json.loads(msg.data)
                except json.JSONDecodeError:
                    continue
                piece = str(data.get("text") or "")
                if piece:
                    log(f"sruthi {piece}")
                continue
            if msg.type != WSMsgType.BINARY or not msg.data:
                continue
            played.extend(msg.data)
            while len(played) >= FRAME_BYTES and not closed:
                frame = bytes(played[:FRAME_BYTES])
                del played[:FRAME_BYTES]
                cleaner.render(frame)
                await send({
                    "event": "playAudio",
                    "media": {
                        "contentType": "audio/x-l16",
                        "sampleRate": PHONE_RATE,
                        "payload": base64.b64encode(frame).decode(),
                    },
                })
                await asyncio.sleep(0.02)

    try:
        duplex = await http.ws_connect(DUPLEX_URL, heartbeat=20)
    except (aiohttp.ClientError, OSError) as exc:
        log(f"personaplex down {exc}")
        await ws.close()
        return ws
    player = asyncio.create_task(play(duplex))
    try:
        async for msg in ws:
            if msg.type != WSMsgType.TEXT:
                continue
            try:
                data = json.loads(msg.data)
            except json.JSONDecodeError:
                continue
            event = data.get("event")
            if event == "start":
                start = data.get("start") or {}
                stream_id = str(start.get("streamId") or data.get("streamId") or "")
                log(f"start {stream_id} personaplex")
            elif event == "media" and not closed:
                payload = ((data.get("media") or {}).get("payload")) or ""
                if not payload:
                    continue
                raw = base64.b64decode(payload)
                cleaned = cleaner.capture(raw)
                if cleaned and not duplex.closed:
                    await duplex.send_bytes(cleaned)
            elif event == "stop":
                closed = True
                break
    finally:
        closed = True
        if not duplex.closed:
            await duplex.close()
        player.cancel()
        await asyncio.gather(player, return_exceptions=True)
        if stream_id:
            log(f"stop {stream_id} at {time.strftime('%H:%M:%S')}")
        if not ws.closed:
            await send({"event": "stop", "streamId": stream_id})
            await ws.close()
    return ws
