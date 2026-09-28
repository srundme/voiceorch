"""Clean phone audio before the ear.

Echo of our own voice is cancelled on the 8 kHz frames we just sent.
Hush then keeps the caller and turns down another person in the room.
WebRTC noise suppression is the fallback when Hush is not loaded.
"""
from __future__ import annotations

import numpy as np

PHONE_RATE = 8000
EAR_RATE = 16000
NS_FRAME = EAR_RATE // 100  # 10 ms at 16 kHz
NS_BYTES = NS_FRAME * 2
# Mostly the model, a little of the original so a quiet "yes" is not eaten.
HUSH_STRENGTH = 0.85
TAPS = 800  # 100 ms, enough for the phone's echo delay
NLMS_MU = 0.15


class EchoCancel:
    """Block NLMS. Adapts only while we are the loud sound, so the caller is kept."""

    def __init__(self) -> None:
        self.w = np.zeros(TAPS, dtype=np.float32)
        self.hist = np.zeros(TAPS - 1, dtype=np.float32)

    def cancel(self, near: np.ndarray, far: np.ndarray) -> np.ndarray:
        near_f = near.astype(np.float32)
        far_f = far.astype(np.float32)
        if len(far_f) != len(near_f):
            far_f = np.resize(far_f, len(near_f))
        window = np.concatenate([self.hist, far_f])
        views = np.lib.stride_tricks.sliding_window_view(window, TAPS)
        echo = views @ self.w
        err = near_f - echo
        far_power = float(np.dot(far_f, far_f)) / max(len(far_f), 1)
        near_power = float(np.dot(near_f, near_f)) / max(len(near_f), 1)
        if far_power > 40_000 and near_power < far_power * 4:
            power = float(np.dot(views[-1], views[-1])) + 1.0
            self.w += (NLMS_MU / power) * (views.T @ err) / len(err)
            norm = float(np.linalg.norm(self.w))
            if norm > 4:
                self.w *= 4 / norm
        self.hist = window[len(far_f):].astype(np.float32, copy=False)
        return np.clip(np.rint(err), -32768, 32767).astype(np.int16)


class LineCleaner:
    def __init__(self) -> None:
        self.echo = EchoCancel()
        self._far = bytearray()
        self._ns = None
        self._ns_buf = bytearray()
        self.ns_ready = False
        self._hush = None
        self._hush_buf = bytearray()
        self.hush_ready = False
        try:
            from hush._hush_model import HushSession, _get_shared_model

            self._hush = HushSession(_get_shared_model(), atten_lim_db=100.0)
            self.hush_ready = True
        except Exception:
            self._hush = None
        if not self.hush_ready:
            try:
                from webrtc_noise_gain import AudioProcessor

                # AGC off. Level 2 is moderate suppression so a quiet "yes" stays.
                self._ns = AudioProcessor(0, 2)
                self.ns_ready = True
            except Exception:
                self._ns = None

    def render(self, pcm8: bytes) -> None:
        self._far.extend(pcm8)

    def drop_render(self) -> None:
        """Playback was cut. Forget audio the phone will not play."""
        self._far.clear()
        self.echo = EchoCancel()

    def capture(self, pcm8: bytes) -> bytes:
        """Cancel echo on one inbound phone frame. Same length out."""
        even = len(pcm8) // 2 * 2
        if even == 0:
            return b""
        near = np.frombuffer(pcm8[:even], dtype=np.int16)
        if len(self._far) >= even:
            far = np.frombuffer(self._far[:even], dtype=np.int16).copy()
            del self._far[:even]
        else:
            far = np.zeros(len(near), dtype=np.int16)
            self._far.clear()
        return self.echo.cancel(near, far).tobytes()

    def denoise(self, pcm16: bytes) -> bytes:
        """Isolate the caller on 16 kHz PCM. A short tail waits for the next chunk."""
        if not pcm16:
            return pcm16
        if self._hush is not None:
            return self._isolate(pcm16)
        if self._ns is None:
            return pcm16
        self._ns_buf.extend(pcm16)
        out = bytearray()
        while len(self._ns_buf) >= NS_BYTES:
            frame = bytes(self._ns_buf[:NS_BYTES])
            del self._ns_buf[:NS_BYTES]
            out.extend(self._ns.Process10ms(frame).audio)
        return bytes(out)

    def _isolate(self, pcm16: bytes) -> bytes:
        self._hush_buf.extend(pcm16)
        out = bytearray()
        while len(self._hush_buf) >= NS_BYTES:
            raw = bytes(self._hush_buf[:NS_BYTES])
            del self._hush_buf[:NS_BYTES]
            frame = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
            try:
                wet = np.asarray(self._hush.process_frame(frame), dtype=np.float32).reshape(-1)
            except Exception:
                wet = frame
            if len(wet) != len(frame):
                wet = frame
            mixed = (HUSH_STRENGTH * wet) + ((1.0 - HUSH_STRENGTH) * frame)
            out.extend(np.clip(np.rint(mixed * 32767.0), -32768, 32767).astype(np.int16).tobytes())
        return bytes(out)
