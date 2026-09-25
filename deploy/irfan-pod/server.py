"""One process for Irfan's ear, brain, and cloned voice.

The three models stay loaded. SnapServe calls:
  GET  /health
  WS   /v1/stt                 PCM16 mono 16 kHz in, JSON transcripts out
  POST /v1/chat/completions    OpenAI-style streaming chat, including tool calls
  POST /v1/audio/speech        JSON {"input": "..."} -> PCM16 mono 16 kHz
"""

from __future__ import annotations

import asyncio
import json
import os
import queue
import re
import threading
import time
from typing import Any

import numpy as np
import torch
from aiohttp import WSMsgType, web
from qwen_asr import Qwen3ASRModel
from qwen_tts import Qwen3TTSModel
from transformers import AutoModelForCausalLM, AutoTokenizer, TextIteratorStreamer

ASR_DIR = os.environ.get("IRFAN_ASR_DIR", "/workspace/models/Qwen3-ASR-1.7B")
TTS_DIR = os.environ.get("IRFAN_TTS_DIR", "/workspace/models/Qwen3-TTS-12Hz-1.7B-Base")
LLM_DIR = os.environ.get("IRFAN_LLM_DIR", "/workspace/models/Qwen2.5-14B-Instruct")
REF_WAV = os.environ.get("IRFAN_REF_WAV", "/workspace/voices/irfan-ref.wav")
REF_TXT = os.environ.get("IRFAN_REF_TXT", "/workspace/voices/irfan-ref.txt")
PORT = int(os.environ.get("IRFAN_POD_PORT", "8787"))

SAMPLE_RATE = 16000
SPEECH_RMS = 0.01
SILENCE_MS = 450
MIN_SPEECH_MS = 250
PARTIAL_EVERY_MS = 900

INFER = threading.Lock()
asr = None
tts = None
voice_prompt = None
llm = None
tok = None


def log(msg: str) -> None:
    print(time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()) + " " + msg, flush=True)


def pcm16_to_float(pcm: bytes) -> np.ndarray:
    if not pcm:
        return np.zeros(0, dtype=np.float32)
    audio = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
    return np.ascontiguousarray(audio)


def float_to_pcm16(wav: np.ndarray) -> bytes:
    clipped = np.clip(wav, -1.0, 1.0)
    return (clipped * 32767.0).astype(np.int16).tobytes()


def to_16k(wav: np.ndarray, sr: int) -> np.ndarray:
    if sr == SAMPLE_RATE or len(wav) == 0:
        return wav.astype(np.float32)
    n = max(1, int(len(wav) * SAMPLE_RATE / sr))
    x = np.linspace(0, len(wav) - 1, n)
    return np.interp(x, np.arange(len(wav)), wav).astype(np.float32)


def rms(pcm: bytes) -> float:
    audio = pcm16_to_float(pcm)
    if len(audio) == 0:
        return 0.0
    return float(np.sqrt(np.mean(np.square(audio))))


def transcribe(pcm: bytes) -> str:
    audio = pcm16_to_float(pcm)
    if len(audio) < SAMPLE_RATE // 5:
        return ""
    with INFER:
        result = asr.transcribe((audio, SAMPLE_RATE), language="English")
    text = getattr(result[0], "text", "") if result else ""
    return (text or "").strip()


def speak(text: str) -> bytes:
    cleaned = " ".join(text.split())
    if not cleaned:
        return b""
    max_tokens = min(400, max(48, len(cleaned) * 3))
    with INFER:
        wavs, sr = tts.generate_voice_clone(
            text=cleaned,
            language="English",
            voice_clone_prompt=voice_prompt,
            max_new_tokens=max_tokens,
        )
    return float_to_pcm16(to_16k(np.asarray(wavs[0], dtype=np.float32), int(sr)))


def load_models() -> None:
    global asr, tts, voice_prompt, llm, tok
    log("load asr")
    asr = Qwen3ASRModel.from_pretrained(
        ASR_DIR,
        dtype=torch.bfloat16,
        device_map="cuda:0",
        max_inference_batch_size=1,
        max_new_tokens=256,
    )
    log("load tts")
    tts = Qwen3TTSModel.from_pretrained(
        TTS_DIR,
        dtype=torch.bfloat16,
        device_map="cuda:0",
    )
    ref_text = open(REF_TXT, encoding="utf-8").read().strip()
    log("clone prompt")
    voice_prompt = tts.create_voice_clone_prompt(
        ref_audio=REF_WAV,
        ref_text=ref_text,
        x_vector_only_mode=False,
    )
    log("load llm")
    tok = AutoTokenizer.from_pretrained(LLM_DIR, local_files_only=True)
    llm = AutoModelForCausalLM.from_pretrained(
        LLM_DIR,
        torch_dtype=torch.bfloat16,
        device_map="cuda:0",
        local_files_only=True,
    )
    log("models ready")


class Utterance:
    def __init__(self) -> None:
        self.buf = bytearray()
        self.speech_ms = 0.0
        self.silence_ms = 0.0
        self.in_speech = False
        self.last_partial_at = 0.0
        self.last_text = ""

    def reset(self) -> None:
        self.buf.clear()
        self.speech_ms = 0.0
        self.silence_ms = 0.0
        self.in_speech = False
        self.last_partial_at = 0.0
        self.last_text = ""


async def health(_request: web.Request) -> web.Response:
    return web.json_response({"ok": asr is not None and tts is not None and llm is not None})


async def transcribe_http(request: web.Request) -> web.Response:
    pcm = await request.read()
    text = await asyncio.to_thread(transcribe, pcm)
    return web.json_response({"text": text})


async def speech(request: web.Request) -> web.Response:
    body = await request.json()
    text = str(body.get("input") or body.get("text") or "")
    pcm = await asyncio.to_thread(speak, text)
    return web.Response(body=pcm, content_type="audio/L16")


def parse_tool_call(text: str) -> tuple[str, str] | None:
    start = text.find("<tool_call>")
    end = text.find("</tool_call>")
    if start < 0 or end < start:
        return None
    raw = text[start + len("<tool_call>") : end].strip()
    try:
        obj = json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", raw, re.S)
        if not match:
            return None
        obj = json.loads(match.group(0))
    name = str(obj.get("name") or "").strip()
    args = obj.get("arguments", {})
    if not name:
        return None
    if not isinstance(args, str):
        args = json.dumps(args)
    return name, args


def generate_reply(body: dict[str, Any], out: queue.Queue[str | None]) -> None:
    messages = body.get("messages") or []
    tools = body.get("tools") or None
    max_new = int(body.get("max_tokens") or 220)
    max_new = max(16, min(max_new, 512))
    prompt = tok.apply_chat_template(
        messages,
        tools=tools,
        add_generation_prompt=True,
        tokenize=False,
    )
    inputs = tok(prompt, return_tensors="pt").to("cuda")
    streamer = TextIteratorStreamer(tok, skip_prompt=True, skip_special_tokens=True)
    error: list[str] = []

    def _run() -> None:
        try:
            with INFER:
                with torch.inference_mode():
                    llm.generate(
                        **inputs,
                        streamer=streamer,
                        max_new_tokens=max_new,
                        do_sample=False,
                    )
        except Exception as exc:
            error.append(str(exc))
            streamer.end()

    def _read() -> None:
        try:
            for piece in streamer:
                out.put(piece)
        finally:
            if error:
                out.put("\n__IRFAN_ERROR__" + error[0])
            out.put(None)

    threading.Thread(target=_run, daemon=True).start()
    threading.Thread(target=_read, daemon=True).start()


async def chat(request: web.Request) -> web.Response:
    body = await request.json()
    out: queue.Queue[str | None] = queue.Queue()
    await asyncio.to_thread(generate_reply, body, out)

    response = web.StreamResponse(
        status=200,
        headers={
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )
    await response.prepare(request)
    full = ""
    spoken_sent = 0
    tool_mode = False
    marker = "<tool_call>"

    async def emit(delta: dict[str, Any]) -> None:
        payload = {"choices": [{"index": 0, "delta": delta}]}
        await response.write(f"data: {json.dumps(payload)}\n\n".encode())

    def safe_end(text: str) -> int:
        limit = min(len(marker) - 1, len(text))
        for n in range(limit, 0, -1):
            if marker.startswith(text[-n:]):
                return len(text) - n
        return len(text)

    while True:
        piece = await asyncio.to_thread(out.get)
        if piece is None:
            break
        if piece.startswith("\n__IRFAN_ERROR__"):
            log("llm " + piece)
            break
        full += piece
        if not tool_mode and "<tool_call" in full:
            tool_mode = True
            head = full.split("<tool_call", 1)[0]
            extra = head[spoken_sent:]
            if extra:
                await emit({"content": extra})
            spoken_sent = len(head)
            continue
        if not tool_mode:
            end = safe_end(full)
            extra = full[spoken_sent:end]
            if extra:
                await emit({"content": extra})
            spoken_sent = end

    if not tool_mode and spoken_sent < len(full):
        await emit({"content": full[spoken_sent:]})

    parsed = parse_tool_call(full) if tool_mode else None
    if parsed:
        name, args = parsed
        await emit({"tool_calls": [{"index": 0, "function": {"name": name, "arguments": args}}]})
    await response.write(b"data: [DONE]\n\n")
    await response.write_eof()
    return response


async def stt_socket(request: web.Request) -> web.WebSocketResponse:
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    utter = Utterance()
    infer_lock = asyncio.Lock()

    async def send(text: str, final: bool) -> None:
        if ws.closed:
            return
        await ws.send_str(json.dumps({"text": text, "is_final": final}))

    async def run_asr(final: bool) -> None:
        if infer_lock.locked() and not final:
            return
        async with infer_lock:
            pcm = bytes(utter.buf)
            text = await asyncio.to_thread(transcribe, pcm)
            if not text:
                return
            if final:
                await send(text, True)
                utter.reset()
                return
            if text != utter.last_text:
                utter.last_text = text
                await send(text, False)

    async for msg in ws:
        if msg.type == WSMsgType.ERROR:
            break
        if msg.type != WSMsgType.BINARY:
            continue
        pcm = msg.data
        if not isinstance(pcm, (bytes, bytearray)) or not pcm:
            continue
        frame_ms = (len(pcm) / 2) / SAMPLE_RATE * 1000
        level = rms(pcm)
        if level >= SPEECH_RMS:
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
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
    load_models()
    app = web.Application()
    app.router.add_get("/health", health)
    app.router.add_post("/v1/audio/transcriptions", transcribe_http)
    app.router.add_post("/v1/audio/speech", speech)
    app.router.add_post("/v1/chat/completions", chat)
    app.router.add_get("/v1/stt", stt_socket)
    log(f"listen 0.0.0.0:{PORT}")
    web.run_app(app, host="0.0.0.0", port=PORT, print=None)


if __name__ == "__main__":
    main()
