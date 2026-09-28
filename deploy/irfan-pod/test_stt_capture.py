"""A turn keeps the preroll, then the speech, then writes the three wavs."""
import tempfile
import unittest
import wave
from pathlib import Path

from stt_capture import PREROLL_8K, TurnCapture


class CaptureTests(unittest.TestCase):
    def test_preroll_then_speech_then_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            cap = TurnCapture(Path(tmp))
            cap.start("call-1")
            noise = b"\x01\x00" * (PREROLL_8K + 400)
            cap.push(noise, noise)
            self.assertLessEqual(len(cap.raw), PREROLL_8K)
            cap.begin()
            speech = b"\x02\x00" * 800
            cap.push(speech, speech)
            raw, aec = cap.take()
            self.assertIn(b"\x02\x00", raw)
            cap.save("call-1", raw, aec, b"\x03\x00" * 1600, "got the gear")
            turn = Path(tmp) / "call-1" / "000"
            for name, rate in (("raw8.wav", 8000), ("aec8.wav", 8000), ("submitted16.wav", 16000)):
                with wave.open(str(turn / name)) as handle:
                    self.assertEqual(handle.getframerate(), rate)
                    self.assertGreater(handle.getnframes(), 0)
            self.assertEqual((turn / "heard.txt").read_text(), "got the gear")


if __name__ == "__main__":
    unittest.main()
