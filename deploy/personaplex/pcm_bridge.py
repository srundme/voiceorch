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
HANDSHAKE_S = float(os.environ.get("MOSHI_HANDSHAKE_TIMEOUT_S", "90"))
WARM_VOICE = os.environ.get("PERSONAPLEX_VOICE", "NATM1").replace(".pt", "")
# Spoken-to chats are destroyed on hangup. Park only for a VoBiz socket steal.
PARK_S = float(os.environ.get("MOSHI_PARK_S", "8"))
# Unused warm Moshi eating dither goes mute (07:47 call: 10 min idle, hello, then dead air).
IDLE_REBAKE_S = float(os.environ.get("MOSHI_IDLE_REBAKE_S", "40"))
# VoBiz often opens a second media socket a few seconds after the first.
RECONNECT_S = float(os.environ.get("MOSHI_RECONNECT_S", "8"))
GREETING_MAX_S = 5.0
GREETING_SILENCE_RMS = 250
HELLO_PCM_PATH = os.environ.get("IRFAN_HELLO_PCM", "/workspace/irfan_hello_8k.pcm")

# Role only. Playbook lives in SnapServe RecruiterBrain — do not bake it here.
IRFAN_PERSONA = (
    "You are Irfan, recruiter at JobShop, India's largest BPO recruitment company. "
    "You only screen BPO jobs. Interviews are face to face in Bangalore. "
    "No work from home. No virtual interviews. "
    "Never invent company names, openings, cities, kilometres, or salaries. "
    "Never ask for their phone number. Never say you are an AI. "
    "Do not greet first — the phone already played Hello this is Irfan from JobShop. "
    "Simple Indian English. One question at a time. Let them finish. "
    "Do not re-ask facts the candidate already gave. "
    "Start by asking what job they want. If not BPO, politely end."
)


def _default_warm_prompt() -> str:
    return IRFAN_PERSONA


# This GPU is the JobShop recruiter for life. SnapServe hello text is ignored.
WARM_PROMPT = (os.environ.get("PERSONAPLEX_WARM_PROMPT") or "").strip() or _default_warm_prompt()
log.info("recruiter prompt_chars=%s", len(WARM_PROMPT))


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


def dither_f32(n: int, amp: float = 40.0 / 32768.0) -> np.ndarray:
    """Room-tone instead of digital zeros — zeros make Moshi emit 'aahhh' (call 25599)."""
    return (np.random.randn(n).astype(np.float32) * amp)


def dither_i16(n: int, amp: int = 40) -> np.ndarray:
    return np.clip(np.random.randint(-amp, amp + 1, size=n), -32768, 32767).astype(np.int16)


def trim_leading_silence(pcm_i16: np.ndarray) -> np.ndarray:
    hop = SNAP_FRAME
    i = 0
    while i + hop <= pcm_i16.size and pcm_rms(pcm_i16[i:i + hop]) < GREETING_SILENCE_RMS:
        i += hop
    return pcm_i16[i:]


def keep_speech(pcm_i16: np.ndarray, hang_ms: float = 250.0, rms_min: float = 80.0) -> np.ndarray:
    """Keep spoken frames plus a short hangover; drop idle so the phone queue cannot grow."""
    hop = SNAP_FRAME
    hang_left = 0
    hang_frames = max(1, int(hang_ms * SNAP_RATE / 1000.0 / hop))
    parts: list[np.ndarray] = []
    for i in range(0, pcm_i16.size - hop + 1, hop):
        frame = pcm_i16[i:i + hop]
        if pcm_rms(frame) >= rms_min:
            hang_left = hang_frames
            parts.append(frame)
        elif hang_left > 0:
            hang_left -= 1
            parts.append(frame)
    return np.concatenate(parts) if parts else np.zeros(0, dtype=np.int16)


def moshi_ssl() -> ssl.SSLContext:
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def moshi_chat_url(voice: str, prompt: str) -> str:
    # Moshi takes text_prompt on the query string. ~8k raw → HTTP 400 LineTooLong.
    if len(prompt) > 4000:
        log.warning("recruiter prompt truncated %s → 4000 (Moshi URL limit)", len(prompt))
        prompt = prompt[:4000]
    params = urllib.parse.urlencode({
        "voice_prompt": f"{voice}.pt",
        "text_prompt": prompt,
    })
    return f"{MOSHI_URL}?{params}"


def norm_prompt(p: str) -> str:
    return " ".join((p or "").split())


@dataclass
class WarmSession:
    moshi: object
    opus_writer: object
    opus_reader: object
    greeting_8k: np.ndarray
    pending_24: np.ndarray
    pending_8: np.ndarray
    incoming: asyncio.Queue
    voice: str = WARM_VOICE
    prompt: str = ""
    steal: asyncio.Event = field(default_factory=asyncio.Event)
    silence_task: asyncio.Task | None = None
    discard_task: asyncio.Task | None = None
    pump_task: asyncio.Task | None = None
    greeted: bool = False
    attached_at: float = 0.0
    last_detach_at: float = 0.0
    last_call_s: float = 0.0
    reconnect_pending: bool = False
    parking: bool = False
    spoke: bool = False


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


async def _send_silence(sess: WarmSession) -> None:
    """Moshi only generates while it is fed frames. Keep the stream alive until steal."""
    while not sess.steal.is_set():
        sess.opus_writer.append_pcm(dither_f32(OPUS_FRAME_24))
        blob = sess.opus_writer.read_bytes()
        if len(blob) > 0:
            try:
                await sess.moshi.send(b"\x01" + blob)
            except Exception:
                sess.steal.set()
                return
        await asyncio.sleep(OPUS_FRAME_24 / MOSHI_RATE)


async def _discard_idle(sess: WarmSession) -> None:
    """Drop Moshi audio produced by keepalive silence so the queue cannot grow."""
    while not sess.steal.is_set():
        try:
            item = await asyncio.wait_for(sess.incoming.get(), timeout=0.4)
        except TimeoutError:
            continue
        except asyncio.CancelledError:
            raise
        if sess.steal.is_set():
            sess.incoming.put_nowait(item)
            return
        if isinstance(item, Exception):
            sess.incoming.put_nowait(item)
            return


def start_idle_feed(sess: WarmSession) -> None:
    if sess.silence_task is None or sess.silence_task.done():
        sess.silence_task = asyncio.create_task(_send_silence(sess), name="moshi-silence")
    if sess.discard_task is None or sess.discard_task.done():
        sess.discard_task = asyncio.create_task(_discard_idle(sess), name="moshi-discard")


class WarmPool:
    """One baked Moshi chat, ready to steal for the next phone call."""

    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._session: WarmSession | None = None
        self._ready = asyncio.Event()
        self._task: asyncio.Task | None = None
        self._next_voice = WARM_VOICE
        self._next_prompt = WARM_PROMPT
        self._take_waiters = 0

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._maintain(), name="moshi-warm")

    async def take(self, voice: str, prompt: str) -> WarmSession | None:
        # One recruiter on this GPU. Never rebake because SnapServe's hello
        # prompt differs — that 9s bake on a live line killed the POC calls.
        del voice, prompt
        self._take_waiters += 1
        try:
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
                sess.parking = False
                if sess.silence_task is not None:
                    sess.silence_task.cancel()
                if sess.discard_task is not None:
                    sess.discard_task.cancel()
                return sess
        finally:
            self._take_waiters -= 1

    def rearm(self) -> None:
        self.start()

    async def park_then_rearm(self, sess: WarmSession) -> None:
        """Destroy spoken-to Moshi. Park only for a VoBiz socket steal."""
        if sess.parking:
            log.info("park skipped — already parking")
            return
        sess.parking = True
        if sess.attached_at > 0:
            sess.last_call_s = time.monotonic() - sess.attached_at
        sess.last_detach_at = time.monotonic()
        pump = sess.pump_task
        dead = pump is None or pump.done()
        async with self._lock:
            waiters = self._take_waiters
        # Fresh bake after hangup. Do not keep a dither conversation for 180s.
        # Park only when a second socket is already waiting AND Moshi already spoke.
        steal_only = (not dead) and sess.spoke and waiters > 0
        if not steal_only:
            log.info(
                "destroy moshi after hangup spoke=%s waiters=%s last_call_s=%.1f",
                sess.spoke,
                waiters,
                sess.last_call_s,
            )
            try:
                await sess.moshi.close()
            except Exception:
                pass
            self._next_voice = WARM_VOICE
            self._next_prompt = WARM_PROMPT
            self.start()
            return
        sess.steal = asyncio.Event()
        sess.silence_task = None
        sess.discard_task = None
        start_idle_feed(sess)
        async with self._lock:
            sess.reconnect_pending = True
            self._session = sess
            self._ready.set()
        park_s = min(PARK_S, RECONNECT_S)
        log.info(
            "warm moshi parked for %.0fs persona_chars=%s last_call_s=%.1f reconnect=%s",
            park_s,
            len(sess.prompt),
            sess.last_call_s,
            sess.reconnect_pending,
        )
        steal_task = asyncio.create_task(sess.steal.wait())
        done, pending = await asyncio.wait(
            {steal_task, pump},
            timeout=park_s,
            return_when=asyncio.FIRST_COMPLETED,
        )
        if sess.steal.is_set():
            log.info("parked moshi stolen by next call")
            steal_task.cancel()
            return
        for task in pending:
            task.cancel()
        async with self._lock:
            if self._session is sess:
                self._session = None
                self._ready.clear()
        try:
            await sess.moshi.close()
        except Exception:
            pass
        log.info("park expired — rebaking")
        self._next_voice = WARM_VOICE
        self._next_prompt = WARM_PROMPT
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
            log.info(
                "warm moshi ready handshake_only greeting_ms=%.0f voice=%s prompt_chars=%s",
                sess.greeting_8k.size / 8,
                sess.voice,
                len(sess.prompt),
            )
            steal_task = asyncio.create_task(sess.steal.wait())
            waiters = {steal_task}
            if sess.pump_task is not None:
                waiters.add(sess.pump_task)
            done, pending = await asyncio.wait(
                waiters,
                timeout=IDLE_REBAKE_S,
                return_when=asyncio.FIRST_COMPLETED,
            )
            steal_task.cancel()
            # Never cancel pump_task here — that is the Moshi recv loop. Attaching
            # used to starve T2 and leave Irfan mute after the greeting.
            if sess.steal.is_set():
                return
            if sess.pump_task in done:
                log.warning("warm moshi died while idle — rebaking")
            else:
                async with self._lock:
                    if self._take_waiters > 0 or sess.steal.is_set():
                        steal_task = asyncio.create_task(sess.steal.wait())
                        await steal_task
                        return
                log.info("warm moshi idle %.0fs — rebaking before it goes mute", IDLE_REBAKE_S)
            async with self._lock:
                if self._session is sess:
                    self._session = None
                    self._ready.clear()
            try:
                await sess.moshi.close()
            except Exception:
                pass
            continue

    async def _bake(self) -> WarmSession:
        voice = self._next_voice or WARM_VOICE
        prompt = self._next_prompt or WARM_PROMPT
        url = moshi_chat_url(voice, prompt)
        ssl_ctx = moshi_ssl() if url.startswith("wss://") else None
        log.info("warm bake voice=%s prompt_chars=%s", voice, len(prompt))
        moshi = await websockets.connect(
            url, ssl=ssl_ctx, max_size=None, open_timeout=30, ping_interval=None,
        )
        writer = sphn.OpusStreamWriter(MOSHI_RATE)
        reader = sphn.OpusStreamReader(MOSHI_RATE)
        steal = asyncio.Event()
        incoming: asyncio.Queue = asyncio.Queue()
        pump_task = asyncio.create_task(_pump_moshi(moshi, incoming), name="moshi-pump")
        t0 = time.monotonic()
        handshake = False
        try:
            while True:
                message = await _incoming_recv(incoming, HANDSHAKE_S)
                if not isinstance(message, (bytes, bytearray)) or len(message) == 0:
                    continue
                if message[0] == 0x00:
                    handshake = True
                    log.info("warm handshake bake_ms=%.0f", (time.monotonic() - t0) * 1000)
                    break
        except Exception:
            pump_task.cancel()
            try:
                await moshi.close()
            except Exception:
                pass
            raise
        if not handshake:
            pump_task.cancel()
            await moshi.close()
            raise RuntimeError("warm bake closed before handshake")
        sess = WarmSession(
            moshi=moshi,
            opus_writer=writer,
            opus_reader=reader,
            greeting_8k=np.zeros(0, dtype=np.int16),
            pending_24=np.zeros(0, dtype=np.int16),
            pending_8=np.zeros(0, dtype=np.int16),
            incoming=incoming,
            voice=voice,
            prompt=norm_prompt(prompt),
            steal=steal,
            silence_task=None,
            discard_task=None,
            pump_task=pump_task,
        )
        # Do not feed dither here. That made Moshi greet into the void during
        # warm; attach then had speech_ms=0 and no turns (08:33 PSTN).
        # First Moshi speech happens on the live call, after recorded hello.
        log.info("warm handshake-only — first speech on attach")
        return sess


def _maybe_write_hello_pcm(pcm8: np.ndarray) -> None:
    if pcm8.size < SNAP_RATE:
        return
    try:
        pcm8.astype("<i2").tofile(HELLO_PCM_PATH)
        log.info("wrote irfan hello pcm samples=%s path=%s", pcm8.size, HELLO_PCM_PATH)
    except OSError:
        log.warning("could not write irfan hello pcm path=%s", HELLO_PCM_PATH)


class IrfanRuntime:
    """Today: unused short bake. Later: clone of IRFAN_BASE_STATE without Railway changes."""

    @staticmethod
    async def acquire_fresh_session(voice: str, prompt: str) -> WarmSession | None:
        return await POOL.take(voice, prompt)


POOL = WarmPool()


async def run_call(snap_ws, sess: WarmSession, t_hello: float, warm: bool, skip_greeting: bool = True) -> None:
    close = False
    pending_in_24 = np.zeros(0, dtype=np.int16)
    pending_24 = np.zeros(0, dtype=np.int16)
    pending_8 = np.zeros(0, dtype=np.int16)
    moshi = sess.moshi
    opus_writer = sess.opus_writer
    opus_reader = sess.opus_reader
    t_first_in = t_first_out = None
    send_lock = asyncio.Lock()
    last_in_at = time.monotonic()
    t_caller_turn = 0.0
    last_agent_speech_at = 0.0
    heard_caller = False
    sess.attached_at = time.monotonic()
    elapsed = (time.monotonic() - sess.last_detach_at) if sess.last_detach_at > 0 else 1e9
    # SnapServe plays recorded Irfan hello. Skip Moshi greeting dump unless asked.
    replay = skip_greeting or (
        sess.greeted and (
            sess.reconnect_pending
            or (0 < sess.last_call_s < 4.0 and elapsed < RECONNECT_S)
        )
    )
    greeting_s = 0.0 if replay else float(sess.greeting_8k.size) / SNAP_RATE
    live_at = time.monotonic() + greeting_s
    held_8 = np.zeros(0, dtype=np.int16)
    flushed_hold = replay

    async def abort() -> None:
        nonlocal close
        close = True

    async def emit_opus(frame_i16: np.ndarray) -> None:
        async with send_lock:
            opus_writer.append_pcm(i16_to_f32(frame_i16))
            blob = opus_writer.read_bytes()
            if len(blob) > 0:
                await moshi.send(b"\x01" + blob)

    async def snap_to_moshi() -> None:
        nonlocal close, pending_in_24, t_first_in, last_in_at, t_caller_turn, heard_caller
        try:
            async for message in snap_ws:
                if close:
                    return
                if isinstance(message, str) or (
                    isinstance(message, (bytes, bytearray))
                    and len(message) > 0
                    and message[0] in (0x7B, 0x5B)
                ):
                    _handle_snap_control(message)
                    continue
                if t_first_in is None:
                    t_first_in = time.monotonic()
                    log.info("latency T1_first_pcm_to_moshi_ms=%.0f", (t_first_in - t_hello) * 1000)
                pcm8 = np.frombuffer(message, dtype="<i2")
                last_in_at = time.monotonic()
                if pcm_rms(pcm8) >= GREETING_SILENCE_RMS:
                    if not heard_caller:
                        heard_caller = True
                        log.info("caller speech at_ms=%.0f", (time.monotonic() - t_hello) * 1000)
                    if t_caller_turn <= 0.0 or (time.monotonic() - last_agent_speech_at) > 0.4:
                        t_caller_turn = time.monotonic()
                pending_in_24 = np.concatenate([pending_in_24, upsample_8_to_24(pcm8)])
                while pending_in_24.size >= OPUS_FRAME_24:
                    frame = pending_in_24[:OPUS_FRAME_24]
                    pending_in_24 = pending_in_24[OPUS_FRAME_24:]
                    await emit_opus(frame)
        except Exception:
            log.exception("snap_to_moshi failed")
        finally:
            await abort()

    async def pad_moshi_gaps() -> None:
        # Only clock Moshi if SnapServe actually stalled. Padding on low RMS
        # doubled input during every pause (caller silence + dither) so Moshi
        # generated faster than realtime and the phone queued 10s+ per turn.
        padded = False
        while not close:
            await asyncio.sleep(OPUS_FRAME_24 / MOSHI_RATE)
            if close:
                return
            if time.monotonic() - last_in_at >= 0.08:
                if not padded:
                    log.info("moshi pad: SnapServe PCM stalled")
                    padded = True
                await emit_opus(dither_i16(OPUS_FRAME_24))

    async def send_pcm8(pcm8: np.ndarray) -> None:
        nonlocal pending_8
        pending_8 = np.concatenate([pending_8, pcm8])
        while pending_8.size >= SNAP_FRAME:
            await snap_ws.send(pending_8[:SNAP_FRAME].tobytes())
            pending_8 = pending_8[SNAP_FRAME:]

    async def moshi_to_snap() -> None:
        nonlocal close, pending_24, t_first_out, t_caller_turn, last_agent_speech_at
        nonlocal held_8, flushed_hold
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
                if t_first_out is None:
                    t_first_out = time.monotonic()
                    log.info(
                        "latency T2_live_opus_ms=%.0f warm=%s",
                        (t_first_out - t_hello) * 1000,
                        warm,
                    )
                now = time.monotonic()
                speaking = pcm_rms(pcm8) >= 80.0
                if speaking:
                    if flushed_hold:
                        sess.spoke = True
                    if t_caller_turn > 0.0 and now - last_agent_speech_at > 0.25:
                        log.info("latency turn_ms=%.0f", (now - t_caller_turn) * 1000)
                        t_caller_turn = 0.0
                    last_agent_speech_at = now
                # Greeting is dumped instantly; Railway plays it over greeting_s.
                # Buffer live Moshi during that window, then forward everything.
                # Skipping "quiet" frames after hello muted Irfan (call 06:18).
                if now < live_at:
                    held_8 = np.concatenate([held_8, pcm8])
                    continue
                if not flushed_hold:
                    flushed_hold = True
                    speech = keep_speech(held_8)
                    log.info(
                        "greeting hold done hold_ms=%.0f buffered_ms=%.0f speech_ms=%.0f heard_caller=%s",
                        greeting_s * 1000,
                        1000.0 * held_8.size / SNAP_RATE,
                        1000.0 * speech.size / SNAP_RATE,
                        heard_caller,
                    )
                    if speech.size >= SNAP_FRAME:
                        await send_pcm8(speech)
                    held_8 = np.zeros(0, dtype=np.int16)
                await send_pcm8(pcm8)
        except Exception:
            if not close:
                log.exception("moshi_to_snap failed")
        finally:
            await abort()

    try:
        await snap_ws.send(json.dumps({"type": "ready"}))
        log.info(
            "snapserve ready warm=%s attach_ms=%.0f greeting_bytes=%s replay=%s last_call_s=%.1f reconnect=%s",
            warm,
            (time.monotonic() - t_hello) * 1000,
            0 if replay else int(sess.greeting_8k.size * 2),
            replay,
            sess.last_call_s,
            sess.reconnect_pending,
        )
        if replay:
            live_at = time.monotonic()
            log.info("reconnect skip greeting — live now")
        else:
            buf = sess.greeting_8k
            while buf.size >= SNAP_FRAME:
                await snap_ws.send(buf[:SNAP_FRAME].tobytes())
                buf = buf[SNAP_FRAME:]
            sess.greeted = True
            live_at = time.monotonic() + greeting_s
            log.info("greeting hold_ms=%.0f", greeting_s * 1000)

        async def t2_watchdog() -> None:
            await asyncio.sleep(3)
            if t_first_out is None and not close:
                log.warning(
                    "no T2 live opus 3s after attach T1=%s — Moshi is mute",
                    None if t_first_in is None else round((t_first_in - t_hello) * 1000),
                )

        await asyncio.gather(
            snap_to_moshi(),
            moshi_to_snap(),
            pad_moshi_gaps(),
            t2_watchdog(),
            return_exceptions=True,
        )
    finally:
        await abort()


def _snap_open(snap_ws) -> bool:
    state = getattr(snap_ws, "state", None)
    name = getattr(state, "name", None)
    if name:
        return name == "OPEN"
    return getattr(snap_ws, "close_code", None) is None


def _handle_snap_control(raw) -> None:
    try:
        msg = json.loads(raw.decode("utf-8") if isinstance(raw, (bytes, bytearray)) else raw)
    except Exception:
        return
    kind = str(msg.get("type") or "")
    if kind == "coach":
        text = str(msg.get("text") or "").strip()
        log.info("coach chars=%s text=%s", len(text), text[:240])
        # Moshi handshake is already done; mid-chat text is usually ignored.
        # RecruiterBrain still owns the profile. Packet is here for later text-in.
        return
    if kind == "speak":
        log.info("speak ignored after handshake chars=%s", len(str(msg.get("text") or "")))


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
    prompt = norm_prompt(str(hello.get("textPrompt") or "")) or WARM_PROMPT
    skip_greeting = hello.get("skipGreeting") is True
    known = str(hello.get("knownFacts") or "").strip()
    t_hello = time.monotonic()
    log.info(
        "snap hello voice=%s prompt_chars=%s skip_greeting=%s known_chars=%s",
        voice,
        len(prompt),
        skip_greeting,
        len(known),
    )

    # VoBiz often opens a ghost socket that dies while take() is still waiting.
    # That used to steal the warm Moshi, dump hello into the void, and leave
    # the real caller on a silent line (call 25681).
    take_task = asyncio.create_task(IrfanRuntime.acquire_fresh_session(voice, prompt), name="moshi-take")
    closed_task = asyncio.create_task(snap_ws.wait_closed(), name="snap-closed")
    sess: WarmSession | None = None
    try:
        done, _pending = await asyncio.wait(
            {take_task, closed_task},
            return_when=asyncio.FIRST_COMPLETED,
        )
        if take_task not in done:
            take_task.cancel()
            try:
                await take_task
            except asyncio.CancelledError:
                pass
            log.info("snapserve closed before moshi attach — warm session kept")
            return
        sess = take_task.result()
        if closed_task.done() or not _snap_open(snap_ws):
            log.info("snapserve closed as moshi attached — park without talking")
            if sess is not None:
                await POOL.park_then_rearm(sess)
            return
    finally:
        closed_task.cancel()

    warm = sess is not None
    if sess is None:
        log.warning("no warm moshi — cold bake this call")
        try:
            url = moshi_chat_url(voice or WARM_VOICE, prompt)
            ssl_ctx = moshi_ssl() if url.startswith("wss://") else None
            moshi = await websockets.connect(url, ssl=ssl_ctx, max_size=None, ping_interval=None)
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
                voice=voice or WARM_VOICE,
                prompt=prompt,
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
        await run_call(snap_ws, sess, t_hello, warm, skip_greeting=skip_greeting)
    except Exception:
        log.exception("connection handler failed")
    finally:
        await POOL.park_then_rearm(sess)


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
