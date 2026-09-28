"""Save one caller turn at each stage, so a miss can be blamed on the audio or the ear.

raw and aec are the 8 kHz frames that entered the listen path, including a short preroll.
submitted is the exact 16 kHz segment posted to Whisper after resample, Hush, and VAD.
Those files are the same turn. They are not sample-locked: the resampler and Hush add delay.
"""
from __future__ import annotations

import json
import wave
from pathlib import Path

PHONE_RATE = 8000
EAR_RATE = 16000
# Matches the 8 VAD windows kept before speech is accepted (32 ms * 8).
PREROLL_8K = int(0.256 * PHONE_RATE) * 2
MAX_TURNS = 200
ROOT = Path("/workspace/irfan-pod/stt-compare")


def _wav(path: Path, pcm: bytes, rate: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(pcm)


class TurnCapture:
    def __init__(self, root: Path = ROOT) -> None:
        self.root = root
        self.raw = bytearray()
        self.aec = bytearray()
        self.listening = False
        self.call_dir: Path | None = None
        self.saved = 0

    def start(self, call_id: str) -> None:
        safe = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in call_id)[:80] or "call"
        self.call_dir = self.root / safe

    def push(self, raw8: bytes, aec8: bytes) -> None:
        if self.saved >= MAX_TURNS:
            return
        self.raw.extend(raw8)
        self.aec.extend(aec8)
        if not self.listening:
            extra = len(self.raw) - PREROLL_8K
            if extra > 0:
                del self.raw[:extra]
                del self.aec[:extra]

    def begin(self) -> None:
        self.listening = True

    def take(self) -> tuple[bytes, bytes]:
        raw, aec = bytes(self.raw), bytes(self.aec)
        self.raw.clear()
        self.aec.clear()
        self.listening = False
        return raw, aec

    def save(self, call_id: str, raw8: bytes, aec8: bytes, submitted16: bytes, heard: str) -> None:
        if self.saved >= MAX_TURNS or not submitted16:
            return
        if self.call_dir is None:
            self.start(call_id or "call")
        turn = self.call_dir / f"{self.saved:03d}"
        _wav(turn / "raw8.wav", raw8, PHONE_RATE)
        _wav(turn / "aec8.wav", aec8, PHONE_RATE)
        _wav(turn / "submitted16.wav", submitted16, EAR_RATE)
        (turn / "heard.txt").write_text(heard)
        note = {
            "heard": heard,
            "raw8_ms": round(len(raw8) / 2 / PHONE_RATE * 1000),
            "aec8_ms": round(len(aec8) / 2 / PHONE_RATE * 1000),
            "submitted16_ms": round(len(submitted16) / 2 / EAR_RATE * 1000),
            "align": "same turn, not sample-locked; resampler and Hush add delay",
        }
        (turn / "note.json").write_text(json.dumps(note))
        self.saved += 1
