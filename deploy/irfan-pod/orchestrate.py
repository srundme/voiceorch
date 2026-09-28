"""Irfan's own call loop. One process on the same machine as the ear, brain, and voice.

Open pieces only:
  Echo cancel on the phone frames, Hush speaker isolation before the ear
  Silero VAD and the phrase fixes already in server.py
  Whisper ear, Qwen brain, Qwen voice on this machine
  The existing job match in match.py
  Vobiz media frames (playAudio, clearAudio, checkpoint, stop)

Not in this loop: ai-coustics, Sarvam, Cartesia, or any other hosted speech API.
SnapServe is not required. Point the Vobiz answer stream at this process.
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import time
import wave
from io import BytesIO
from pathlib import Path
from urllib.parse import quote

import aiohttp
import numpy as np
import soxr
from aiohttp import WSMsgType, web

import server
from match import empty_profile, load_jobs, match_profile
from phone_audio import LineCleaner
from intake import apply_save, card, empty_screen, save_tool, screen_note, step as intake_step
from stt_capture import TurnCapture
from memory import apply_extract, load_memory, memory_block, parse_extract, save_memory

HERE = Path(__file__).resolve().parent
EAR_URL = os.environ.get("IRFAN_EAR_URL", "http://127.0.0.1:8001")
BRAIN_URL = os.environ.get("IRFAN_BRAIN_URL", "http://127.0.0.1:8000")
VOICE_URL = os.environ.get("IRFAN_VOICE_URL", "http://127.0.0.1:8091")
VOICE_NAME = os.environ.get("IRFAN_VOICE_NAME", "sruthi")
VOICE_INSTRUCT = os.environ.get(
    "IRFAN_VOICE_INSTRUCT",
    "Speak warmly and clearly, like a friendly recruiter on a phone call.",
)
SPOKEN_NAME = os.environ.get("IRFAN_SPOKEN_NAME", "Sruthi")
PORT = int(os.environ.get("IRFAN_ORCH_PORT", "8790"))
PHONE_RATE = 8000
EAR_RATE = 16000
VOICE_RATE = 24000
FRAME_MS = 20
FRAME_SAMPLES = PHONE_RATE * FRAME_MS // 1000

MATCH_PARAMETERS = {
    "type": "object",
    "properties": {
        "first_name": {"type": "string", "description": "First name. Gender is decided from this name and is not asked."},
        "gender": {"type": "string", "description": "Male or Female, only if the first name says so. Omit when it does not."},
        "city": {"type": "string", "description": "Current city"},
        "birth_year": {"type": "number", "description": "Year of birth, four digits"},
        "tenth_year": {"type": "number", "description": "Year they finished 10th"},
        "twelfth_year": {"type": "number", "description": "Year they finished 12th"},
        "diploma_year": {"type": "number", "description": "Year they finished a diploma"},
        "degree_year": {"type": "number", "description": "Year they finished the degree"},
        "pg_year": {"type": "number", "description": "Year they finished a postgraduate degree"},
        "qualification": {"type": "string", "description": "10th, 12th, Diploma, Graduate, or Post Graduate"},
        "experience_years": {"type": "number", "description": "Total years of work. 0 for a fresher."},
        "skills": {"type": "string", "description": "What they want: international voice, domestic voice, or non-voice."},
        "skill_role": {"type": "string", "description": "The role they do or want"},
        "shift": {"type": "string", "description": "Day, night, UK, US, rotational, or any"},
        "expected_monthly_salary": {"type": "number", "description": "Expected monthly salary in rupees"},
        "english": {"type": "string", "description": "Excellent, Very good, Good, Average, or Poor, judged from how they spoke. Do not ask them."},
    },
    "required": ["city", "qualification", "experience_years", "skills", "shift", "expected_monthly_salary"],
}

LAST_SCREEN: dict = card(empty_screen())


def publish_screen(screen: dict, jobs: list[dict]) -> None:
    global LAST_SCREEN
    LAST_SCREEN = card(screen, jobs)


TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "match_jobs",
            "description": "Score the caller against the open jobs. Call this only when the SCREEN block says to call match_jobs. If it is too early, ask the question it names. Speak only the jobs in the result. If it says no opening, do not name a company or a salary.",
            "parameters": MATCH_PARAMETERS,
        },
    },
    {
        "type": "function",
        "function": {
            "name": "end_call",
            "description": "Hang up after you have spoken a close that matches this call. Speak that close yourself first. This tool does not play a fixed farewell.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    save_tool(),
]


def log(msg: str) -> None:
    print(time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()) + " orch " + msg, flush=True)


DESK_PATH = HERE / "desk.json"
DEFAULT_GREETING = f"Hello, this is {SPOKEN_NAME} from Jobshop. How may I assist you?"


def default_desk() -> dict:
    return {
        "greeting": DEFAULT_GREETING,
        "endCall": True,
        "barge": True,
        "waitMs": 180,
        "pinWaitMs": 2600,
        "emailWaitMs": 3000,
        "prompt": "",
    }


def _clamp_ms(value: object, fallback: int) -> int:
    try:
        number = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return fallback
    return min(8000, max(200, number))


def load_desk() -> dict:
    desk = default_desk()
    if DESK_PATH.exists():
        try:
            saved = json.loads(DESK_PATH.read_text())
        except json.JSONDecodeError:
            saved = None
        if isinstance(saved, dict):
            desk.update(saved)
    desk["greeting"] = str(desk.get("greeting") or DEFAULT_GREETING).strip() or DEFAULT_GREETING
    desk["endCall"] = bool(desk.get("endCall", True))
    desk["barge"] = bool(desk.get("barge", True))
    desk["waitMs"] = _clamp_ms(desk.get("waitMs"), 180)
    desk["pinWaitMs"] = _clamp_ms(desk.get("pinWaitMs"), 2600)
    desk["emailWaitMs"] = _clamp_ms(desk.get("emailWaitMs"), 3000)
    desk["prompt"] = str(desk.get("prompt") or "")
    return desk


DESK = load_desk()


def desk_view() -> dict:
    view = dict(DESK)
    if not view["prompt"].strip():
        view["prompt"] = (HERE / "prompt.txt").read_text()
    return view


def save_desk(patch: dict) -> dict:
    global DESK
    nxt = dict(DESK)
    if "greeting" in patch:
        greeting = str(patch.get("greeting") or "").strip()
        if greeting:
            nxt["greeting"] = greeting
    if "endCall" in patch:
        nxt["endCall"] = bool(patch.get("endCall"))
    if "barge" in patch:
        nxt["barge"] = bool(patch.get("barge"))
    for key, fallback in (("waitMs", 180), ("pinWaitMs", 2600), ("emailWaitMs", 3000)):
        if key in patch:
            nxt[key] = _clamp_ms(patch.get(key), fallback)
    if "prompt" in patch:
        prompt = str(patch.get("prompt") or "")
        if prompt.strip():
            nxt["prompt"] = prompt
            (HERE / "prompt.txt").write_text(prompt)
    DESK = nxt
    DESK_PATH.write_text(json.dumps(nxt, ensure_ascii=False, indent=2))
    log("desk saved")
    return desk_view()


def system_prompt() -> str:
    raw = desk_view()["prompt"]
    named = raw.replace("{{agent_name}}", SPOKEN_NAME)
    return (
        "[TOOL CALLING RULES — FOLLOW EXACTLY]\n"
        "When you want to call a tool, use the tool-call format. Do not describe the call in spoken text.\n\n"
        + named
    )


def take_phrase(buf: str) -> tuple[str, str] | None:
    """Cut a speakable piece off the front. The rest stays for the next piece."""
    for index, ch in enumerate(buf):
        if ch in ".!?" and index >= 8:
            nxt = buf[index + 1:index + 2]
            if nxt == "" or nxt.isspace():
                phrase = buf[:index + 1].strip()
                if phrase:
                    return phrase, buf[index + 1:]
    return None


def listen_ms(last_agent: str, desk: dict) -> float:
    text = last_agent.lower()
    if "pin" in text or "digit" in text:
        return float(desk["pinWaitMs"])
    if "email" in text or "mail" in text:
        return float(desk["emailWaitMs"])
    return float(desk["waitMs"])


def drop_leading_silence(pcm: bytes) -> bytes:
    if len(pcm) < 4:
        return pcm
    audio = np.frombuffer(pcm[: len(pcm) // 2 * 2], dtype=np.int16)
    frame = 160
    start = 0
    for index in range(0, max(len(audio) - frame, 0), frame):
        window = audio[index:index + frame].astype(np.float32)
        if float(np.sqrt(np.mean(window ** 2))) > 350:
            start = index
            break
    return audio[start:].astype(np.int16).tobytes()


def pcm_wav(pcm: bytes, rate: int) -> bytes:
    buf = BytesIO()
    with wave.open(buf, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(pcm)
    return buf.getvalue()




def e164(raw: str) -> str | None:
    trimmed = "".join(ch for ch in raw.strip() if ch.isdigit() or ch == "+")
    digits = "".join(ch for ch in trimmed if ch.isdigit())
    if trimmed.startswith("+") and len(digits) >= 8:
        return f"+{digits}"
    if len(digits) == 10:
        return f"+91{digits}"
    if len(digits) == 11 and digits.startswith("0"):
        return f"+91{digits[1:]}"
    if len(digits) == 12 and digits.startswith("91"):
        return f"+{digits}"
    return None


def public_base() -> str:
    return os.environ.get("IRFAN_PUBLIC_URL", "").strip().rstrip("/")


def stream_xml(name: str, phone: str = "") -> str:
    public = public_base()
    if public.startswith("https://"):
        ws_base = "wss://" + public[len("https://"):]
    elif public.startswith("http://"):
        ws_base = "ws://" + public[len("http://"):]
    else:
        ws_base = public
    url = f"{ws_base}/vobiz"
    params = []
    if name:
        params.append("name=" + quote(name))
    if phone:
        params.append("phone=" + quote(phone))
    if params:
        url += "?" + "&".join(params)
    safe = url.replace("&", "&amp;")
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        "<Response>\n"
        '  <Stream bidirectional="true" keepCallAlive="true" maxRetries="0" '
        f'contentType="audio/x-l16;rate=8000">{safe}</Stream>\n'
        "</Response>"
    )


class Call:
    def __init__(
        self,
        ws: web.WebSocketResponse,
        http: aiohttp.ClientSession,
        jobs: list[dict],
        caller_name: str = "",
        phone: str = "",
    ) -> None:
        self.ws = ws
        self.http = http
        self.jobs = jobs
        self.phone = phone
        self.caller_name = caller_name
        self.memory = load_memory(phone) if phone else {"phone": "", "call_count": 0, "facts": {}, "summary": "", "calls": []}
        self.turns: list[dict] = []
        self.archived = False
        self.archive_lock = asyncio.Lock()
        self.stream_id = ""
        self.profile = empty_profile()
        self.screen = empty_screen(phone)
        self.desk = desk_view()
        self.messages: list[dict] = [{"role": "system", "content": system_prompt()}]
        block = memory_block(self.memory)
        if block:
            self.messages.append({"role": "system", "content": block})
            log(f"memory loaded calls={self.memory.get('call_count') or 0}")
        elif caller_name:
            self.messages.append({
                "role": "system",
                "content": f"This call was placed to {caller_name}. Confirm the name the way the prompt says.",
            })
        self.last_agent = ""
        self.playing = False
        self.deaf_until = 0.0
        self.barge = asyncio.Event()
        self.play_task: asyncio.Task | None = None
        self.heard = bytearray()
        self.resampler = soxr.ResampleStream(PHONE_RATE, EAR_RATE, 1, dtype="int16", quality="HQ")
        self.pending = bytearray()
        self.vad = server.Vad()
        self.in_speech = False
        self.start_windows = 0
        self.speech_ms = 0.0
        self.silence_ms = 0.0
        self.preroll: list[bytes] = []
        self.buf = bytearray()
        self.turn_lock = asyncio.Lock()
        self.closed = False
        self.loud_ms = 0.0
        self.play_started = 0.0
        self.cleaner = LineCleaner()
        self.capture = TurnCapture()

    async def send(self, payload: dict) -> None:
        if not self.ws.closed:
            await self.ws.send_str(json.dumps(payload))

    def opening_line(self) -> str:
        greeting = str(self.desk.get("greeting") or DEFAULT_GREETING).strip()
        known = str((self.memory.get("facts") or {}).get("name") or self.caller_name or "").strip()
        if known and greeting == DEFAULT_GREETING:
            return f"Hello, this is {SPOKEN_NAME} from Jobshop. Am I speaking with {known}?"
        return greeting or DEFAULT_GREETING

    async def greet(self) -> None:
        line = self.opening_line()
        self.last_agent = line
        self.messages.append({"role": "assistant", "content": line})
        await self.speak(line)

    def feed(self, pcm8: bytes) -> None:
        if self.playing:
            # Barge on the raw phone audio. Echo cancellation removes the
            # caller along with her echo, so a real interruption never trips.
            self._maybe_barge(pcm8)
            self.cleaner.capture(pcm8)
            return
        cleaned = self.cleaner.capture(pcm8)
        if time.monotonic() < self.deaf_until:
            return
        even = len(pcm8) // 2 * 2
        self.capture.push(pcm8[:even], cleaned[:even])
        samples = np.frombuffer(cleaned[:even], dtype=np.int16)
        if len(samples) == 0:
            return
        lifted = self.cleaner.denoise(self.resampler.resample_chunk(samples).tobytes())
        self.pending.extend(lifted)
        window = server.VAD_WINDOW * 2
        while len(self.pending) >= window:
            frame = bytes(self.pending[:window])
            del self.pending[:window]
            self._on_window(frame)

    def _maybe_barge(self, pcm8: bytes) -> None:
        # Echo of her own voice comes back for a short moment. After that,
        # a loud stretch is the caller talking over her.
        if not self.desk.get("barge", True):
            return
        if time.monotonic() - self.play_started < 0.4:
            return
        samples = np.frombuffer(pcm8[: len(pcm8) // 2 * 2], dtype=np.int16)
        if len(samples) == 0:
            return
        rms = float(np.sqrt(np.mean(samples.astype(np.float32) ** 2)))
        self.loud_ms = self.loud_ms + (len(samples) / PHONE_RATE * 1000) if rms > 900 else 0.0
        if self.loud_ms >= 280:
            if not self.barge.is_set():
                log("barge")
            self.barge.set()

    def _on_window(self, window: bytes) -> None:
        prob = self.vad.prob(window)
        end_ms = listen_ms(self.last_agent, self.desk)
        if not self.in_speech:
            self.preroll.append(window)
            self.preroll = self.preroll[-8:]
            self.start_windows = self.start_windows + 1 if prob >= server.SPEECH_START else 0
            if self.start_windows >= server.START_WINDOWS:
                self.in_speech = True
                self.capture.begin()
                self.buf = bytearray(b"".join(self.preroll))
                self.speech_ms = self.start_windows * server.WINDOW_MS
                self.silence_ms = 0.0
            return
        self.buf.extend(window)
        if prob >= server.SPEECH_KEEP:
            self.speech_ms += server.WINDOW_MS
            self.silence_ms = 0.0
        else:
            self.silence_ms += server.WINDOW_MS
        if self.silence_ms >= end_ms and self.speech_ms < server.MIN_SPEECH_MS:
            self.capture.take()
            self._reset_listen()
            return
        if self.silence_ms >= end_ms or len(self.buf) / 2 / EAR_RATE * 1000 >= server.MAX_UTTER_MS:
            audio = bytes(self.buf)
            raw, aec = self.capture.take()
            self._reset_listen()
            asyncio.get_running_loop().create_task(self.on_caller(audio, raw, aec))

    def _reset_listen(self) -> None:
        self.in_speech = False
        self.start_windows = 0
        self.speech_ms = 0.0
        self.silence_ms = 0.0
        self.preroll = []
        self.buf = bytearray()

    async def on_caller(self, audio: bytes, raw8: bytes = b"", aec8: bytes = b"") -> None:
        async with self.turn_lock:
            if self.closed:
                return
            text = server.clean_transcript(await self.transcribe(audio))
            try:
                self.capture.save(self.stream_id or self.phone or "call", raw8, aec8, audio, text)
            except OSError:
                log("stt capture failed")
            if not text:
                return
            log(f"caller: {text[:120]}")
            self.turns.append({"who": "Caller", "text": text})
            self.messages.append({"role": "user", "content": text})
            await self.reply()

    async def transcribe(self, pcm16: bytes) -> str:
        form = aiohttp.FormData()
        form.add_field("file", pcm_wav(pcm16, EAR_RATE), filename="audio.wav", content_type="audio/wav")
        form.add_field("prompt", server.EAR_CONTEXT)
        async with self.http.post(
            f"{EAR_URL}/v1/audio/transcriptions",
            data=form,
        ) as resp:
            if resp.status != 200:
                log(f"ear HTTP {resp.status}")
                return ""
            body = await resp.json()
            return str(body.get("text") or "")

    def _pin_screen(self) -> None:
        note = {"role": "system", "content": screen_note(self.screen, self.jobs)}
        self.messages = [
            message for message in self.messages
            if not str(message.get("content") or "").startswith("=== SCREEN ===")
        ]
        insert_at = len(self.messages)
        for index in range(len(self.messages) - 1, -1, -1):
            if self.messages[index].get("role") == "user":
                insert_at = index
                break
        self.messages.insert(insert_at, note)

    async def reply(self) -> None:
        self._pin_screen()
        hangup = False
        for _ in range(3):
            calls = await self.stream_turn()
            if not calls:
                return
            for call in calls:
                name = call["name"]
                args = call["arguments"]
                if name == "save_screen":
                    self.screen = apply_save(self.screen, args if isinstance(args, dict) else {})
                    publish_screen(self.screen, self.jobs)
                    content = screen_note(self.screen, self.jobs)
                    current = intake_step(self.screen, self.jobs)
                    log(f"screen {current['label'] or 'open'}")
                elif name == "match_jobs":
                    current = intake_step(self.screen, self.jobs)
                    if not current["pitch"]:
                        content = current["ask"] + " Do not match jobs yet."
                        log("match held")
                    else:
                        result = match_profile(self.profile, args, self.jobs)
                        self.profile = result["profile"]
                        if not result["matches"]:
                            self.screen["no_opening"] = "yes"
                            publish_screen(self.screen, self.jobs)
                        content = result["speech"]
                        log(f"match {len(result['matches'])} jobs")
                elif name == "end_call":
                    if self.desk.get("endCall", True):
                        content = "Call ending after the close you already spoke."
                        hangup = True
                    else:
                        content = "Do not hang up. Stay on the line."
                        log("end held")
                else:
                    content = "That tool is not on this line."
                self.messages.append({
                    "role": "tool",
                    "tool_call_id": call["id"],
                    "content": content,
                })
            if hangup:
                await self.finish()
                return
        log("stopped after three tool rounds")

    async def stream_turn(self) -> list[dict]:
        """Speak the first phrase while the rest of the reply is still being written."""
        payload = {
            "model": "irfan-brain",
            "temperature": 0.3,
            "messages": self.messages,
            "tools": TOOLS if self.desk.get("endCall", True) else [
                tool for tool in TOOLS if tool["function"]["name"] != "end_call"
            ],
            "tool_choice": "auto",
            "stream": True,
        }
        started = time.monotonic()
        content = ""
        buf = ""
        spoken: list[str] = []
        tools: dict[int, dict] = {}
        queue: asyncio.Queue = asyncio.Queue()
        first = True

        async def player() -> None:
            phrase = await queue.get()
            if phrase is None:
                return
            # First sentence streams out as the audio arrives. Later sentences
            # are built while that one is still playing, so there is no gap.
            current = asyncio.create_task(self.speak(phrase))
            while True:
                nxt = await queue.get()
                if nxt is None:
                    await current
                    return
                synth = asyncio.create_task(self.synth(nxt))
                await current
                if self.barge.is_set() or self.closed:
                    synth.cancel()
                    while True:
                        extra = await queue.get()
                        if extra is None:
                            return
                audio = await synth
                if self.barge.is_set() or self.closed:
                    while True:
                        extra = await queue.get()
                        if extra is None:
                            return
                current = asyncio.create_task(self.play_pcm(nxt, audio))

        player_task = asyncio.create_task(player())
        try:
            async with self.http.post(f"{BRAIN_URL}/v1/chat/completions", json=payload) as resp:
                if resp.status != 200:
                    detail = (await resp.text())[:240]
                    log(f"brain HTTP {resp.status}: {detail}")
                    return []
                pending = b""
                async for chunk in resp.content.iter_any():
                    pending += chunk
                    while b"\n" in pending:
                        raw, pending = pending.split(b"\n", 1)
                        line = raw.decode(errors="ignore").strip()
                        if not line.startswith("data:"):
                            continue
                        data = line[5:].strip()
                        if data == "[DONE]":
                            continue
                        try:
                            event = json.loads(data)
                        except json.JSONDecodeError:
                            continue
                        delta = ((event.get("choices") or [{}])[0].get("delta") or {})
                        piece = delta.get("content") or ""
                        if piece and not tools:
                            content += piece
                            buf += piece
                            while True:
                                cut = take_phrase(buf)
                                if cut is None:
                                    break
                                phrase, buf = cut
                                spoken.append(phrase)
                                if first:
                                    first = False
                                    log(f"brain first {time.monotonic() - started:.2f}s")
                                await queue.put(phrase)
                        for call in delta.get("tool_calls") or []:
                            idx = int(call.get("index") or 0)
                            slot = tools.setdefault(idx, {"id": "", "name": "", "arguments": ""})
                            if call.get("id"):
                                slot["id"] = call["id"]
                            fn = call.get("function") or {}
                            if fn.get("name"):
                                slot["name"] += fn["name"]
                            if fn.get("arguments"):
                                slot["arguments"] += fn["arguments"]
        finally:
            if not tools and buf.strip():
                phrase = buf.strip()
                spoken.append(phrase)
                if first:
                    log(f"brain first {time.monotonic() - started:.2f}s")
                await queue.put(phrase)
            await queue.put(None)
            await player_task

        calls = []
        raw_calls = []
        for idx in sorted(tools):
            slot = tools[idx]
            try:
                args = json.loads(slot["arguments"] or "{}")
            except json.JSONDecodeError:
                args = {}
            call_id = slot["id"] or slot["name"] or "tool"
            raw_calls.append({
                "id": call_id,
                "type": "function",
                "function": {"name": slot["name"], "arguments": slot["arguments"] or "{}"},
            })
            calls.append({"id": call_id, "name": slot["name"], "arguments": args})
        if raw_calls:
            # A tool with no speech yet means the words were only a preview. Drop them.
            said = " ".join(spoken).strip()
            self.messages.append({
                "role": "assistant",
                "content": said or None,
                "tool_calls": raw_calls,
            })
        elif spoken:
            self.messages.append({"role": "assistant", "content": " ".join(spoken).strip()})
        return calls

    async def speak(self, text: str) -> None:
        if self.play_task and not self.play_task.done():
            self.barge.set()
            await asyncio.gather(self.play_task, return_exceptions=True)
        self.barge = asyncio.Event()
        self.play_task = asyncio.create_task(self._play(text, self.barge))
        await self.play_task

    async def _play(self, text: str, barge: asyncio.Event) -> None:
        self.barge = barge
        await self._stream_out(text)

    async def _stream_out(self, text: str) -> None:
        self.playing = True
        self.play_started = time.monotonic()
        self.loud_ms = 0.0
        self.last_agent = text
        log(f"irfan: {text[:240]}")
        self.turns.append({"who": SPOKEN_NAME, "text": text})
        started = time.monotonic()
        heard = False
        try:
            payload = {
                "input": text,
                "voice": VOICE_NAME,
                "language": "English",
                "task_type": "CustomVoice",
                "stream": True,
                "stream_format": "audio",
                "response_format": "pcm",
            }
            if VOICE_NAME not in {"irfan", "sruthi"} and VOICE_INSTRUCT:
                payload["instructions"] = VOICE_INSTRUCT
            async with self.http.post(f"{VOICE_URL}/v1/audio/speech", json=payload) as resp:
                if resp.status != 200:
                    log(f"voice HTTP {resp.status}")
                    return
                resampler = soxr.ResampleStream(VOICE_RATE, PHONE_RATE, 1, dtype="int16", quality="HQ")
                carry = b""
                pending = b""
                frame_bytes = FRAME_SAMPLES * 2
                async for chunk in resp.content.iter_any():
                    if self.barge.is_set() or self.closed:
                        self.cleaner.drop_render()
                        await self.send({"event": "clearAudio", "streamId": self.stream_id})
                        return
                    data = carry + chunk
                    even = len(data) // 2 * 2
                    carry = data[even:]
                    if not even:
                        continue
                    pcm = resampler.resample_chunk(np.frombuffer(data[:even], dtype=np.int16))
                    pending += np.asarray(pcm, dtype=np.int16).tobytes()
                    while len(pending) >= frame_bytes:
                        frame = pending[:frame_bytes]
                        pending = pending[frame_bytes:]
                        if not heard:
                            rms = float(np.sqrt(np.mean(np.frombuffer(frame, dtype=np.int16).astype(np.float32) ** 2)))
                            if rms < 350:
                                continue
                            heard = True
                            log(f"voice first {time.monotonic() - started:.2f}s")
                        if self.barge.is_set() or self.closed:
                            self.cleaner.drop_render()
                            await self.send({"event": "clearAudio", "streamId": self.stream_id})
                            return
                        self.cleaner.render(frame)
                        await self.send({
                            "event": "playAudio",
                            "media": {
                                "contentType": "audio/x-l16",
                                "sampleRate": PHONE_RATE,
                                "payload": base64.b64encode(frame).decode(),
                            },
                        })
                        await asyncio.sleep(FRAME_MS / 1000)
                if pending and heard and not self.barge.is_set() and not self.closed:
                    self.cleaner.render(pending)
                    await self.send({
                        "event": "playAudio",
                        "media": {
                            "contentType": "audio/x-l16",
                            "sampleRate": PHONE_RATE,
                            "payload": base64.b64encode(pending).decode(),
                        },
                    })
            await self.send({"event": "checkpoint", "name": f"m{int(time.time() * 1000)}", "streamId": self.stream_id})
        finally:
            self.playing = False
            self.deaf_until = time.monotonic() + 0.2

    async def synth(self, text: str) -> bytes:
        started = time.monotonic()
        payload = {
            "input": text,
            "voice": VOICE_NAME,
            "language": "English",
            "task_type": "CustomVoice",
            "stream": True,
            "stream_format": "audio",
            "response_format": "pcm",
        }
        if VOICE_NAME not in {"irfan", "sruthi"} and VOICE_INSTRUCT:
            payload["instructions"] = VOICE_INSTRUCT
        async with self.http.post(f"{VOICE_URL}/v1/audio/speech", json=payload) as resp:
            if resp.status != 200:
                log(f"voice HTTP {resp.status}")
                return b""
            resampler = soxr.ResampleStream(VOICE_RATE, PHONE_RATE, 1, dtype="int16", quality="HQ")
            carry = b""
            pending = b""
            async for chunk in resp.content.iter_any():
                if self.barge.is_set() or self.closed:
                    return b""
                data = carry + chunk
                even = len(data) // 2 * 2
                carry = data[even:]
                if not even:
                    continue
                pcm = resampler.resample_chunk(np.frombuffer(data[:even], dtype=np.int16))
                pending += np.asarray(pcm, dtype=np.int16).tobytes()
            tail = resampler.resample_chunk(np.zeros(0, dtype=np.int16), last=True)
            pending += np.asarray(tail, dtype=np.int16).tobytes()
        log(f"voice ready {time.monotonic() - started:.2f}s")
        return drop_leading_silence(pending)

    async def play_pcm(self, text: str, pcm: bytes) -> None:
        if not pcm or self.closed:
            return
        self.last_agent = text
        log(f"irfan: {text[:240]}")
        self.turns.append({"who": SPOKEN_NAME, "text": text})
        self.playing = True
        self.play_started = time.monotonic()
        self.loud_ms = 0.0
        frame_bytes = FRAME_SAMPLES * 2
        try:
            for index in range(0, len(pcm), frame_bytes):
                if self.barge.is_set() or self.closed:
                    self.cleaner.drop_render()
                    await self.send({"event": "clearAudio", "streamId": self.stream_id})
                    return
                frame = pcm[index:index + frame_bytes]
                self.cleaner.render(frame)
                await self.send({
                    "event": "playAudio",
                    "media": {
                        "contentType": "audio/x-l16",
                        "sampleRate": PHONE_RATE,
                        "payload": base64.b64encode(frame).decode(),
                    },
                })
                await asyncio.sleep(FRAME_MS / 1000)
            await self.send({"event": "checkpoint", "name": f"m{int(time.time() * 1000)}", "streamId": self.stream_id})
        finally:
            self.playing = False
            self.deaf_until = time.monotonic() + 0.2

    async def finish(self) -> None:
        self.closed = True
        if self.play_task and not self.play_task.done():
            await asyncio.gather(self.play_task, return_exceptions=True)
        await self.archive()
        await self.send({"event": "stop", "streamId": self.stream_id})
        await self.ws.close()

    async def archive(self) -> None:
        async with self.archive_lock:
            if self.archived or not self.phone or not self.turns:
                return
            self.archived = True
            turns = list(self.turns)
        extract: dict = {}
        try:
            extract = await self.extract_memory(turns)
        except (aiohttp.ClientError, asyncio.TimeoutError, json.JSONDecodeError):
            log("memory extract failed")
        record = apply_extract(self.memory, extract, turns)
        record["screen"] = self.screen
        publish_screen(self.screen, self.jobs)
        save_memory(record)
        self.memory = record
        log(f"memory saved calls={record['call_count']}")

    async def extract_memory(self, turns: list[dict]) -> dict:
        lines = "\n".join(f"{turn['who']}: {turn['text']}" for turn in turns)[:8000]
        payload = {
            "model": "irfan-brain",
            "temperature": 0,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "Extract only what this call actually said. Reply with JSON only, no markdown. "
                        "Use empty strings for anything not said. Do not invent. "
                        '{"summary":"one or two sentences of where the call stopped",'
                        '"facts":{"name":"","location":"","pincode":"","role":"",'
                        '"experience":"","qualification":"","shift":"","expected_salary":"","email":""}}'
                    ),
                },
                {"role": "user", "content": lines},
            ],
        }
        async with self.http.post(f"{BRAIN_URL}/v1/chat/completions", json=payload) as resp:
            if resp.status != 200:
                log(f"memory brain HTTP {resp.status}")
                return {}
            data = await resp.json()
        content = ((data.get("choices") or [{}])[0].get("message") or {}).get("content") or ""
        return parse_extract(str(content))


async def answer_fields(request: web.Request) -> dict:
    if request.content_type == "application/json":
        try:
            data = await request.json()
        except json.JSONDecodeError:
            return {}
        return data if isinstance(data, dict) else {}
    try:
        form = await request.post()
    except Exception:
        return {}
    return {key: form.get(key) for key in form.keys()}


async def answer(request: web.Request) -> web.Response:
    name = str(request.query.get("name") or "")
    phone = str(request.query.get("phone") or "")
    if phone:
        log("answer")
        return web.Response(text=stream_xml(name, phone), content_type="text/xml")
    fields = await answer_fields(request)
    direction = str(fields.get("Direction") or fields.get("direction") or "").lower()
    caller = str(fields.get("From") or fields.get("from") or "")
    if direction == "outbound":
        caller = str(fields.get("To") or fields.get("to") or caller)
    phone = e164(caller) or ""
    log("answer inbound" if phone else "answer")
    return web.Response(text=stream_xml(name, phone), content_type="text/xml")


async def hangup(_request: web.Request) -> web.Response:
    log("hangup")
    return web.Response(status=200, text="ok")


def desk_allowed(request: web.Request) -> bool:
    dial_token = os.environ.get("IRFAN_DIAL_TOKEN", "").strip()
    if not dial_token:
        return True
    return request.headers.get("X-Irfan-Dial") == dial_token


def desk_payload(view: dict) -> dict:
    return {
        "greeting": view["greeting"],
        "endCall": view["endCall"],
        "barge": view["barge"],
        "waitMs": view["waitMs"],
        "pinWaitMs": view["pinWaitMs"],
        "emailWaitMs": view["emailWaitMs"],
        "prompt": view["prompt"],
    }


async def get_desk(request: web.Request) -> web.Response:
    if not desk_allowed(request):
        return web.json_response({"error": "This desk cannot change the line."}, status=403)
    return web.json_response(desk_payload(desk_view()))


async def post_desk(request: web.Request) -> web.Response:
    if not desk_allowed(request):
        return web.json_response({"error": "This desk cannot change the line."}, status=403)
    try:
        body = await request.json()
    except json.JSONDecodeError:
        return web.json_response({"error": "The change was not readable."}, status=400)
    if not isinstance(body, dict):
        return web.json_response({"error": "The change was not readable."}, status=400)
    return web.json_response(desk_payload(save_desk(body)))


async def get_screen(request: web.Request) -> web.Response:
    if not desk_allowed(request):
        return web.json_response({"error": "This desk cannot read the screen."}, status=403)
    return web.json_response(LAST_SCREEN)


async def place_call(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except json.JSONDecodeError:
        return web.json_response({"error": "Name and phone are required."}, status=400)
    name = str(body.get("name") or "").strip()
    phone = e164(str(body.get("phone") or ""))
    if not name or not phone:
        return web.json_response({"error": "Enter a name and a mobile number."}, status=400)
    dial_token = os.environ.get("IRFAN_DIAL_TOKEN", "").strip()
    if dial_token and request.headers.get("X-Irfan-Dial") != dial_token:
        return web.json_response({"error": "Irfan's line refused this desk."}, status=403)
    auth_id = os.environ.get("VOBIZ_AUTH_ID", "").strip()
    auth_token = os.environ.get("VOBIZ_AUTH_TOKEN", "").strip()
    from_number = os.environ.get("VOBIZ_FROM_NUMBER", "").strip()
    public = public_base()
    if not auth_id or not auth_token or not from_number or not public.startswith("http"):
        return web.json_response(
            {"error": "Irfan's phone line is not set on this machine."},
            status=503,
        )
    payload = {
        "to": phone,
        "from": from_number,
        "answer_url": f"{public}/answer?name={quote(name)}&phone={quote(phone)}",
        "answer_method": "POST",
        "hangup_url": f"{public}/hangup",
        "hangup_method": "POST",
    }
    url = f"https://api.vobiz.ai/api/v1/Account/{auth_id}/Call/"
    try:
        async with request.app["http"].post(
            url,
            json=payload,
            headers={
                "X-Auth-ID": auth_id,
                "X-Auth-Token": auth_token,
                "Accept": "application/json",
            },
        ) as resp:
            data = await resp.json(content_type=None)
            if resp.status >= 400:
                log(f"dial failed status={resp.status}")
                return web.json_response({"error": "The call was not placed."}, status=502)
    except aiohttp.ClientError:
        log("dial failed")
        return web.json_response({"error": "The call was not placed."}, status=502)
    request_uuid = ""
    if isinstance(data, dict):
        request_uuid = str(data.get("request_uuid") or data.get("call_uuid") or "")
    log(f"dial {phone} request={request_uuid or 'none'}")
    return web.json_response({"id": request_uuid or None, "status": "ringing", "toNumber": phone}, status=201)


async def vobiz_socket(request: web.Request) -> web.WebSocketResponse:
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    call = Call(
        ws,
        request.app["http"],
        request.app["jobs"],
        str(request.query.get("name") or ""),
        str(request.query.get("phone") or ""),
    )
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
            call.stream_id = str(start.get("streamId") or data.get("streamId") or "")
            call.capture.start(call.stream_id or "call")
            log(f"start {call.stream_id}")
            asyncio.create_task(call.greet())
        elif event == "media":
            payload = ((data.get("media") or {}).get("payload")) or ""
            if payload and not call.closed:
                call.feed(base64.b64decode(payload))
        elif event == "stop":
            call.closed = True
            break
    await call.archive()
    return ws


def main() -> None:
    options = server.ort.SessionOptions()
    options.intra_op_num_threads = 1
    options.inter_op_num_threads = 1
    server.vad_session = server.ort.InferenceSession(
        server.VAD_MODEL, options, providers=["CPUExecutionProvider"]
    )
    app = web.Application()
    app["jobs"] = load_jobs()

    async def open_http(app_: web.Application) -> None:
        app_["http"] = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=120))

    async def close_http(app_: web.Application) -> None:
        await app_["http"].close()

    app.on_startup.append(open_http)
    app.on_cleanup.append(close_http)
    app.router.add_get("/health", lambda _r: web.json_response({
        "ok": True,
        "orchestration": "irfan",
        "hosted_apis": [],
        "phone": bool(
            os.environ.get("VOBIZ_AUTH_ID")
            and os.environ.get("VOBIZ_AUTH_TOKEN")
            and os.environ.get("VOBIZ_FROM_NUMBER")
            and public_base().startswith("http")
        ),
    }))
    app.router.add_get("/desk", get_desk)
    app.router.add_get("/screen", get_screen)
    app.router.add_post("/desk", post_desk)
    app.router.add_post("/call", place_call)
    app.router.add_post("/answer", answer)
    app.router.add_get("/answer", answer)
    app.router.add_post("/hangup", hangup)
    app.router.add_get("/vobiz", vobiz_socket)
    probe = LineCleaner()
    log(
        f"listen 0.0.0.0:{PORT} spoken={SPOKEN_NAME} "
        f"hush={'on' if probe.hush_ready else 'off'} "
        f"ns={'on' if probe.ns_ready else 'off'} echo=on"
    )
    web.run_app(app, host="0.0.0.0", port=PORT, print=None)


if __name__ == "__main__":
    main()
