"""Time first token and tokens/s for an OpenAI-compatible streaming chat server with an Irfan-sized prompt.

python3 probe_brain.py [URL] [MODEL]
"""
import json
import sys
import time
import urllib.request

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000/v1/chat/completions"
MODEL = sys.argv[2] if len(sys.argv) > 2 else "irfan-brain"
RULE = (
    "You are Irfan, a friendly recruiter at JobShop calling candidates for voice process roles in Bangalore. "
    "Ask one question at a time, keep replies under two short sentences, never invent details, and confirm "
    "the candidate's name, city, area, qualification, experience, languages and expected salary. "
)
SYSTEM = (RULE * 90)[:21000]
TURNS = ["Hello?", "Yes, this is Karthik speaking.", "I'm in Bangalore, near Koramangala.", "I finished my B.Com last year."]

history = [{"role": "system", "content": SYSTEM}]
for turn in TURNS:
    history.append({"role": "user", "content": turn})
    body = {"model": MODEL, "messages": history, "stream": True, "max_tokens": 80, "temperature": 0.6}
    req = urllib.request.Request(URL, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    start = time.monotonic()
    first = None
    text = ""
    tokens = 0
    with urllib.request.urlopen(req, timeout=120) as resp:
        for raw in resp:
            line = raw.decode().strip()
            if not line.startswith("data:") or line == "data: [DONE]":
                continue
            delta = json.loads(line[5:])["choices"][0]["delta"].get("content") or ""
            if delta:
                if first is None:
                    first = time.monotonic() - start
                text += delta
                tokens += 1
    total = time.monotonic() - start
    rate = (tokens - 1) / (total - first) if tokens > 1 else 0
    print(f"first_token={first:.2f}s total={total:.2f}s tokens={tokens} rate={rate:.0f} tok/s | {text.strip()[:110]}")
    history.append({"role": "assistant", "content": text})
