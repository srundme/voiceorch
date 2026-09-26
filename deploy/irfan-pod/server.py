"""Irfan's front door on the GPU pod. Only the small Silero VAD loads here.

Ear, brain and voice each run in their own vLLM server:
  ear    Parakeet CTC 1.1B     :8001  (start-ear.sh)
  brain  Qwen3-32B-AWQ         :8000  (start-brain.sh)
  voice  Qwen3-TTS CustomVoice :8091  (start-tts.sh, speaker Ryan)

SnapServe calls:
  GET  /health
  WS   /v1/stt                    PCM16 mono 16 kHz in, JSON transcripts out
  POST /v1/audio/transcriptions   PCM16 mono 16 kHz body -> {"text": ...}
  POST /v1/chat/completions       OpenAI streaming chat, including tool calls
  POST /v1/audio/speech           JSON {"input": "..."} -> chunked PCM16 mono 16 kHz
"""

from __future__ import annotations

import asyncio
import collections
import io
import json
import os
import re
import time
import wave

import aiohttp
import numpy as np
import onnxruntime as ort
import soxr
from aiohttp import WSMsgType, web

EAR_URL = os.environ.get("IRFAN_EAR_URL", "http://127.0.0.1:8001")
BRAIN_URL = os.environ.get("IRFAN_BRAIN_URL", "http://127.0.0.1:8000")
VOICE_URL = os.environ.get("IRFAN_VOICE_URL", "http://127.0.0.1:8091")
VOICE_NAME = os.environ.get("IRFAN_VOICE_NAME", "ryan")
VOICE_INSTRUCT = os.environ.get(
    "IRFAN_VOICE_INSTRUCT",
    "Speak warmly and clearly, like a friendly recruiter on a phone call.",
)
PORT = int(os.environ.get("IRFAN_POD_PORT", "8787"))

SAMPLE_RATE = 16000
VOICE_RATE = 24000
VAD_MODEL = os.environ.get("IRFAN_VAD_MODEL", "/workspace/models/silero_vad.onnx")
VAD_WINDOW = 512
VAD_CONTEXT = 64
WINDOW_MS = VAD_WINDOW / SAMPLE_RATE * 1000
SPEECH_START = 0.5
SPEECH_KEEP = 0.35
START_WINDOWS = 2
PREROLL_MS = 300
MIN_SPEECH_MS = 250
PARTIAL_EVERY_MS = 600
# A finished sentence ends after END_MS of silence. One that trails off on a
# word like "on", "the" or "twenty" is held up to HOLD_MS, because Indian
# callers pause mid-date and mid-pincode ("I'm born on twenty ... July ...").
END_MS = 700
HOLD_MS = 1500
# A date trails off as "two thousand" and the year arrives a beat later.
# Call 35632 saved 20 July 2000 because the hold gave up before the rest.
DATE_HOLD_MS = 2800
MAX_UTTER_MS = 20000
# A word list, not a sentence. A sentence gets read back as if the caller said it.
EAR_CONTEXT = (
    "Jobshop, Irfan, voice process, international voice process, "
    "BPO, call center, Bangalore, Gmail, at the rate, dot com, pincode"
)
HEARD_AS = (
    (re.compile(r"\bwise process\b", re.I), "voice process"),
    (re.compile(r"\bvoice processors?\b", re.I), "voice process"),
    (re.compile(r"\bvice process\b", re.I), "voice process"),
    (re.compile(r"\bvice[- ]president\b", re.I), "voice process"),
    (re.compile(r"\b(?:drop|job)\s*shop\b", re.I), "Jobshop"),
    (re.compile(r"\biPhone, how are you\b"), "Hi Irfan, how are you"),
)
UNFINISHED = set(
    "a an the to on in at of for from with and or but so because like is am are was were "
    "my your his her our their i i'm im it's its this that there um uh er hmm "
    "zero oh one two three four five six seven eight nine ten eleven twelve thirteen fourteen "
    "fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy "
    "eighty ninety hundred thousand double triple "
    "january february march april may june july august september october november december "
    "born dot at-the-rate rate".split()
)

http: aiohttp.ClientSession | None = None
vad_session = None
listeners = 0


def log(msg: str) -> None:
    print(time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()) + " " + msg, flush=True)


SPOKEN_DIGITS = set("zero oh one two three four five six seven eight nine".split())


def trailing_digit_count(words: list[str]) -> int:
    count = 0
    for i in range(len(words) - 1, -1, -1):
        word = words[i]
        if word.isdigit():
            count += len(word)
        elif word in SPOKEN_DIGITS:
            count += 1
            if i > 0 and words[i - 1] in ("double", "triple"):
                count += 1 if words[i - 1] == "double" else 2
        elif word not in ("double", "triple"):
            break
    return count


FILLERS = set("hmm um uh ah er okay ok yeah yes yep nope nah right hello hi".split())


def content_words(text: str) -> list[str]:
    return [w for w in (re.sub(r"[^a-z0-9'-]", "", word) for word in text.strip().lower().split()) if w]


def sounds_unfinished(text: str) -> bool:
    if text.rstrip().endswith((",", "...", "-")):
        return True
    words = content_words(text)
    if not words or all(word in FILLERS for word in words):
        return False
    if trailing_digit_count(words) in (6, 10):
        return False
    return words[-1] in UNFINISHED


def hold_limit_ms(text: str) -> float:
    words = content_words(text)
    if words and words[-1] in ("thousand", "hundred", "july", "born") or "birth" in words or "born" in words:
        return DATE_HOLD_MS
    return HOLD_MS


def clean_transcript(text: str) -> str:
    folded = re.sub(r"\s+", " ", text).strip()
    if not folded:
        return ""
    hint = set(re.findall(r"[a-z]+", EAR_CONTEXT.lower()))
    words = re.findall(r"[a-z']+", folded.lower())
    if len(words) >= 4 and sum(word in hint for word in words) / len(words) > 0.8:
        return ""
    for pattern, replacement in HEARD_AS:
        folded = pattern.sub(replacement, folded)
    return folded


class Vad:
    """Silero v5 on 32 ms windows, with its recurrent state kept per caller."""

    def __init__(self) -> None:
        self.state = np.zeros((2, 1, 128), dtype=np.float32)
        self.context = np.zeros(VAD_CONTEXT, dtype=np.float32)
        self.sr = np.array(SAMPLE_RATE, dtype=np.int64)

    def prob(self, window: bytes) -> float:
        chunk = np.frombuffer(window, dtype=np.int16).astype(np.float32) / 32768.0
        x = np.concatenate([self.context, chunk])[None, :]
        out, self.state = vad_session.run(None, {"input": x, "state": self.state, "sr": self.sr})
        self.context = chunk[-VAD_CONTEXT:]
        return float(out[0][0])


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
    form.add_field("prompt", EAR_CONTEXT)
    async with http.post(f"{EAR_URL}/v1/audio/transcriptions", data=form) as resp:
        if resp.status != 200:
            log(f"ear HTTP {resp.status}: {(await resp.text())[:200]}")
            return ""
        return clean_transcript(str((await resp.json()).get("text") or ""))


async def upstream_ok(url: str) -> bool:
    try:
        async with http.get(f"{url}/health", timeout=aiohttp.ClientTimeout(total=3)) as resp:
            return resp.status == 200
    except (aiohttp.ClientError, asyncio.TimeoutError):
        return False


async def health(_request: web.Request) -> web.Response:
    ear, brain, voice = await asyncio.gather(upstream_ok(EAR_URL), upstream_ok(BRAIN_URL), upstream_ok(VOICE_URL))
    return web.json_response({
        "ok": ear and brain and voice,
        "ear": ear,
        "brain": brain,
        "voice": voice,
        "busy": listeners > 0,
    })


async def transcribe_http(request: web.Request) -> web.Response:
    return web.json_response({"text": await transcribe(await request.read())})


async def speech(request: web.Request) -> web.StreamResponse:
    body = await request.json()
    text = str(body.get("input") or body.get("text") or "").strip()
    instruct = str(body.get("instructions") or body.get("instruct") or VOICE_INSTRUCT).strip()
    payload = {
        "input": text,
        "voice": VOICE_NAME,
        "language": "English",
        "task_type": "CustomVoice",
        "instructions": instruct,
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
        self.generation = 0
        self.reset()

    def reset(self) -> None:
        self.generation += 1
        self.buf = bytearray()
        self.preroll: collections.deque[bytes] = collections.deque(maxlen=int(PREROLL_MS / WINDOW_MS))
        self.start_windows = 0
        self.speech_ms = 0.0
        self.silence_ms = 0.0
        self.in_speech = False
        self.last_partial_at = 0.0
        self.last_text = ""
        self.tentative: str | None = None


async def stt_socket(request: web.Request) -> web.WebSocketResponse:
    global listeners
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    listeners += 1
    utter = Utterance()
    vad = Vad()
    pending = bytearray()
    infer_lock = asyncio.Lock()
    window_bytes = VAD_WINDOW * 2

    async def send(text: str, final: bool) -> None:
        if not ws.closed:
            await ws.send_str(json.dumps({"text": text, "is_final": final}))

    async def partial() -> None:
        if infer_lock.locked():
            return
        async with infer_lock:
            generation = utter.generation
            text = await transcribe(bytes(utter.buf))
            if generation != utter.generation or not text or text == utter.last_text:
                return
            utter.last_text = text
            await send(text, False)

    async def finish(text: str, why: str) -> None:
        seconds = len(utter.buf) / 2 / SAMPLE_RATE
        utter.reset()
        log(f"hear final {seconds:.1f}s audio ({why}): {text[:80]}")
        if text:
            await send(text, True)

    async def on_window(window: bytes) -> None:
        p = vad.prob(window)
        if not utter.in_speech:
            utter.preroll.append(window)
            utter.start_windows = utter.start_windows + 1 if p >= SPEECH_START else 0
            if utter.start_windows >= START_WINDOWS:
                utter.in_speech = True
                utter.buf = bytearray(b"".join(utter.preroll))
                utter.speech_ms = utter.start_windows * WINDOW_MS
                utter.silence_ms = 0.0
            return

        utter.buf.extend(window)
        if p >= SPEECH_KEEP:
            utter.speech_ms += WINDOW_MS
            utter.silence_ms = 0.0
            utter.tentative = None
            if (
                utter.speech_ms >= MIN_SPEECH_MS
                and (time.monotonic() - utter.last_partial_at) * 1000 >= PARTIAL_EVERY_MS
            ):
                utter.last_partial_at = time.monotonic()
                asyncio.create_task(partial())
        else:
            utter.silence_ms += WINDOW_MS

        if utter.silence_ms >= END_MS and utter.speech_ms < MIN_SPEECH_MS:
            utter.reset()
            return
        if len(utter.buf) / 2 / SAMPLE_RATE * 1000 >= MAX_UTTER_MS:
            async with infer_lock:
                await finish(await transcribe(bytes(utter.buf)), "max length")
            return
        if utter.silence_ms >= END_MS and utter.tentative is None:
            async with infer_lock:
                started = time.monotonic()
                text = await transcribe(bytes(utter.buf))
            if not sounds_unfinished(text):
                await finish(text, f"ear {time.monotonic() - started:.2f}s")
                return
            utter.tentative = text
            if text != utter.last_text:
                utter.last_text = text
                await send(text, False)
            return
        if utter.tentative is not None and utter.silence_ms >= hold_limit_ms(utter.tentative):
            await finish(utter.tentative, "held for more")

    async for msg in ws:
        if msg.type == WSMsgType.ERROR:
            break
        if msg.type != WSMsgType.BINARY or not msg.data:
            continue
        pending.extend(msg.data)
        while len(pending) >= window_bytes:
            window = bytes(pending[:window_bytes])
            del pending[:window_bytes]
            await on_window(window)

    listeners -= 1
    return ws


def main() -> None:
    global vad_session
    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    options.inter_op_num_threads = 1
    vad_session = ort.InferenceSession(VAD_MODEL, options, providers=["CPUExecutionProvider"])
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
