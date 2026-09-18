#!/usr/bin/env python3
"""PCM bridge: SnapServe 8 kHz s16le ↔ NVIDIA moshi.server OGG Opus 24 kHz.

Every new Moshi /api/chat bakes the text prompt before handshake (~3–8s).
That is not a usable ring-to-speech for a phone line. This process keeps one
warm Moshi session past handshake, buffers the greeting, and attaches the
next SnapServe call to it so ready+audio are immediate. After hangup it
rebakes in the background for the following call.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import ssl
import time
import urllib.parse
from dataclasses import dataclass, field

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
SNAP_FRAME = 160
OPUS_FRAME_24 = 960
HANDSHAKE_S = float(os.environ.get("MOSHI_HANDSHAKE_TIMEOUT_S", "20"))
WARM_VOICE = os.environ.get("PERSONAPLEX_VOICE", "NATM1").replace(".pt", "")
WARM_PROMPT = os.environ.get(
    "PERSONAPLEX_WARM_PROMPT",
    "You are Irfan at Jobshop, a recruitment firm in India. "
    "Answer the phone. Ask why they called. Do not invent jobs, cities, or salaries. "
    "Never ask for their phone number. Never say you are an AI. "
    'Speak first: "Hello, this is Irfan from Jobshop."',
)
GREETING_MAX_S = 5.0
GREETING_SILENCE_RMS = 250


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


def pcm_rms(pcm_i16: np.ndarray) -> float:
    if pcm_i16.size == 0:
        return 0.0
    x = pcm_i16.astype(np.float64)
    return float(np.sqrt(np.mean(x * x)))


def moshi_ssl() -> ssl.SSLContext:
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def moshi_chat_url(voice: str, prompt: str) -> str:
    params = urllib.parse.urlencode({
        "voice_prompt": f"{voice}.pt",
        "text_prompt": prompt,
    })
    return f"{MOSHI_URL}?{params}"


@dataclass
class WarmSession:
    moshi: object
    opus_writer: object
    opus_reader: object
    greeting_8k: np.ndarray
    pending_24: np.ndarray
    pending_8: np.ndarray
    incoming: asyncio.Queue
    steal: asyncio.Event = field(default_factory=asyncio.Event)
    silence_task: asyncio.Task | None = None
    pump_task: asyncio.Task | None = None


async def _pump_moshi(moshi, incoming: asyncio.Queue) -> None:
    """Always drain Moshi so its send loop cannot fill and kill the session."""
    try:
        while True:
            incoming.put_nowait(await moshi.recv())
    except Exception as exc:
        incoming.put_nowait(exc)


async def _incoming_recv(incoming: asyncio.Queue, timeout: float):
    item = await asyncio.wait_for(incoming.get(), timeout=timeout)
    if isinstance(item, Exception):
        raise item
    return item


class WarmPool:
    """One baked Moshi chat, ready to steal for the next phone call."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._session: WarmSession | None = None
        self._ready = asyncio.Event()
        self._task: asyncio.Task | None = None

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._maintain(), name="moshi-warm")

    async def take(self) -> WarmSession | None:
        try:
            await asyncio.wait_for(self._ready.wait(), timeout=HANDSHAKE_S + 2)
        except TimeoutError:
            return None
        async with self._lock:
            sess = self._session
            self._session = None
            self._ready.clear()
            if sess is None:
                return None
            sess.steal.set()
            if sess.silence_task is not None:
                sess.silence_task.cancel()
            return sess

    def rearm(self) -> None:
        self.start()

    async def _maintain(self) -> None:
        while True:
            try:
                sess = await self._bake()
            except Exception:
                log.exception("warm bake failed — retry in 2s")
                await asyncio.sleep(2)
                continue
            async with self._lock:
                self._session = sess
                self._ready.set()
            log.info("warm moshi ready greeting_ms=%.0f", sess.greeting_8k.size / 8)
            steal_task = asyncio.create_task(sess.steal.wait())
            waiters = {steal_task}
            if sess.pump_task is not None:
                waiters.add(sess.pump_task)
            done, pending = await asyncio.wait(waiters, return_when=asyncio.FIRST_COMPLETED)
            for task in pending:
                task.cancel()
            if sess.pump_task in done and not sess.steal.is_set():
                log.warning("warm moshi died while idle — rebaking")
                async with self._lock:
                    if self._session is sess:
                        self._session = None
                        self._ready.clear()
                try:
                    await sess.moshi.close()
                except Exception:
                    pass
                continue
            return

    async def _bake(self) -> WarmSession:
        url = moshi_chat_url(WARM_VOICE, WARM_PROMPT)
        ssl_ctx = moshi_ssl() if url.startswith("wss://") else None
        log.info("warm bake voice=%s prompt_chars=%s", WARM_VOICE, len(WARM_PROMPT))
        moshi = await websockets.connect(
            url, ssl=ssl_ctx, max_size=None, open_timeout=30, ping_interval=20, ping_timeout=20,
        )
        writer = sphn.OpusStreamWriter(MOSHI_RATE)
        reader = sphn.OpusStreamReader(MOSHI_RATE)
        pending_24 = np.zeros(0, dtype=np.int16)
        pending_8 = np.zeros(0, dtype=np.int16)
        greeting = np.zeros(0, dtype=np.int16)
        steal = asyncio.Event()
        incoming: asyncio.Queue = asyncio.Queue()
        pump_task = asyncio.create_task(_pump_moshi(moshi, incoming), name="moshi-pump")
        t0 = time.monotonic()
        handshake = False
        heard_speech = False
        silent_ms = 0.0
        sil_task: asyncio.Task | None = None

        async def send_silence() -> None:
            while not steal.is_set():
                writer.append_pcm(np.zeros(OPUS_FRAME_24, dtype=np.float32))
                blob = writer.read_bytes()
                if len(blob) > 0:
                    try:
                        await moshi.send(b"\x01" + blob)
                    except Exception:
                        steal.set()
                        return
                await asyncio.sleep(OPUS_FRAME_24 / MOSHI_RATE)

        try:
            while True:
                try:
                    message = await _incoming_recv(
                        incoming,
                        HANDSHAKE_S if not handshake else 0.4,
                    )
                except TimeoutError:
                    if not handshake:
                        raise RuntimeError("warm handshake timed out")
                    if heard_speech and greeting.size >= SNAP_FRAME:
                        break
                    continue
                if not isinstance(message, (bytes, bytearray)) or len(message) == 0:
                    continue
                kind = message[0]
                payload = message[1:]
                if kind == 0x00:
                    handshake = True
                    log.info("warm handshake bake_ms=%.0f", (time.monotonic() - t0) * 1000)
                    # Moshi's is_alive() steals any audio sent during bake and then
                    # the session dies. Feed silence only after 0x00.
                    sil_task = asyncio.create_task(send_silence())
                    continue
                if kind != 0x01 or not payload:
                    continue
                reader.append_bytes(payload)
                pcm_f = reader.read_pcm()
                if pcm_f is None or np.asarray(pcm_f).size == 0:
                    continue
                pcm24 = f32_to_i16(np.asarray(pcm_f).reshape(-1))
                pending_24 = np.concatenate([pending_24, pcm24])
                emit_n = (pending_24.size // 3) * 3
                if emit_n == 0:
                    continue
                pcm8 = downsample_24_to_8(pending_24[:emit_n])
                pending_24 = pending_24[emit_n:]
                rms = pcm_rms(pcm8)
                if rms >= GREETING_SILENCE_RMS:
                    heard_speech = True
                    silent_ms = 0.0
                elif heard_speech:
                    silent_ms += 1000.0 * pcm8.size / SNAP_RATE
                greeting = np.concatenate([greeting, pcm8])
                if heard_speech and silent_ms >= 350:
                    break
                if (time.monotonic() - t0) > GREETING_MAX_S + HANDSHAKE_S:
                    break
        except Exception:
            if sil_task is not None:
                sil_task.cancel()
            pump_task.cancel()
            try:
                await moshi.close()
            except Exception:
                pass
            raise
        if not handshake:
            if sil_task is not None:
                sil_task.cancel()
            pump_task.cancel()
            await moshi.close()
            raise RuntimeError("warm bake closed before handshake")
        # Stop feeding silence so Moshi idles without filling the queue.
        # The pump keeps draining whatever leftover audio still arrives.
        if sil_task is not None:
            sil_task.cancel()
            sil_task = None
        return WarmSession(
            moshi=moshi,
            opus_writer=writer,
            opus_reader=reader,
            greeting_8k=greeting,
            pending_24=pending_24,
            pending_8=pending_8,
            incoming=incoming,
            steal=steal,
            silence_task=sil_task,
            pump_task=pump_task,
        )


POOL = WarmPool()


async def run_call(snap_ws, sess: WarmSession, t_hello: float, warm: bool) -> None:
    close = False
    pending_in_24 = np.zeros(0, dtype=np.int16)
    pending_24 = sess.pending_24
    pending_8 = sess.pending_8
    moshi = sess.moshi
    opus_writer = sess.opus_writer
    opus_reader = sess.opus_reader
    t_first_in = t_first_out = None

    async def abort() -> None:
        nonlocal close
        close = True
        if sess.pump_task is not None:
            sess.pump_task.cancel()
        try:
            await moshi.close()
        except Exception:
            pass

    async def snap_to_moshi() -> None:
        nonlocal close, pending_in_24, t_first_in
        try:
            async for message in snap_ws:
                if close:
                    return
                if isinstance(message, str):
                    continue
                if t_first_in is None:
                    t_first_in = time.monotonic()
                    log.info("latency T1_first_pcm_to_moshi_ms=%.0f", (t_first_in - t_hello) * 1000)
                pcm8 = np.frombuffer(message, dtype="<i2")
                pending_in_24 = np.concatenate([pending_in_24, upsample_8_to_24(pcm8)])
                while pending_in_24.size >= OPUS_FRAME_24:
                    frame = pending_in_24[:OPUS_FRAME_24]
                    pending_in_24 = pending_in_24[OPUS_FRAME_24:]
                    opus_writer.append_pcm(i16_to_f32(frame))
                    blob = opus_writer.read_bytes()
                    if len(blob) > 0:
                        await moshi.send(b"\x01" + blob)
        except Exception:
            log.exception("snap_to_moshi failed")
        finally:
            await abort()

    async def moshi_to_snap() -> None:
        nonlocal close, pending_24, pending_8, t_first_out
        try:
            while not close:
                try:
                    message = await asyncio.wait_for(sess.incoming.get(), timeout=1.0)
                except TimeoutError:
                    continue
                if isinstance(message, Exception):
                    raise message
                if close:
                    return
                if not isinstance(message, (bytes, bytearray)) or len(message) == 0:
                    continue
                kind = message[0]
                payload = message[1:]
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
                if t_first_out is None:
                    t_first_out = time.monotonic()
                    log.info(
                        "latency T2_live_opus_ms=%.0f warm=%s",
                        (t_first_out - t_hello) * 1000,
                        warm,
                    )
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
                pending_8 = np.concatenate([pending_8, pcm8])
                while pending_8.size >= SNAP_FRAME:
                    await snap_ws.send(pending_8[:SNAP_FRAME].tobytes())
                    pending_8 = pending_8[SNAP_FRAME:]
        except Exception:
            if not close:
                log.exception("moshi_to_snap failed")
        finally:
            await abort()

    try:
        await snap_ws.send(json.dumps({"type": "ready"}))
        log.info(
            "snapserve ready warm=%s attach_ms=%.0f greeting_bytes=%s",
            warm,
            (time.monotonic() - t_hello) * 1000,
            int(sess.greeting_8k.size * 2),
        )
        buf = sess.greeting_8k
        while buf.size >= SNAP_FRAME:
            await snap_ws.send(buf[:SNAP_FRAME].tobytes())
            buf = buf[SNAP_FRAME:]
        await asyncio.gather(snap_to_moshi(), moshi_to_snap(), return_exceptions=True)
    finally:
        await abort()


async def handle_snapserve(snap_ws) -> None:
    try:
        raw = await asyncio.wait_for(snap_ws.recv(), timeout=10)
    except Exception:
        return
    try:
        hello = json.loads(raw.decode("utf-8") if isinstance(raw, (bytes, bytearray)) else raw)
    except Exception:
        return
    voice = str(hello.get("voice") or WARM_VOICE).replace(".pt", "")
    t_hello = time.monotonic()
    log.info("snap hello voice=%s prompt_chars=%s", voice, len(str(hello.get("textPrompt") or "")))

    sess = await POOL.take()
    warm = sess is not None
    if sess is None:
        log.warning("no warm moshi — cold bake this call")
        try:
            url = moshi_chat_url(voice or WARM_VOICE, WARM_PROMPT)
            ssl_ctx = moshi_ssl() if url.startswith("wss://") else None
            moshi = await websockets.connect(url, ssl=ssl_ctx, max_size=None)
            writer = sphn.OpusStreamWriter(MOSHI_RATE)
            reader = sphn.OpusStreamReader(MOSHI_RATE)
            incoming: asyncio.Queue = asyncio.Queue()
            pump_task = asyncio.create_task(_pump_moshi(moshi, incoming), name="moshi-pump-cold")
            t0 = time.monotonic()
            while True:
                message = await _incoming_recv(incoming, HANDSHAKE_S)
                if isinstance(message, (bytes, bytearray)) and len(message) > 0 and message[0] == 0x00:
                    log.info("cold handshake bake_ms=%.0f", (time.monotonic() - t0) * 1000)
                    break
            sess = WarmSession(
                moshi=moshi,
                opus_writer=writer,
                opus_reader=reader,
                greeting_8k=np.zeros(0, dtype=np.int16),
                pending_24=np.zeros(0, dtype=np.int16),
                pending_8=np.zeros(0, dtype=np.int16),
                incoming=incoming,
                pump_task=pump_task,
            )
        except Exception as exc:
            log.exception("cold moshi connect failed")
            try:
                await snap_ws.send(json.dumps({"type": "error", "error": str(exc)}))
            except Exception:
                pass
            POOL.rearm()
            return
    try:
        await run_call(snap_ws, sess, t_hello, warm)
    finally:
        POOL.rearm()


async def main() -> None:
    POOL.start()
    # Do not accept phone calls until the first bake is done — otherwise the
    # first caller still pays 8s and can wedge the one Moshi lock.
    await POOL._ready.wait()
    log.info("listening ws://%s:%s  →  %s (warm ready)", LISTEN_HOST, LISTEN_PORT, MOSHI_URL)
    async with websockets.serve(handle_snapserve, LISTEN_HOST, LISTEN_PORT, max_size=None):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
