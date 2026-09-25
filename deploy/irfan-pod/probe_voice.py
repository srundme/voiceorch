"""Time first audio and speed for a streaming /v1/audio/speech server, and save samples.

python3 probe_voice.py URL [RATE] [EXTRA_JSON] [TAG]
"""
import json
import sys
import time
import urllib.request
import wave

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8790/v1/audio/speech"
RATE = int(sys.argv[2]) if len(sys.argv) > 2 else 16000
EXTRA = json.loads(sys.argv[3]) if len(sys.argv) > 3 else {}
TAG = sys.argv[4] if len(sys.argv) > 4 else "sample"
LINES = [
    "Got it, Karthik.",
    "Which part of Bangalore are you in right now?",
    "Great, Karthik. I will need a few details to match you with the right voice process role. Shall I start with your name?",
]

for n, line in enumerate(LINES):
    req = urllib.request.Request(
        URL, data=json.dumps({"input": line, **EXTRA}).encode(), headers={"Content-Type": "application/json"},
    )
    start = time.monotonic()
    first = None
    buf = bytearray()
    with urllib.request.urlopen(req, timeout=120) as resp:
        while True:
            chunk = resp.read1(65536)
            if not chunk:
                break
            if first is None:
                first = time.monotonic() - start
            buf += chunk
    total = time.monotonic() - start
    audio = len(buf) / 2 / RATE
    print(f"{len(line):3} chars first_audio={first:.2f}s total={total:.2f}s audio={audio:.2f}s speed={audio / total:.2f}x")
    with wave.open(f"/workspace/voices/{TAG}-{n}.wav", "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(bytes(buf[: len(buf) // 2 * 2]))
