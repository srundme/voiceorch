---
name: Gender service startup — lazy librosa import
description: Why top-level `from gender_detector import classify_audio_bytes` blocks deployment
---

**Rule:** Never import librosa (or any heavy scientific Python library) at the top level of a FastAPI/uvicorn main.py in production. Always use lazy inline imports inside functions.

**Why:** Python executes top-level imports before uvicorn starts. librosa/numpy JIT compilation takes 20-40 seconds. During that time the port is not bound, so deployment health checks time out ("not all artifact ports opened within timeout"). The failure manifests as the service producing ZERO stdout/stderr in production logs — the process is alive but stuck importing.

**How to apply:** In `artifacts/gender-service/main.py`, all `from gender_detector import classify_audio_bytes` are inside the functions that call it. Python caches sys.modules so only the first call pays the loading cost. Also run the warmup via `loop.run_in_executor(ThreadPoolExecutor, ...)` so it doesn't block the async event loop.

---

**Rule (gender-ml-v2 ML deps):** This service's heavy ML packages (`torch`, `torchaudio`, `transformers`, `speechbrain`) are NOT installable via `uv` and are NOT in `uv.lock`. `pyproject.toml [tool.uv.sources]` pins them to the `pytorch-cpu` index, which doesn't actually serve them, so `uv add transformers` fails ("no versions available"). Install them with plain `pip` against the firewall PyPI instead. The single durable source of truth is `artifacts/gender-service/requirements.txt`: the Docker/Railway image installs from it, and `scripts/post-merge.sh` also `pip install`s it so the Replit-side runtime is deterministic. Do NOT rely on manual `.pythonlibs` state alone — it's gitignored and won't survive a clean merge.

**Why:** A missing ML dependency surfaces as an unhandled HTTP 500 on every gender-detection call (top-level `from transformers import pipeline` raises `ModuleNotFoundError` at import time). The fragile part is dependency *provisioning*, not the code.

**How to apply:** When adding/upgrading an ML dep for this service, edit `requirements.txt` (not pyproject/uv). To diagnose a regression, hit `GET /voice-analysis/ready` first — it returns 503 + the failing check (soundfile / torch / transformers / wav2vec2 model). The handler degrades to a 200 `{estimated_gender:"unknown"}` (generic `error` flag only — never leak exception text to clients; full traceback goes to logs), so a 500 there means something outside the wrapped block.
