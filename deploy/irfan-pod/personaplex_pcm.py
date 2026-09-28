"""Warm PersonaPlex line. Sruthi's clip is the only voice. No American presets.

Loads once, runs the voice and role prompt once, then keeps that state.
Each call copies the warmed state back, so the first hello has no boot.
Phone audio is PCM16 mono 8 kHz in and out. The model runs at 24 kHz.
"""
from __future__ import annotations

import asyncio
import json
import os
import time
from pathlib import Path

import numpy as np
import torch
from aiohttp import WSMsgType, web

from moshi.models import LMGen, loaders
from moshi.models.lm import load_audio

MODEL_DIR = Path(os.environ.get("PERSONAPLEX_DIR", "/workspace/models/personaplex-7b-v1"))
VOICE_WAV = Path(os.environ.get("SRUTHI_VOICE", "/workspace/voices/sruthi-clone.wav"))
HOST = os.environ.get("PERSONAPLEX_HOST", "127.0.0.1")
PORT = int(os.environ.get("PERSONAPLEX_PORT", "8998"))
PHONE_RATE = 8000
PROMPT = (
    "You are Sruthi, a woman from Bangalore and a Jobshop recruiter on a phone call. "
    "Jobshop is India's largest BPO recruitment company. This person applied for a BPO job on Naukri. "
    "Speak only simple Indian English, warm and brief, the way the voice sample speaks. "
    "Never use an American accent. Never introduce yourself as anyone else. "
    "Your first words are: Hello, this is Sruthi from Jobshop. How may I assist you? "
    "Then ask one short question at a time and wait. Do not read a list. Do not say you are filling a form. "
    "If you miss the words, say: Sorry, I missed that. Can you say it once more? "
    "Never ask their gender. Never ask them to rate their English. There is no hidden age cutoff. "
    "Never invent a company, a salary, or an interview time. Interviews are face to face in Bangalore. "
    "If they will not relocate to Bangalore, close politely. If they want a human, say a recruiter will call them. "
    "You cannot transfer the call live. "
    "Collect, one at a time: full name, city, pincode, the role they want, experience, education, "
    "notice period, and expected salary. If you do not have a confirmed opening, say the team will call "
    "when there is a match. Do not invent one."
)


def log(msg: str) -> None:
    print(f"[personaplex] {msg}", flush=True)


def wrap_prompt(text: str) -> str:
    cleaned = text.strip()
    if cleaned.startswith("<system>") and cleaned.endswith("<system>"):
        return cleaned
    return f"<system> {cleaned} <system>"


class WarmState:
    def __init__(self) -> None:
        self.tensors: list[tuple[torch.Tensor, torch.Tensor]] = []
        self.ints: list[tuple[object, str, int]] = []

    def capture(self, lm_gen: LMGen) -> None:
        seen: set[int] = set()

        def walk(obj: object) -> None:
            if obj is None or isinstance(obj, (str, bytes, bool, float)):
                return
            if isinstance(obj, (torch.Tensor, torch.nn.Module)):
                return
            mark = id(obj)
            if mark in seen:
                return
            seen.add(mark)
            if "Graph" in type(obj).__name__:
                return
            if hasattr(obj, "__dataclass_fields__"):
                pairs = [(name, getattr(obj, name)) for name in obj.__dataclass_fields__]
            elif hasattr(obj, "__dict__"):
                pairs = list(vars(obj).items())
            else:
                return
            for key, val in pairs:
                if isinstance(val, torch.Tensor):
                    self.tensors.append((val, val.detach().clone()))
                elif isinstance(val, int) and not isinstance(val, bool):
                    self.ints.append((obj, key, val))
                else:
                    walk(val)

        for state in lm_gen.get_streaming_state().values():
            walk(state)
        log(f"warm snapshot tensors={len(self.tensors)} ints={len(self.ints)}")

    def restore(self) -> None:
        for live, saved in self.tensors:
            live.copy_(saved)
        for obj, key, val in self.ints:
            setattr(obj, key, val)


class Line:
    def __init__(self) -> None:
        self.device = torch.device("cuda")
        self.mimi = None
        self.lm_gen: LMGen | None = None
        self.tokenizer = None
        self.frame_size = 0
        self.warm = WarmState()
        self.lock = asyncio.Lock()
        self.ready = False

    def load(self) -> None:
        if not VOICE_WAV.is_file():
            raise SystemExit(f"Sruthi voice missing: {VOICE_WAV}")
        moshi_weight = MODEL_DIR / "model.safetensors"
        mimi_weight = MODEL_DIR / "tokenizer-e351c8d8-checkpoint125.safetensors"
        tokenizer_path = MODEL_DIR / "tokenizer_spm_32k_3.model"
        for path in (moshi_weight, mimi_weight, tokenizer_path):
            if not path.is_file():
                raise SystemExit(f"missing {path}")
        log("loading weights")
        import sentencepiece

        self.mimi = loaders.get_mimi(mimi_weight, self.device)
        self.mimi.eval()
        lm = loaders.get_moshi_lm(
            moshi_weight,
            device=self.device,
            dtype=torch.bfloat16,
            cpu_offload=False,
        )
        lm.eval()
        self.tokenizer = sentencepiece.SentencePieceProcessor(model_file=str(tokenizer_path))
        self.frame_size = int(self.mimi.sample_rate / self.mimi.frame_rate)
        self.lm_gen = LMGen(
            lm,
            audio_silence_frame_cnt=int(0.5 * self.mimi.frame_rate),
            sample_rate=self.mimi.sample_rate,
            device=self.device,
            frame_rate=self.mimi.frame_rate,
            save_voice_prompt_embeddings=False,
        )
        self.mimi.streaming_forever(1)
        self.lm_gen.streaming_forever(1)
        self._warmup()
        self._prime_sruthi()
        self.ready = True
        log("ready voice=sruthi")

    def _warmup(self) -> None:
        assert self.mimi is not None and self.lm_gen is not None
        log("warmup")
        for _ in range(4):
            chunk = torch.zeros(1, 1, self.frame_size, dtype=torch.float32, device=self.device)
            codes = self.mimi.encode(chunk)
            for index in range(codes.shape[-1]):
                tokens = self.lm_gen.step(codes[:, :, index:index + 1])
                if tokens is None:
                    continue
                self.mimi.decode(tokens[:, 1:9])
        torch.cuda.synchronize()

    def _prime_sruthi(self) -> None:
        assert self.mimi is not None and self.lm_gen is not None and self.tokenizer is not None
        log(f"priming voice {VOICE_WAV}")
        self.lm_gen.load_voice_prompt(str(VOICE_WAV))
        tokens = self.tokenizer.encode(wrap_prompt(PROMPT))
        self.lm_gen.text_prompt_tokens = tokens
        started = time.perf_counter()
        self.lm_gen.step_system_prompts(self.mimi)
        self.mimi.reset_streaming()
        torch.cuda.synchronize()
        log(f"prompt primed in {time.perf_counter() - started:.1f}s tokens={len(tokens)}")
        self.warm.capture(self.lm_gen)
        # Touch the live conversation path, then put the persona state back.
        silence = torch.zeros(1, 1, self.frame_size, dtype=torch.float32, device=self.device)
        for _ in range(4):
            codes = self.mimi.encode(silence)
            for index in range(codes.shape[-1]):
                tokens_out = self.lm_gen.step(codes[:, :, index:index + 1])
                if tokens_out is None:
                    continue
                self.mimi.decode(tokens_out[:, 1:9])
        torch.cuda.synchronize()
        self.warm.restore()
        self.mimi.reset_streaming()

    def begin_call(self) -> None:
        assert self.mimi is not None
        self.warm.restore()
        self.mimi.reset_streaming()

    def step_pcm24(self, frame: np.ndarray) -> tuple[np.ndarray, list[str]]:
        assert self.mimi is not None and self.lm_gen is not None and self.tokenizer is not None
        chunk = torch.from_numpy(np.ascontiguousarray(frame)).to(self.device)
        chunk = chunk.view(1, 1, self.frame_size)
        codes = self.mimi.encode(chunk)
        pieces: list[str] = []
        audio: np.ndarray | None = None
        for index in range(codes.shape[-1]):
            tokens = self.lm_gen.step(codes[:, :, index:index + 1])
            if tokens is None:
                continue
            pcm = self.mimi.decode(tokens[:, 1:9]).detach().float().cpu().numpy()
            audio = pcm[0, 0]
            text_id = int(tokens[0, 0, 0].item())
            if text_id not in (0, 3):
                piece = self.tokenizer.id_to_piece(text_id).replace("▁", " ")
                if piece:
                    pieces.append(piece)
        if audio is None:
            audio = np.zeros(self.frame_size, dtype=np.float32)
        return audio, pieces


LINE = Line()
PHONE_FRAME = 640  # 80 ms at 8 kHz, exactly three times the 24 kHz model frame


def upsample_3(samples: np.ndarray) -> np.ndarray:
    """8 kHz to 24 kHz. Exact 3x, no resampler delay."""
    nxt = np.empty_like(samples)
    nxt[:-1] = samples[1:]
    nxt[-1] = samples[-1]
    out = np.empty(samples.shape[0] * 3, dtype=np.float32)
    out[0::3] = samples
    out[1::3] = (2.0 * samples + nxt) / 3.0
    out[2::3] = (samples + 2.0 * nxt) / 3.0
    return out


def downsample_3(samples: np.ndarray) -> np.ndarray:
    usable = samples.shape[0] - (samples.shape[0] % 3)
    if usable == 0:
        return np.zeros(0, dtype=np.float32)
    return samples[:usable].reshape(-1, 3).mean(axis=1).astype(np.float32)


async def health(_request: web.Request) -> web.Response:
    return web.json_response({
        "ok": LINE.ready,
        "warm": LINE.ready,
        "voice": "sruthi",
        "stack": "personaplex",
    })


async def duplex(request: web.Request) -> web.WebSocketResponse:
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    if not LINE.ready or LINE.mimi is None:
        await ws.send_str(json.dumps({"error": "not warm"}))
        await ws.close()
        return ws
    async with LINE.lock:
        LINE.begin_call()
        pending = np.zeros(0, dtype=np.float32)
        await ws.send_str(json.dumps({"ready": True, "voice": "sruthi"}))
        log("call open")

        async def push_frame(frame24: np.ndarray) -> None:
            audio, pieces = LINE.step_pcm24(frame24)
            if pieces:
                text = "".join(pieces)
                log(f"sruthi:{text}")
                await ws.send_str(json.dumps({"text": text}))
            phone = downsample_3(audio)
            if phone.size == 0:
                return
            pcm = np.clip(phone * 32767.0, -32768, 32767).astype(np.int16)
            await ws.send_bytes(pcm.tobytes())

        try:
            # A short silence lets her start the greeting from the warmed prompt.
            for _ in range(3):
                await push_frame(np.zeros(LINE.frame_size, dtype=np.float32))
            async for msg in ws:
                if msg.type != WSMsgType.BINARY:
                    continue
                samples = np.frombuffer(msg.data, dtype=np.int16).astype(np.float32) / 32768.0
                pending = np.concatenate((pending, samples))
                while pending.shape[0] >= PHONE_FRAME:
                    frame8 = pending[:PHONE_FRAME]
                    pending = pending[PHONE_FRAME:]
                    await push_frame(upsample_3(frame8))
        finally:
            log("call closed")
    return ws


def main() -> None:
    # Confirm the clip is readable before the GPU load.
    audio = load_audio(str(VOICE_WAV), 24000)
    log(f"sruthi clip channels={audio.shape[0]} samples={audio.shape[-1]}")
    LINE.load()
    app = web.Application()
    app.router.add_get("/health", health)
    app.router.add_get("/duplex", duplex)
    log(f"listen {HOST}:{PORT}")
    web.run_app(app, host=HOST, port=PORT, print=None)


if __name__ == "__main__":
    main()
