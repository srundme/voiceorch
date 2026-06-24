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
