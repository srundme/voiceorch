---
name: AMD / voicemail-detection config shapes
description: Outbound AMD gating is synchronous on the answer webhook; agent voicemail config has two incompatible shapes normalized by resolveAmdConfig
---

# Outbound AMD (answering-machine / voicemail detection)

## Two agentConfig shapes (the trap)
The dashboard writes the voicemail-detection setting in TWO incompatible shapes:
- assistants.tsx → `voicemailDetection: boolean` + `machineDetectionMode: "Enable" | "DetectMessageEnd"`
- builder.tsx / edit.tsx → `machineDetectionMode: "disabled" | "enable" | "detect_message_end"` (no bool)

**How to apply:** Never check one field alone. Use `resolveAmdConfig(agentConfig)` (exported from `orchestration/telephony/dial.ts`) which returns `{ enabled, twilioMode }` and handles both shapes. Used by calls.ts + campaignCaller.ts.

## Synchronous gating, not async callback
**Why:** AMD must complete BEFORE the AI conversation starts. The old design dialed with an async `machine_detection_url`/`MachineDetectionUrl` callback that fired after the stream was already open — too late.

**How it works now:**
- Dial requests synchronous detection only: Twilio `MachineDetection` (no AsyncAmd/Url), Plivo `machine_detection:"true"`, Vobiz `machine_detection:"true"` (Plivo-clone assumption — UNVERIFIED on live Vobiz).
- The provider delivers the result ON the answer/voice webhook: Twilio `AnsweredBy`, Plivo `Machine`, Vobiz `MachineDetected`/`Machine`.
- `applyAmdGate()` in webhooks.ts branches there: human/unknown/absent → open AI stream; machine → enact `voicemailAction` (leave_message=speak voicemailMessage+hangup / hangup default / continue=open stream). `unknown` is treated as human.
- The three `/webhooks/{provider}/amd` routes are now persistence-only (204) — they no longer control flow.
- `amd_result` (human/machine/unknown) persisted best-effort by matching `metadata::text LIKE %providerCallId%`.

## VoBiz synchronous AMD is UNRELIABLE — flag is a HINT, confirm acoustically
**Why:** VoBiz's synchronous machine flag false-positives on LIVE HUMANS. On a real
answered call its "machine" verdict routed the caller into voicemail-delivery mode →
~12 s of dead air while the pipeline "listened for the greeting end", then a dropped
voicemail message. The human never heard the agent. But simply ignoring the flag
(`trustMachineFlag:false`, the prior fix) disabled VoBiz voicemail-drop entirely.

**How it works now (acoustic confirmation):**
- `applyAmdGate()` takes an `acousticConfirmXml?: () => string` callback instead of the
  old boolean `trustMachineFlag`. Trusted providers (Twilio/Plivo) omit it → a `machine`
  verdict enacts `voicemailAction` immediately via static XML (`buildVoicemailXml`).
- The VoBiz call site passes `acousticConfirmXml` = `getVobizAnswerXML(..., { amdMachineHint:true })`.
  So a VoBiz `machine` flag ALWAYS opens the normal media stream (never harms a human),
  carrying `?amdHint=machine` on the WS URL. The raw flag is NOT persisted.
- WS URL `amdHint=machine` → `index.ts` parses it → `handleVobizWebSocket(..., amdMachineHint)`
  → `createSession({ amdMachineHint })` → session sets `amdConfirm` + `onAmdResult`.
- `pipeline.confirmAmdMachineThenBranch()` holds the greeting and classifies from inbound
  speech-energy pattern, **biasing strongly toward human**: MACHINE only if one continuous
  speech run reaches `AMD_CONTINUOUS_GREETING_MS` (a voicemail greeting is a long monologue);
  HUMAN on short-utterance+pause, no-speech-shortly-after-answer, or window elapsed ambiguously.
- Only a CONFIRMED machine enacts the action (leave_message → `deliverVoicemail()`, continue →
  greet, else hangup). The acoustically-confirmed verdict (NOT the raw flag) is persisted via
  `onAmdResult` → `calls.amdResult`.
- Env knobs (defaults in `pipeline.ts`): `AMD_CONFIRM_WINDOW_MS` (4000, hard cap),
  `AMD_CONTINUOUS_GREETING_MS` (3000, machine threshold), `AMD_SPEECH_GAP_MS` (400, ends a run),
  `AMD_HUMAN_PAUSE_MS` (700), `AMD_NO_SPEECH_HUMAN_MS` (1500), `AMD_CONFIRM_ENERGY_THRESHOLD` (300).

**How to apply:** Never re-trust the raw VoBiz flag or enact voicemail on it directly. Keep
Twilio/Plivo on the trusted static-XML path. The `vm=1` legacy voicemail-delivery WS route
still exists but the VoBiz answer webhook no longer uses it (superseded by `amdHint=machine`).
