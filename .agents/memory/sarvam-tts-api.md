---
name: Sarvam TTS API quirks
description: Sarvam Bulbul TTS — correct models, speaker sets, endpoint facts (tested Jun 2026)
---

## Rules

**Valid models (Jun 2026):** `bulbul:v3` (recommended), `bulbul:v3-beta`, `bulbul:v2`  
`bulbul:v1` no longer accepted — API returns 400 "Input should be 'bulbul:v2', 'bulbul:v3-beta' or 'bulbul:v3'".

**Speaker sets differ by model:**
- `bulbul:v2` (7): anushka, abhilash, manisha, vidya, arya, karun, hitesh
- `bulbul:v3` (38+): ritu, aditya, priya, neha, rahul, pooja, rohan, simran, kavya, amit, dev, ishita, shreya, ratan, varun, manan, sumit, roopa, kabir, aayan, shubh, ashutosh, advait, anand, tanya, tarun, sunny, mani, gokul, vijay, shruti, suhani, mohit, kavitha, rehan, soham, rupali (and more)
- v2 speakers are NOT compatible with v3 and vice versa — API returns 400 with clear message

**Streaming endpoint `POST /text-to-speech-streaming` returns 404** — does not exist.  
Only buffered `POST /text-to-speech` works → returns `{audios: [base64_wav]}`.  
Strip 44-byte WAV header to get raw PCM s16le @ 16kHz.

**Auth header:** `api-subscription-key: <key>` (NOT Authorization Bearer).

**Why:** Confirmed by direct API testing. Original code had wrong voice names (meera, pavithra etc.) causing 400s and tried the non-existent streaming endpoint causing 404s → "TTS synthesis failed during greeting".

**How to apply:** Use `bulbul:v3` as default model. Only use v2 speakers with v2 model; v3 speakers with v3/v3-beta. Never implement `synthesizeStream` for Sarvam until the endpoint is confirmed live.
