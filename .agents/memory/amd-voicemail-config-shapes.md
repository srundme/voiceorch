---
name: AMD / voicemail-detection config shapes
description: Twilio/Plivo AMD is synchronous on the answer webhook; VoBiz verdict ONLY arrives via async machine_detection_url; agent voicemail config has two incompatible shapes normalized by resolveAmdConfig
---

# Outbound AMD (answering-machine / voicemail detection)

## Two agentConfig shapes (the trap)
The dashboard writes the voicemail-detection setting in TWO incompatible shapes:
- assistants.tsx → `voicemailDetection: boolean` + `machineDetectionMode: "Enable" | "DetectMessageEnd"`
- builder.tsx / edit.tsx → `machineDetectionMode: "disabled" | "enable" | "detect_message_end"` (no bool)

**How to apply:** Never check one field alone. Use `resolveAmdConfig(agentConfig)` (exported from `orchestration/telephony/dial.ts`) which returns `{ enabled, twilioMode }` and handles both shapes. Used by calls.ts + campaignCaller.ts.

The vibe-chat builder now writes the canonical enum shape (`machineDetectionMode: "detect_message_end"`, plus legacy `voicemailDetection` for back-compat) and its refine seeding normalizes via `resolveAmdConfig` too. Same class of trap for call transfer: the edit page represents transfer ONLY as a `call_transfer` tool in `agent.tools` (with `transferTo`/`transferName` on the tool), while older vibe-created agents used `agentConfig.callTransferEnabled`/`transferPhoneNumber` — read the tool first, fall back to agentConfig. Note: the edit-page dropdown offers only `disabled`/`detect_message_end` — writing `"enable"` renders a blank Select.

## Twilio/Plivo: synchronous gating. VoBiz: async callback ONLY (the trap)
**Why:** AMD should complete BEFORE the AI conversation starts. Twilio/Plivo deliver a trusted verdict ON the answer webhook (Twilio `AnsweredBy`, Plivo `Machine`), so `applyAmdGate()` branches synchronously there: human/unknown/absent → open AI stream; machine → enact `voicemailAction` via static XML. **VoBiz does NOT**: per its docs, `machine_detection=true` alone never puts a verdict on the answer_url — the verdict arrives ONLY via the asynchronous `machine_detection_url` callback. Waiting for the sync flag meant voicemail was never detected on live VoBiz calls.

**How it works now (VoBiz):**
- AMD-enabled VoBiz outbound dials set `machine_detection_url` = `/api/webhooks/vobiz/amd?agentId=…` + `machine_detection_time` (env `AMD_VOBIZ_DETECTION_TIME_MS`, default 3000, clamped 2000–10000) on the dial (calls.ts + campaignCaller.ts → dialVobiz).
- The answer webhook arms acoustic confirmation UNCONDITIONALLY (hint-independent): `?amdArm=1` on the WS URL → `createSession({ amdArmed })` → `amdConfirm` set with `hint:false`. The greeting is held while `confirmAmdMachineThenBranch()` listens.
- `/webhooks/vobiz/amd` is now an in-call trigger: it resolves the LIVE session (CallUUID → `getSessionByExternalCallId`, fallback RequestUUID/CallUUID → call metadata LIKE → `getSessionByCallId`) and calls `pipeline.onExternalAmdSignal(verdict, source)`. No live session → legacy persistence-only fallback.
- The external verdict CORROBORATES, never decides alone: "human" → greet immediately; "machine" → lowers the continuous-speech bar to `AMD_EXTERNAL_MACHINE_CONTINUOUS_MS` (2000) and extends the window once by `AMD_EXTERNAL_MACHINE_EXTEND_MS` (2000), but acoustic evidence still confirms.
- Single-resolution: `amdResolved` latch set when the window resolves; late/duplicate callbacks are logged + ignored (first external signal wins).
- Twilio/Plivo `/webhooks/{provider}/amd` routes remain persistence-only (204).
- `amd_result` persists the CONFIRMED verdict via `onAmdResult`; raw-flag persistence only when no live session was found.

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
