"""Echo cancel keeps the caller and removes a delayed copy of our own voice."""
import unittest

import numpy as np

from phone_audio import EchoCancel, LineCleaner


def _tone(seconds: float, hz: float, amp: float, rate: int = 8000) -> np.ndarray:
    t = np.arange(int(seconds * rate)) / rate
    return (np.sin(2 * np.pi * hz * t) * amp).astype(np.int16)


def _rms(pcm: np.ndarray) -> float:
    if len(pcm) == 0:
        return 0.0
    return float(np.sqrt(np.mean(pcm.astype(np.float32) ** 2)))


class EchoTests(unittest.TestCase):
    def test_delayed_copy_drops(self):
        far = _tone(1.0, 440, 8000)
        delay = 80
        echo = np.zeros_like(far)
        echo[delay:] = (far[:-delay].astype(np.float32) * 0.6).astype(np.int16)
        cancel = EchoCancel()
        out = []
        for index in range(0, len(far), 160):
            out.append(cancel.cancel(echo[index:index + 160], far[index:index + 160]))
        cleaned = np.concatenate(out)
        tail = cleaned[len(cleaned) // 2:]
        self.assertLess(_rms(tail), _rms(echo[len(echo) // 2:]) * 0.5)

    def test_silence_on_the_line_leaves_the_caller(self):
        caller = _tone(0.4, 220, 4000)
        cancel = EchoCancel()
        out = []
        for index in range(0, len(caller), 160):
            frame = caller[index:index + 160]
            out.append(cancel.cancel(frame, np.zeros_like(frame)))
        cleaned = np.concatenate(out)
        self.assertGreater(_rms(cleaned), _rms(caller) * 0.9)

    def test_isolate_keeps_the_frame_length(self):
        cleaner = LineCleaner()
        pcm = _tone(0.02, 180, 3000, rate=16000).tobytes()
        cleaned = cleaner.denoise(pcm)
        self.assertEqual(len(cleaned), len(pcm))
        if cleaner.hush_ready:
            # A second person-sized tone should not come back identical.
            self.assertNotEqual(cleaned, pcm)

    def test_capture_matches_length_without_a_reference(self):
        cleaner = LineCleaner()
        frame = _tone(0.02, 300, 1000).tobytes()
        cleaned = cleaner.capture(frame)
        self.assertEqual(len(cleaned), len(frame))


if __name__ == "__main__":
    unittest.main()
