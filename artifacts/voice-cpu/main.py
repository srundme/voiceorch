"""CPU voice service for one live call path.

Moonshine listens, Qwen 0.8B (4-bit, thinking off) replies, Pocket speaks.
Models stay loaded. SnapServe streams PCM to this process; it does not
share the API server.

Env:
  PORT                 default 8090
  MOONSHINE_MODEL_PATH / MOONSHINE_MODEL_ARCH
  QWEN_GGUF_PATH or QWEN_GGUF_URL
  POCKET_VOICE         catalog voice, default alba (no Hugging Face login)
  POCKET_VOICE_WAV     optional clip. Voice cloning needs a Hugging Face
                       login on kyutai/pocket-tts; otherwise alba is used.
  QWEN_THREADS         llama.cpp threads (default 8)
"""

from __future__ import annotations

import json
import os
import subprocess
import threading
import time
from pathlib import Path

import numpy as np
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, StreamingResponse

app = FastAPI()
_lock = threading.Lock()
_pcm_cache: dict[str, bytes] = {}
_state: dict = {
    "moonshine": None,
    "moonshine_error": None,
    "llm": None,
    "llm_error": None,
    "tts": None,
    "voice": None,
    "tts_error": None,
    "tts_rate": 24000,
}


def _pcm16_to_f32(pcm: bytes) -> np.ndarray:
    if len(pcm) < 2:
        return np.zeros(0, dtype=np.float32)
    audio = np.frombuffer(pcm, dtype=np.int16).astype(np.float32)
    return audio / 32768.0


def _to_pcm16_16k(audio: np.ndarray, src_rate: int) -> bytes:
    x = np.asarray(audio, dtype=np.float32).reshape(-1)
    if x.size == 0:
        return b""
    if src_rate != 16000 and src_rate > 0:
        n = max(1, int(round(x.size * 16000 / src_rate)))
        x = np.interp(np.linspace(0, x.size - 1, n), np.arange(x.size), x).astype(np.float32)
    x = np.clip(x, -1.0, 1.0)
    return (x * 32767.0).astype(np.int16).tobytes()


def _cache_key(text: str) -> str:
    return " ".join(text.strip().lower().split())


def _set_torch_threads() -> None:
    try:
        import torch
        n = int(os.environ.get("TORCH_THREADS") or "8")
        torch.set_num_threads(max(1, n))
        print(f"torch threads={n}", flush=True)
    except Exception as exc:
        print(f"torch threads skipped: {exc}", flush=True)


def _load_moonshine() -> None:
    try:
        from moonshine_voice import ModelArch, Transcriber, get_model_for_language
    except Exception as exc:  # pragma: no cover
        _state["moonshine_error"] = f"moonshine-voice import failed: {exc}"
        print(_state["moonshine_error"], flush=True)
        return
    path = (os.environ.get("MOONSHINE_MODEL_PATH") or "").strip()
    arch = (os.environ.get("MOONSHINE_MODEL_ARCH") or "").strip()
    if not path or not arch:
        try:
            # Tiny streaming is the live-call model. The default download is the
            # largest English model and is the wrong one for this CPU service.
            got_path, got_arch = get_model_for_language(
                "en",
                wanted_model_arch=ModelArch.TINY_STREAMING,
            )
            path = str(got_path)
            arch = got_arch
        except Exception as exc:
            _state["moonshine_error"] = f"moonshine download failed: {exc}"
            print(_state["moonshine_error"], flush=True)
            return
    if not path or not arch:
        _state["moonshine_error"] = "moonshine model path or arch missing"
        print(_state["moonshine_error"], flush=True)
        return
    try:
        arch_enum = arch if isinstance(arch, ModelArch) else ModelArch(int(arch))
        _state["moonshine"] = {
            "factory": Transcriber,
            "path": path,
            "arch": arch_enum,
        }
        print(f"moonshine ready arch={int(arch_enum)} path={path}", flush=True)
    except Exception as exc:
        _state["moonshine_error"] = str(exc)
        print(f"moonshine failed: {exc}", flush=True)


def _load_llm() -> None:
    path = (os.environ.get("QWEN_GGUF_PATH") or "").strip()
    url = (os.environ.get("QWEN_GGUF_URL") or "").strip()
    if not path and url:
        path = "/tmp/qwen.gguf"
        if not Path(path).exists():
            try:
                subprocess.run(["python3", "-c", _download_script(url, path)], check=True)
            except Exception as exc:
                _state["llm_error"] = f"gguf download failed: {exc}"
                return
    if not path or not Path(path).exists():
        _state["llm_error"] = "set QWEN_GGUF_PATH or QWEN_GGUF_URL"
        return
    try:
        from llama_cpp import Llama

        threads = int(os.environ.get("QWEN_THREADS") or "8")
        _state["llm"] = Llama(
            model_path=path,
            n_ctx=2048,
            n_threads=threads,
            n_threads_batch=threads,
            n_batch=512,
            verbose=False,
        )
        print(f"qwen ready threads={threads} batch=512", flush=True)
    except Exception as exc:
        _state["llm_error"] = str(exc)
        print(f"qwen load failed: {exc}", flush=True)


def _download_script(url: str, path: str) -> str:
    return (
        "import urllib.request\n"
        f"urllib.request.urlretrieve({url!r}, {path!r})\n"
    )


def _load_tts() -> None:
    try:
        from pocket_tts import TTSModel
    except Exception as exc:
        _state["tts_error"] = f"pocket-tts import failed: {exc}"
        return
    try:
        model = TTSModel.load_model(language="english")
        voice_name = (os.environ.get("POCKET_VOICE") or "alba").strip() or "alba"
        wav = (os.environ.get("POCKET_VOICE_WAV") or "").strip()
        voice = None
        note = None
        # A wav uses the gated voice-cloning weights. The catalog name does not.
        if wav and Path(wav).exists():
            try:
                voice = model.get_state_for_audio_prompt(wav)
            except Exception as exc:
                note = f"voice clip failed ({exc}); using catalog voice {voice_name}"
                print(note, flush=True)
        if voice is None:
            voice = model.get_state_for_audio_prompt(voice_name)
        rate = int(getattr(model, "sample_rate", 24000) or 24000)
        _state["tts"] = model
        _state["voice"] = voice
        _state["tts_rate"] = rate
        _state["tts_error"] = note
        print(f"pocket tts ready voice={voice_name} rate={rate} stream={hasattr(model, 'generate_audio_stream')}", flush=True)
    except Exception as exc:
        _state["tts_error"] = str(exc)
        print(f"pocket tts failed: {exc}", flush=True)


def _render_pcm(model, voice, text: str) -> bytes:
    rate = int(_state["tts_rate"])
    parts: list[bytes] = []
    started = time.perf_counter()
    first_ms = -1
    for chunk in _tts_chunks(model, voice, text):
        if first_ms < 0:
            first_ms = int((time.perf_counter() - started) * 1000)
        audio = chunk.detach().float().cpu().numpy() if hasattr(chunk, "detach") else np.asarray(chunk)
        parts.append(_to_pcm16_16k(audio, rate))
    pcm = b"".join(parts)
    total_ms = int((time.perf_counter() - started) * 1000)
    print(
        f"pocket render chars={len(text)} bytes={len(pcm)} first_ms={first_ms} total_ms={total_ms}",
        flush=True,
    )
    return pcm


def _warmup_tts() -> None:
    model = _state["tts"]
    voice = _state["voice"]
    if model is None or voice is None:
        return
    for phrase in ("Hello", "Hello, how can I help you today?"):
        try:
            with _lock:
                pcm = _render_pcm(model, voice, phrase)
                if pcm:
                    _pcm_cache[_cache_key(phrase)] = pcm
            if pcm:
                print(f"pocket cached {phrase!r}", flush=True)
        except Exception as exc:
            print(f"pocket cache failed {phrase!r}: {exc}", flush=True)


@app.on_event("startup")
def startup() -> None:
    _set_torch_threads()
    _load_moonshine()
    _load_llm()
    _load_tts()
    threading.Thread(target=_warmup_tts, name="pocket-warmup", daemon=True).start()


@app.get("/health")
def health():
    return {
        "ok": _state["moonshine"] is not None and _state["llm"] is not None and _state["tts"] is not None,
        "moonshine": _state["moonshine"] is not None,
        "llm": _state["llm"] is not None,
        "tts": _state["tts"] is not None,
        "moonshine_error": _state["moonshine_error"],
        "llm_error": _state["llm_error"],
        "tts_error": _state["tts_error"],
    }


@app.websocket("/stt")
async def stt_socket(ws: WebSocket):
    await ws.accept()
    spec = _state["moonshine"]
    if spec is None:
        await ws.send_json({"error": _state["moonshine_error"] or "moonshine not loaded"})
        await ws.close()
        return
    try:
        transcriber = spec["factory"](
            model_path=spec["path"],
            model_arch=spec["arch"],
            update_interval=0.3,
        )
    except Exception as exc:
        print(f"moonshine transcriber failed: {exc}", flush=True)
        await ws.send_json({"error": str(exc)})
        await ws.close()
        return
    lines: list[dict] = []

    from moonshine_voice import TranscriptEventListener

    class Listener(TranscriptEventListener):
        # Methods must live on this subclass. Putting TranscriptEventListener
        # first in a second base class hides these and the call never gets text.
        def on_line_text_changed(self, event):
            text = (event.line.text or "").strip()
            if text:
                lines.append({"text": text, "final": False})

        def on_line_completed(self, event):
            text = (event.line.text or "").strip()
            if text:
                lines.append({"text": text, "final": True})
                print(f"moonshine final chars={len(text)}", flush=True)

        def on_error(self, event):
            print(f"moonshine listener error: {event.error}", flush=True)

    transcriber.add_listener(Listener())
    transcriber.start()
    sample_rate = 16000
    try:
        while True:
            msg = await ws.receive()
            if msg.get("text"):
                try:
                    payload = json.loads(msg["text"])
                except json.JSONDecodeError:
                    continue
                if payload.get("sampleRate"):
                    sample_rate = int(payload["sampleRate"])
                if payload.get("type") == "close":
                    break
                continue
            pcm = msg.get("bytes")
            if not pcm:
                continue
            audio = _pcm16_to_f32(pcm)
            if audio.size == 0:
                continue
            transcriber.add_audio(audio.tolist(), sample_rate)
            while lines:
                await ws.send_json(lines.pop(0))
    except WebSocketDisconnect:
        pass
    finally:
        try:
            transcriber.stop()
        except Exception:
            pass


@app.post("/v1/chat/completions")
async def chat(body: dict):
    llm = _state["llm"]
    if llm is None:
        return JSONResponse({"error": _state["llm_error"] or "llm not loaded"}, status_code=503)
    messages = _messages_for_qwen(body.get("messages") or [])
    max_tokens = int(body.get("max_tokens") or 60)
    temperature = float(body.get("temperature") or 0.3)
    # This 0.8B model does not call tools on a live call. Passing them makes
    # llama.cpp wait on a tool grammar, so the caller hears nothing.
    if body.get("tools"):
        print("qwen ignoring tools", flush=True)

    def generate():
        started = time.perf_counter()
        first_ms = -1
        spoken_chars = 0
        kwargs = {
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "stream": True,
        }
        try:
            with _lock:
                stream = llm.create_chat_completion(**kwargs)
                iterator = iter(stream)
        except Exception as exc:
            print(f"qwen chat failed: {exc}", flush=True)
            raise
        pending = {"buf": "", "skip": False}
        while True:
            try:
                with _lock:
                    chunk = next(iterator)
            except StopIteration:
                break
            except Exception as exc:
                print(f"qwen chat failed: {exc}", flush=True)
                raise
            choice = (chunk.get("choices") or [{}])[0]
            delta = choice.get("delta") or {}
            content = delta.get("content")
            spoken = ""
            if content:
                spoken = _spoken_delta(pending, content)
            if not spoken:
                continue
            if first_ms < 0:
                first_ms = int((time.perf_counter() - started) * 1000)
                print(f"qwen first token ms={first_ms}", flush=True)
            spoken_chars += len(spoken)
            # Lock is free here so Pocket can speak this sentence while the
            # rest of the reply is still being written.
            yield f"data: {json.dumps({'choices': [{'delta': {'content': spoken}}]})}\n\n"
        tail = _spoken_delta(pending, "")
        if tail:
            if first_ms < 0:
                first_ms = int((time.perf_counter() - started) * 1000)
                print(f"qwen first token ms={first_ms}", flush=True)
            spoken_chars += len(tail)
            yield f"data: {json.dumps({'choices': [{'delta': {'content': tail}}]})}\n\n"
        if spoken_chars == 0:
            print("qwen empty reply", flush=True)
            yield f"data: {json.dumps({'choices': [{'delta': {'content': 'Sorry, please say that once more.'}}]})}\n\n"
        print(
            f"qwen done chars={spoken_chars} total_ms={int((time.perf_counter() - started) * 1000)}",
            flush=True,
        )
        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


def _messages_for_qwen(messages: list) -> list:
    """This llama.cpp build has no thinking switch, and the Qwen template
    refuses to run unless there is a user message."""
    cleaned: list[dict] = []
    for raw in messages:
        if not isinstance(raw, dict):
            continue
        role = raw.get("role") or "user"
        content = raw.get("content")
        if isinstance(content, list):
            content = " ".join(
                (part.get("text") if isinstance(part, dict) else str(part)) or ""
                for part in content
            )
        text = str(content or "").strip()
        if not text and role == "system":
            continue
        item = dict(raw)
        item["role"] = role
        item["content"] = text
        cleaned.append(item)
    if not any(m["role"] == "user" and m["content"] for m in cleaned):
        cleaned.append({
            "role": "user",
            "content": "The caller just joined. Greet them in one short spoken sentence. /no_think",
        })
    else:
        for i in range(len(cleaned) - 1, -1, -1):
            if cleaned[i]["role"] == "user" and "/no_think" not in cleaned[i]["content"]:
                cleaned[i]["content"] = cleaned[i]["content"] + " /no_think"
                break
    return cleaned


def _spoken_delta(pending: dict, text: str) -> str:
    """Drop a Qwen think block so only the spoken line is returned."""
    if text == "":
        if pending.get("skip"):
            pending["buf"] = ""
            pending["skip"] = False
            return ""
        leftover = pending.get("buf", "")
        pending["buf"] = ""
        return leftover
    buf = pending.get("buf", "") + text
    out: list[str] = []
    while buf:
        if pending.get("skip"):
            end = buf.find("</think>")
            if end < 0:
                pending["buf"] = buf
                return "".join(out)
            buf = buf[end + len("</think>"):]
            pending["skip"] = False
            continue
        start = buf.find("<think>")
        if start < 0:
            cut = buf.rfind("<")
            if cut >= 0 and cut > len(buf) - 8:
                out.append(buf[:cut])
                pending["buf"] = buf[cut:]
            else:
                out.append(buf)
                pending["buf"] = ""
            return "".join(out)
        out.append(buf[:start])
        buf = buf[start + len("<think>"):]
        pending["skip"] = True
    pending["buf"] = ""
    return "".join(out)


def _tts_chunks(model, voice, text):
    """Yield waveform pieces as Pocket generates them."""
    stream = getattr(model, "generate_audio_stream", None)
    if stream is None:
        yield model.generate_audio(voice, text)
        return
    yield from stream(voice, text, copy_state=True)


@app.post("/tts")
async def tts(body: dict):
    model = _state["tts"]
    voice = _state["voice"]
    if model is None or voice is None:
        return JSONResponse({"error": _state["tts_error"] or "tts not loaded"}, status_code=503)
    text = (body.get("text") or "").strip()
    if not text:
        return JSONResponse({"error": "text required"}, status_code=400)

    def generate():
        frame = 640  # 20 ms at 16 kHz, 16-bit mono
        key = _cache_key(text)
        cached = _pcm_cache.get(key)
        if cached:
            print(f"pocket cache hit chars={len(text)} bytes={len(cached)}", flush=True)
            for i in range(0, len(cached), frame):
                yield cached[i : i + frame]
            return

        pending = bytearray()
        rendered = bytearray()
        rate = int(_state["tts_rate"])
        ready: bytes | None = None
        with _lock:
            ready = _pcm_cache.get(key)
            if ready is None:
                started = time.perf_counter()
                first_ms = -1
                for chunk in _tts_chunks(model, voice, text):
                    if first_ms < 0:
                        first_ms = int((time.perf_counter() - started) * 1000)
                        print(f"pocket first byte chars={len(text)} first_ms={first_ms}", flush=True)
                    audio = chunk.detach().float().cpu().numpy() if hasattr(chunk, "detach") else np.asarray(chunk)
                    piece = _to_pcm16_16k(audio, rate)
                    rendered.extend(piece)
                    pending.extend(piece)
                    while len(pending) >= frame:
                        yield bytes(pending[:frame])
                        del pending[:frame]
                if rendered:
                    _pcm_cache[key] = bytes(rendered)
                print(
                    f"pocket render chars={len(text)} bytes={len(rendered)} total_ms={int((time.perf_counter() - started) * 1000)}",
                    flush=True,
                )
        if ready:
            print(f"pocket cache hit chars={len(text)} bytes={len(ready)}", flush=True)
            for i in range(0, len(ready), frame):
                yield ready[i : i + frame]
            return
        if pending:
            yield bytes(pending)

    return StreamingResponse(generate(), media_type="application/octet-stream")


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT") or "8090"))
