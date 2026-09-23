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
from pathlib import Path

import numpy as np
import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, StreamingResponse

app = FastAPI()
_lock = threading.Lock()
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


def _load_moonshine() -> None:
    try:
        from moonshine_voice import Transcriber
    except Exception as exc:  # pragma: no cover
        _state["moonshine_error"] = f"moonshine-voice import failed: {exc}"
        return
    path = (os.environ.get("MOONSHINE_MODEL_PATH") or "").strip()
    arch = (os.environ.get("MOONSHINE_MODEL_ARCH") or "").strip()
    if not path or not arch:
        try:
            proc = subprocess.run(
                ["python3", "-m", "moonshine_voice.download", "--language", "en"],
                check=True,
                capture_output=True,
                text=True,
            )
            for line in (proc.stdout + "\n" + proc.stderr).splitlines():
                if line.startswith("Model arch:"):
                    arch = line.split(":", 1)[1].strip()
                if line.startswith("Downloaded model path:"):
                    path = line.split(":", 1)[1].strip()
        except Exception as exc:
            _state["moonshine_error"] = f"moonshine download failed: {exc}"
            return
    if not path or not arch:
        _state["moonshine_error"] = "moonshine model path or arch missing"
        return
    try:
        _state["moonshine"] = {
            "factory": Transcriber,
            "path": path,
            "arch": int(arch),
        }
    except Exception as exc:
        _state["moonshine_error"] = str(exc)


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
            n_batch=128,
            verbose=False,
        )
    except Exception as exc:
        _state["llm_error"] = str(exc)


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
        print(f"pocket tts ready voice={voice_name} rate={rate}", flush=True)
    except Exception as exc:
        _state["tts_error"] = str(exc)
        print(f"pocket tts failed: {exc}", flush=True)


@app.on_event("startup")
def startup() -> None:
    _load_moonshine()
    _load_llm()
    _load_tts()


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
    transcriber = spec["factory"](model_path=spec["path"], model_arch=spec["arch"])
    lines: list[dict] = []

    class Listener:
        def on_line_started(self, event):
            lines.append({"text": event.line.text, "final": False})

        def on_line_text_changed(self, event):
            lines.append({"text": event.line.text, "final": False})

        def on_line_completed(self, event):
            lines.append({"text": event.line.text, "final": True})

    try:
        from moonshine_voice import TranscriptEventListener

        class Bound(TranscriptEventListener, Listener):
            pass

        transcriber.add_listener(Bound())
    except Exception:
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
    messages = body.get("messages") or []
    max_tokens = int(body.get("max_tokens") or 80)
    temperature = float(body.get("temperature") or 0.3)
    tools = body.get("tools")
    tool_choice = body.get("tool_choice") or ("auto" if tools else None)

    def generate():
        with _lock:
            stream = llm.create_chat_completion(
                messages=messages,
                max_tokens=max_tokens,
                temperature=temperature,
                stream=True,
                chat_template_kwargs={"enable_thinking": False},
                **({"tools": tools, "tool_choice": tool_choice} if tools else {}),
            )
            for chunk in stream:
                choice = (chunk.get("choices") or [{}])[0]
                delta = choice.get("delta") or {}
                if not delta.get("content") and not delta.get("tool_calls"):
                    continue
                payload = {"choices": [{"delta": delta}]}
                yield f"data: {json.dumps(payload)}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


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
        with _lock:
            audio = model.generate_audio(voice, text)
        pcm = _to_pcm16_16k(np.asarray(audio), int(_state["tts_rate"]))
        frame = 640  # 20 ms at 16 kHz, 16-bit mono
        for i in range(0, len(pcm), frame):
            yield pcm[i : i + frame]

    return StreamingResponse(generate(), media_type="application/octet-stream")


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT") or "8090"))
