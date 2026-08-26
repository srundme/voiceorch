---
name: VoBiz carrier-native noise cancellation
description: VoBiz denoises all calls at its telecom media layer with no API toggle; our software noise gate is bypassed on VoBiz-carried calls.
---

# VoBiz carrier-native noise cancellation

**Rule:** VoBiz performs noise removal / voice isolation natively in its media layer on EVERY call. There is no API parameter to enable/disable it — verified by sweeping the complete VoBiz docs corpus (llms.txt + llms-full.txt + `<Stream>` attributes + make-call params, Jul 2026): zero mentions of noise/isolation anywhere in the API surface. Marketing's "noise cancellation / voice isolation / HD voice" claims are automatic telecom-layer processing, not opt-in features.

**Consequence in our pipeline:** the software noise gate (NoiseCanceller attenuation) does not run on VoBiz-carried audio by default — same treatment as webcall (browser AEC). Because every new agent defaults to `telephonyProvider: "vobiz"`, this made the Builder's "Noise Cancellation" toggle a **silent no-op for effectively the whole fleet**, which is what field complaints ("noise cancellation is not working") actually described: flipping the switch changed nothing and nothing in the logs said so.

**Why the bypass:** running our gate on already-denoised audio is double-processing with documented history of attenuating quiet one-word replies ("yes"/"okay"). Carrier NC upstream + software gate downstream compounds that loss risk for zero benefit. So the bypass stays the DEFAULT — it is not a bug.

**Where the decision lives (Aug 2026):** `orchestration/noise-gate.ts` → `resolveSoftwareNoiseGate()`. The VoBiz WS handler no longer passes `noiseCancel` at all; the pipeline arbitrates once per call because the decision needs agent config the transport doesn't have. Precedence on VoBiz: per-agent `agent_config.forceSoftwareNoiseGate` > `VOBIZ_FORCE_SOFTWARE_NC=1` (fleet-wide env) > carrier bypass. The agent toggle is checked first everywhere — an explicitly OFF toggle is never re-enabled by an override.

**Escape hatches:**
- Per-agent (preferred): `agent_config.forceSoftwareNoiseGate = true`, exposed in Builder → Listening and the Edit page as "Also run our noise filter on VoBiz" (only rendered for VoBiz agents with the toggle on). Use this to trial one complaining customer instead of the fleet.
- Fleet-wide: `VOBIZ_FORCE_SOFTWARE_NC=1` (env), unchanged.

**How to apply:**
- Every call logs one `"Noise cancellation resolved"` line with `telephonyProvider`, `toggle`, `softwareGate`, and `reason` (`vobiz-carrier` | `agent-override` | `env-override` | `browser-aec` | `software-gate` | `agent-toggle-off`). Read that line FIRST on any NC complaint — it answers "was the gate actually on?" without guessing.
- Call recordings are captured BEFORE noise cancellation (`recording.addCallerChunk` runs ahead of `processAudioIn`), so a noisy recording is expected even when the gate is working. Never diagnose NC from the recording alone.
- Mic Sensitivity's `gateRatio` lever is inert whenever the gate is bypassed; `vadThreshold` + barge-in thresholds still fully apply — the worker computes VAD/hasSpeechEnergy on every frame regardless of the noiseCancel flag.
- Don't "fix" background-talker complaints on VoBiz by enabling the software gate first — bystander voices are usually a barge-in/`vadThreshold` problem, and a second denoiser costs quiet one-word replies.
- Related marketing claims decoded: "80 ms latency" = their carrier routing latency (unrelated to our pipeline TTFT); "stereo recording" = their recording feature, which we don't use (we record in-pipeline).
