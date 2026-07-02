# Advanced Call Settings — Detailed Reference & Interaction Report

This report documents every control in the Agent Builder's Advanced Settings
(Pipeline Latency, Response Timing, Interruption Control, Auto-Redial on
Drop, and Call Limits), grounded in the actual implementation in
`artifacts/api-server/src/orchestration/`. For each control it explains:

- **What it does** in plain terms
- **How it changes the call experience** (from the caller's perspective)
- **How it changes AI performance** (from the pipeline's perspective)
- **Where it lives in code** (config field → consuming code)

The final section, **Cross-Setting Interactions**, answers the "are these
contradictory / do they conflict with each other" question directly — this
is the most important section if you're about to tune multiple sliders at
once, because several of these settings stack additively and a few can
silently cancel each other's intent.

---

## 1. Pipeline Latency

*Tunes each stage of the STT → LLM → TTS pipeline. Lower values cut response
time; higher values add reliability.*

### 1.1 STT Endpointing Silence
- **Field:** `asrEndpointingSilenceMs` → stored in `agent_config`, sent to the STT adapter as `segmentationSilenceTimeoutMs` (Azure) / used as the base value in `computeEndpointMs` for the batch STT path.
- **Default:** 100ms. Range: 50–2000ms.
- **What it does:** This is how long the caller has to stay silent before the speech recognizer decides "they're done talking" and finalizes the transcript.
- **Call experience:** Lower (e.g. 50ms) makes the agent feel snappier — it starts responding almost the instant the caller stops. But it also raises the risk of the agent jumping in while the caller was just taking a breath mid-sentence. Higher (e.g. 400ms) feels more patient and natural for callers who speak slowly or pause between clauses, but every single turn in the call gets slower by that amount.
- **AI performance:** This is a pure "reliability vs. speed" dial. It doesn't change what the LLM says — it changes *when* the pipeline decides it has the full sentence to react to. Set too low, and the STT will frequently hand the LLM incomplete transcripts ("I want to book a…"), producing confused or premature replies.

### 1.2 TTS Early Dispatch Threshold
- **Field:** `ttsMinSentenceChars` → consumed by `extractSentences()` in `pipeline.ts` during LLM streaming.
- **Default:** 15 characters. Range: 5–200ch.
- **What it does:** As the LLM streams its reply token-by-token, the pipeline doesn't wait for the whole sentence — it looks for a comma/clause break and, once it has at least this many characters, fires that fragment to the TTS engine immediately ("early dispatch") instead of waiting for the full sentence.
- **Call experience:** Lower values mean the agent starts *speaking* sooner after it starts *thinking* — you hear the first words of the reply faster. But very low values (e.g. 5) can chop sentences into unnaturally short audio clips with audible micro-gaps between them ("So — I can — help you — with that").
- **AI performance:** Doesn't change what the LLM generates — only how eagerly the audio pipeline segments and ships partial output to the voice synthesizer. This is the main lever for reducing "time to first audio byte."

### 1.3 Post-Transcript Buffer
- **Field:** `linearDelayMs` (UI) / `incrementalDelay` (stored config).
- **Default:** 0ms (off). Range: 0–2000ms.
- **What it does:** An extra artificial wait inserted *after* the STT has finalized a transcript but *before* the LLM is even called.
- **Call experience:** This exists specifically for callers who pause mid-sentence in a way endpointing silence alone doesn't catch (e.g. "I want to book… uhh… a demo for next week"). A non-zero buffer gives them a second chance to keep talking before the agent commits to answering the partial thought. Set to 0 (default), there's no extra wait here at all.
- **AI performance:** This delay happens entirely before the LLM request goes out — it does not affect LLM generation quality, only when generation *starts*. It's a pure latency cost with no upside unless callers in your use case genuinely trail off mid-thought.

### 1.4 LLM Max Output Tokens
- **Field:** `llmMaxTokens` (superseded a legacy `maxTokens` field — the code reads `llmMaxTokens` first).
- **Default:** `auto` / `null` (model default). Range: 1–16000.
- **What it does:** Passed straight through as `max_tokens` to the LLM provider (OpenAI/DeepSeek/Anthropic/etc.), capping how long a single reply can be.
- **Call experience:** A low cap keeps the agent's replies short and punchy — good for phone calls, where long monologues feel unnatural and cost airtime. Too low a cap and replies get cut off mid-sentence, which the caller will hear as the agent abruptly stopping.
- **AI performance:** This directly constrains generation — it's the one setting in this section that can change *what* the caller hears, not just *when*. It also indirectly affects latency: fewer tokens to generate means faster full-reply completion, compounding with the TTS Early Dispatch setting above.

---

## 2. Response Timing (`startSpeakingPlan`)

*Controls how long the agent waits after detecting end-of-turn before it
starts speaking. Applied in `pipeline.ts::processTurn`, **after** the STT
transcript is finalized and **before** the LLM call is triggered.*

All four values here are added together (when applicable) into a single
`delayMs`, and the pipeline hard-caps the **total** at **300ms** — the code
explicitly notes that anything beyond that "adds dead air with no
perceptible naturalness benefit." This cap is important context for every
setting below.

### 2.1 Base Wait (`startSpeakingWaitSecs`)
- **Default:** 0.0s. Range: 0–5s (but effectively capped at 0.3s combined with the others — see above).
- **What it does:** A flat pause added before *every* agent reply, unconditionally.
- **Call experience:** Makes the agent feel like it's "thinking" for a beat before answering — can feel more human, but adds latency to literally every turn including instant ones like "yes."

### 2.2 After Punctuation (`startSpeakingOnPunctuationSecs`)
- **Default:** 0.00s. Range: 0–3s (capped as above).
- **What it does:** Extra delay applied only when the caller's utterance ended with terminal punctuation (`. ? !` or the Hindi/Devanagari `।`) — i.e., a grammatically complete sentence.
- **Call experience:** Complete sentences are the clearest signal the caller is actually done talking, so this delay is normally the least necessary one to increase.

### 2.3 After No Punctuation (`startSpeakingOnNoPunctuationSecs`)
- **Default:** 0.0s. Range: 0–3s (capped as above).
- **What it does:** Extra delay when the utterance has no terminal punctuation — i.e., the transcript looks like it might be incomplete.
- **Call experience:** This is the setting most directly useful for reducing premature interruptions of trailing-off callers, functioning similarly to the Post-Transcript Buffer above but scoped specifically to "unclear ending" utterances rather than all utterances.

### 2.4 After Number (`startSpeakingOnNumberSecs`)
- **Default:** 0.00s. Range: 0–3s (capped as above).
- **What it does:** Extra delay when the utterance ends with a digit — e.g. a caller reading out a phone number, OTP, or account number one digit at a time.
- **Call experience:** Prevents the agent from jumping in after the 5th digit of a 10-digit number just because there was a brief pause between digits.

---

## 3. Interruption Control (Barge-in)

*Configures how caller speech interrupts the agent mid-utterance.*

### 3.1 Allow Barge-in (`bargeInEnabled`)
- **Default:** `true` (screenshot shows it toggled **off** for this agent — see note in §5).
- **What it does:** Master switch. When off, ALL barge-in logic — both energy-based (raw audio) and transcript-based (streaming STT words) — is short-circuited. The agent will always finish its full sentence no matter what the caller says.
- **Call experience:** Off = the agent behaves like an old-school IVR that can't be talked over — good for scripted disclosures/compliance readouts, bad for natural back-and-forth conversation (callers who say "no wait—" get talked over).
- **AI performance:** This is the gate for every other setting in this section — if it's off, Min Words / Min Voice Duration / Back-off Silence / Energy Threshold are all inert (they're only consulted when barge-in is enabled).

### 3.2 Min Words (`stopSpeakingNumWords`)
- **Default:** 0 (off — falls back to internal default of 2 words). Range: 0–10.
- **What it does:** Requires the caller to say at least this many words (from the live streaming transcript) before a transcript-based barge-in fires.
- **Call experience:** Higher values prevent the agent from being derailed by a single stray "um" or "wait" but make genuine interruptions ("stop — I already have that") take slightly longer to register.
- **AI performance:** Also feeds into the minimum-frame calculation for barge-in eligibility (`numWords * 20ms/frame`), so it interacts with Min Voice Duration below — see §5.2.

### 3.3 Min Voice Duration (`stopSpeakingVoiceSecs`)
- **Default:** 0.20s. Range: 0–0.5s.
- **What it does:** How many consecutive frames of caller audio energy above the Energy Threshold are required before an *energy-based* (non-transcript) barge-in fires.
- **Call experience:** This is what lets the agent react to a caller's raw "wait, stop!" even before STT has transcribed it into words. Higher values make barge-in more deliberate (fewer false positives from coughs/background noise); lower values make it hair-trigger.

### 3.4 Back-off Silence (`stopSpeakingBackOffSecs`)
- **Default:** 1.0s. Range: 0–10s.
- **What it does:** An "echo grace" window at the very start of each agent sentence during which barge-in is suppressed entirely, regardless of the other three settings.
- **Call experience / why it exists:** On phone lines, the agent's own voice frequently echoes back into the microphone. Without this grace window, the agent's own speech can be misdetected as the caller interrupting it, causing it to interrupt itself. This setting exists purely to prevent that self-interruption artifact.
- **AI performance:** This is a telephony-line-quality compensation, not a caller-behavior setting. Setting it too low on a noisy/echoey line will cause visible self-interruption glitches; setting it too high makes the agent briefly "deaf" to real interruptions right as it starts talking.

### 3.5 Energy Threshold (`bargeInEnergyThreshold`)
- **Default:** 1200. Range: 100–5000 (RMS units).
- **What it does:** The minimum audio energy level counted as "the caller is speaking" for barge-in purposes.
- **Important nuance:** the pipeline does **not** always use this value verbatim. On telephony calls it self-calibrates: it measures the line's actual echo floor and uses `max(configuredThreshold, measuredEchoFloor × margin)` as the *effective* threshold. So this slider is really a **floor**, not an absolute — on a noisy line the effective threshold will float above whatever you set here. (Browser web calls use a separate hardcoded value of 400 because browser mics have proper echo cancellation and don't need this compensation.)
- **Call experience:** Too low → background noise/line hiss triggers false barge-ins that cut the agent off randomly. Too high → genuine caller interruptions get ignored and the agent talks over them.

---

## 4. Auto-Redial on Drop

*When a call ends unexpectedly (network drop, accidental hang-up), automatically schedule a callback to the same number.*

### 4.1 Enable Auto-Redial
- **Field:** `agentConfig.autoRedial.enabled`. Default: `false`.
- **What it does:** Turns on automatic callback scheduling specifically for calls that end **unexpectedly** (see §5.3 for the precise definition of "unexpected" the code uses).
- **Call experience:** Turns a dropped call into "we'll call you right back" instead of a dead end — meaningfully better for lead-gen/sales use cases where a dropped call otherwise means a lost opportunity.
- **Important scope note:** this only applies outside of campaigns — campaign calls have their own independent retry/spacing system (`call_retries`) and are explicitly excluded from this path.

### 4.2 Redial Delay
- **Field:** `agentConfig.autoRedial.delayMinutes`. Default: 2 min. Range: 1–60 min.
- **What it does:** How long to wait after the drop before dialing back.
- **Call experience:** Too short and you may be re-dialing into the same network hiccup that caused the drop in the first place (e.g. the caller's signal is still bad). Too long and the caller may have moved on / forgotten the context.

### 4.3 Max Attempts per Day
- **Field:** `agentConfig.autoRedial.maxAttempts`. Default: 3. Range: 1–10.
- **What it does:** Hard ceiling on how many times the system will auto-redial the same number in a single day.
- **Call experience:** Protects against a genuinely bad/unreachable number generating an unbounded loop of callback attempts. There's also a hard-coded "single-retry invariant" in the session logic: if the *redial itself* also drops unexpectedly, it will not chain into a second auto-redial from that same callback — this attempt cap governs the daily total, not runaway re-triggering from the redial call itself.

---

## 5. Call Limits

*Hard boundaries on call duration and silence tolerance.*

### 5.1 Silence Timeout
- **Field:** `silenceTimeoutSeconds` (agent-level). Default: 30s (screenshot shows 75s configured). Range: 5–300s.
- **What it does:** If the caller goes completely silent for this long, the pipeline deliberately ends the call.
- **Call experience:** This is a *deliberate, controlled* hangup, not a crash — the call is logged as ending via `silence_timeout`, and the pipeline marks it as a **natural end** (see §6.1 — this matters a lot for how it interacts with Auto-Redial).
- **AI performance:** Prevents the agent (and your provider minutes) from being stuck indefinitely on a call where the caller has walked away or muted themselves.

### 5.2 Max Call Duration
- **Field:** `maxDuration` (agent-level). Default: 300s / 5 min (screenshot shows 43m18s configured — a generous ceiling for a long-form conversation flow). Range: 10s–3600s.
- **What it does:** A hard cutoff — regardless of what's happening in the conversation, the call is forcibly ended once this time elapses.
- **Call experience:** This is a blunt instrument: if the agent is mid-sentence or mid-booking when the timer fires, the call still ends. Like Silence Timeout, this is also logged as a **natural, deliberate end** (`max_duration`), not a drop.

---

## 6. Cross-Setting Interactions — Do These Conflict?

This is the direct answer to "are these settings contradictory to each
other." Short version: **nothing here is broken or contradictory**, but
several settings **stack additively** in ways that are easy to
double-count, and a couple of apparent conflicts turn out to be
non-issues once you see how the code actually classifies call endings.
Below are the interactions worth knowing about before tuning multiple
sliders together.

### 6.1 Silence Timeout / Max Call Duration do **NOT** trigger Auto-Redial — verified, not a conflict
This is the most important one to get right, because it looks like it
*should* conflict: you might expect that if a call ends because the
caller went silent (Silence Timeout) or hit the time ceiling (Max Call
Duration), the system would treat that as an "unexpected drop" and
trigger an Auto-Redial callback.

**It does not.** Both `silence_timeout` and `max_duration` route through
`onCallEnd()` / `endSession()`, which sets the internal
`naturalEndTriggered` flag to `true`. Auto-Redial's eligibility check
(`session.ts`, `wasUnexpectedDrop`) explicitly requires
`naturalEndTriggered === false` — i.e., it only fires when the WebSocket
connection itself closed unexpectedly (a real network drop or the caller
hanging up mid-conversation), not when the *pipeline* chose to end the
call. So: **you can safely combine an aggressive Silence Timeout with
Auto-Redial enabled** — a silence-timeout hangup will never spuriously
trigger a callback.

### 6.2 Pipeline Latency + Response Timing stack additively — the real "hidden cost" pairing
- **STT Endpointing Silence** (0.05–2s) delays *when the transcript finalizes*.
- **Post-Transcript Buffer** (0–2s) adds a further delay *after* that, before the LLM is even called.
- **Response Timing's four delays** (capped at 300ms combined) add on top of that, *after* the buffer, still before the LLM call.

None of these are mutually exclusive — they run in sequence on every
single turn. If you max out several of them at once (e.g. 400ms
endpointing + 500ms post-transcript buffer + 300ms response-timing cap),
you can add nearly **1.2 seconds of dead air before the agent even starts
generating a reply**, on top of whatever the LLM/TTS themselves take. None
of this is a "bug" — each exists to solve a specific caller-pause problem
— but they are not additive by design intent, they're additive by
accident of independent implementation. **Recommendation:** treat STT
Endpointing Silence as your primary lever and leave Post-Transcript
Buffer and Response Timing at/near 0 unless you have a specific,
observed problem (e.g. a caller population that reliably trails off
mid-sentence) that the primary lever doesn't fix.

### 6.3 Allow Barge-in = OFF makes four other sliders inert
Min Words, Min Voice Duration, Back-off Silence, and Energy Threshold are
all barge-in *tuning* parameters — they only matter when barge-in itself
is enabled. Your screenshot shows **Allow Barge-in toggled off** for this
agent. That's not a conflict, but it does mean the four sliders below it
in the UI currently have **zero effect** on this agent's calls — they're
fully configured but dormant. If the intent was to fine-tune interruption
sensitivity (rather than disable interruption entirely), Allow Barge-in
needs to be switched on for those settings to do anything.

### 6.4 Back-off Silence vs. Energy Threshold — same mechanism, different failure modes
Both exist to prevent the agent's own voice-echo from being misread as a
caller interruption, but they solve it from opposite ends:
- **Back-off Silence** = a *time-based* blind spot right after the agent starts speaking.
- **Energy Threshold** = an *amplitude-based* filter (adaptively raised by the measured echo floor on telephony lines).

They're complementary, not redundant — but if you set Back-off Silence
very low (to make the agent instantly interruptible) while also leaving
Energy Threshold low, you're removing both echo defenses simultaneously.
On a line with real echo, that combination is the one most likely to
produce the agent audibly interrupting itself.

### 6.5 Min Words vs. Min Voice Duration — two different "how much speech counts" gates, evaluated independently
`stopSpeakingNumWords` gates the **transcript-based** barge-in path (needs
STT to have produced that many words), while `stopSpeakingVoiceSecs`
gates the **energy-based** path (raw audio, no STT needed) — the
barge-in fires from *whichever path clears its own bar first*
(`max` of the two frame-equivalents is used internally as the
floor for the energy path, but the word-count path can fire on its own
transcript timeline). Setting one high and the other at 0 doesn't
"cancel out" — it just means one path is effectively disabled while the
other remains the sole trigger. If you want interruption to require
*genuine sustained speech* (not just one word or a brief noise spike), both
need to be raised together; raising only one leaves the other as a low
bar that still lets barge-in fire easily.

### 6.6 LLM Max Output Tokens vs. TTS Early Dispatch Threshold — compounding, not conflicting
A low `llmMaxTokens` cap shortens total generation time, and a low
`ttsMinSentenceChars` makes the pipeline start speaking sooner within
that shorter generation. These two are the correct pair to tune *together*
if your goal is to minimize perceived latency — lowering only one gives a
partial win.

### 6.7 Auto-Redial Max Attempts is a daily ceiling, not a per-incident one
There's no built-in interaction between Redial Delay and Max Attempts
beyond simple arithmetic (e.g. a 2-minute delay with a 3-attempt cap
means at most ~6 minutes of retry activity before the system gives up
for the day) — but note the cap resets daily, so a persistently
unreachable number will still get re-attempted on subsequent days
indefinitely unless the campaign/agent is paused. This isn't a conflict
with anything else in this document, just worth knowing if you're
depending on the cap as a permanent stop.

---

## Quick Reference Table

| Section | Setting | Default | Safe to change independently? |
|---|---|---|---|
| Pipeline Latency | STT Endpointing Silence | 100ms | Yes — primary latency lever |
| Pipeline Latency | TTS Early Dispatch Threshold | 15ch | Yes |
| Pipeline Latency | Post-Transcript Buffer | 0ms (off) | Yes, but stacks with §6.2 |
| Pipeline Latency | LLM Max Output Tokens | auto | Yes, pair with TTS threshold (§6.6) |
| Response Timing | Base Wait | 0.0s | Stacks — 300ms combined cap |
| Response Timing | After Punctuation | 0.00s | Stacks — 300ms combined cap |
| Response Timing | After No Punctuation | 0.0s | Stacks — 300ms combined cap |
| Response Timing | After Number | 0.00s | Stacks — 300ms combined cap |
| Interruption Control | Allow Barge-in | on (off in screenshot) | Gates all 4 settings below (§6.3) |
| Interruption Control | Min Words | off | Pair with Min Voice Duration (§6.5) |
| Interruption Control | Min Voice Duration | 0.20s | Pair with Min Words (§6.5) |
| Interruption Control | Back-off Silence | 1.0s | Pair with Energy Threshold (§6.4) |
| Interruption Control | Energy Threshold | 1200 | Adaptive floor on telephony (§3.5) |
| Auto-Redial | Enable Auto-Redial | off | Does not conflict with Call Limits (§6.1) |
| Auto-Redial | Redial Delay | 2 min | — |
| Auto-Redial | Max Attempts/Day | 3 | Daily reset (§6.7) |
| Call Limits | Silence Timeout | 30s | Does not trigger Auto-Redial (§6.1) |
| Call Limits | Max Call Duration | 300s | Does not trigger Auto-Redial (§6.1) |
