"""Cut the Irfan reference at a pause and transcribe that piece for voice cloning."""
import json
import urllib.request
import wave

import numpy as np

SRC = "/workspace/voices/irfan-ref.wav"
DEST = "/workspace/voices/irfan-clone.wav"
TEXT = "/workspace/voices/irfan-clone.txt"

with wave.open(SRC) as w:
    sr = w.getframerate()
    params = w.getparams()
    x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16)

win = int(sr * 0.02)
frames = x[: len(x) // win * win].reshape(-1, win).astype(np.float32)
rms = np.sqrt((frames**2).mean(axis=1)) / 32768
quiet = rms < 0.01

# Longest run of quiet frames that ends between 8 s and 12 s.
best = None
run = 0
for i, q in enumerate(quiet):
    run = run + 1 if q else 0
    t = i * 0.02
    if 8.0 <= t <= 12.0 and run >= 10 and (best is None or run > best[1]):
        best = (i, run)
cut_frame = (best[0] - best[1] // 2) if best else int(10.0 / 0.02)
cut = cut_frame * win
clip = x[:cut]

with wave.open(DEST, "w") as out:
    out.setparams(params)
    out.writeframes(clip.tobytes())

x16 = np.interp(np.linspace(0, len(clip) - 1, int(len(clip) * 16000 / sr)), np.arange(len(clip)), clip)
req = urllib.request.Request(
    "http://127.0.0.1:8787/v1/audio/transcriptions",
    data=x16.astype(np.int16).tobytes(),
    headers={"Content-Type": "audio/L16"},
)
text = json.loads(urllib.request.urlopen(req, timeout=60).read())["text"]
with open(TEXT, "w") as f:
    f.write(text)
print(f"cut at {cut / sr:.2f}s pause_frames={best[1] if best else 0}")
print(text)
