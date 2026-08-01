---
name: Local ECAPA-TDNN speaker recognition
description: Azure Speaker Recognition replaced by SpeechBrain ECAPA-TDNN running locally in the gender-service. Covers why, how embeddings are stored, and what to watch for.
---

## The rule
Speaker recognition (voice prints) now uses a local SpeechBrain ECAPA-TDNN model. No Azure key or Microsoft approval required.

**Why:** Azure Speaker Recognition v2.0 is "Limited Access" since June 2023. All subscriptions return 401 without explicit Microsoft approval regardless of key or region.

**How to apply:** Never add back Azure Speaker Recognition calls. The local model is in `artifacts/gender-service/speaker_recognition.py`.

## Architecture

- **Model:** `speechbrain/spkrec-ecapa-voxceleb` — 192-dim d-vector embeddings, ~83 MB weights, downloads from HuggingFace automatically at first startup
- **Service:** gender-service FastAPI (`localhost:5000`)
  - `POST /voice-analysis/speaker/embed` — takes WAV file upload → returns `{embedding: float[]}`
  - `POST /voice-analysis/speaker/verify` — takes WAV + reference_embedding → returns `{similarity, embedding}`
  - `GET /voice-analysis/speaker/health` — returns `{loaded: bool}`
- **DB:** `voice_prints.embedding text` (nullable) — stores JSON.stringify of the 192-dim float array
- **Profile ID:** `voice_prints.azure_profile_id` still used but now stores a local `randomUUID()` — column name kept to avoid migration complexity

## Key behaviours in speakerRecognition.ts

- **Enrollment:** extract embedding from call audio → weighted-blend with existing (70% existing + 30% new) → store; progressive refinement across calls
- **Identification:** cosine similarity of query embedding vs all enrolled prints; threshold = 0.5
- **Speaker change:** compare each 5-second window against `ownEmbedding` (stored in memory); two consecutive windows below 0.4 → fire `onSpeakerChange`
- **testAzureConnection():** kept same export name; now tests local service health endpoint

## Installation

SpeechBrain must be installed in the correct Python env:
```
/home/runner/workspace/.pythonlibs/bin/python3 -m pip install speechbrain
```
Also in `artifacts/gender-service/requirements.txt` as `speechbrain>=1.0.0`.

The gender-service warmup background task pre-loads the model so the first real request is not slow (~10 s cold start on first ever download, <2 s if weights are cached in /tmp/speechbrain_ecapa).

## Cross-number matching (Aug 2026)
Same-person cross-device telephony cosine ≈ 0.42–0.46 (16k-trained ECAPA on 8k audio) — the 0.82 hard bar is unreachable across handsets. Layered decision now in voiceMemoryStore:
1. Hard match ≥0.82 (unchanged).
2. Sticky link: phones already sharing a personKey stay linked regardless of today's score.
3. Name-corroborated soft link: score ≥0.40 (VOICE_MEMORY_SOFT_MATCH_THRESHOLD) + margin ≥0.10 over next-best different person + same normalized caller_profiles.name (≥3 chars); never moves a phone between existing clusters on soft evidence.
Deleting caller memory (dashboard route) now also deletes the voiceprint (self + squad owner), with the :phone param canonicalized.
