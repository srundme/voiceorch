---
name: Gender service startup — lazy librosa import
description: Why top-level `from gender_detector import classify_audio_bytes` blocks deployment
---

**Rule:** Never import librosa (or any heavy scientific Python library) at the top level of a FastAPI/uvicorn main.py in production. Always use lazy inline imports inside functions.

**Why:** Python executes top-level imports before uvicorn starts. librosa/numpy JIT compilation takes 20-40 seconds. During that time the port is not bound, so deployment health checks time out ("not all artifact ports opened within timeout"). The failure manifests as the service producing ZERO stdout/stderr in production logs — the process is alive but stuck importing.

**How to apply:** In `artifacts/gender-service/main.py`, all `from gender_detector import classify_audio_bytes` are inside the functions that call it. Python caches sys.modules so only the first call pays the loading cost. Also run the warmup via `loop.run_in_executor(ThreadPoolExecutor, ...)` so it doesn't block the async event loop.
