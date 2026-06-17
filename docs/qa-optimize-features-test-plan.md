# QA Test Plan — Advanced → Optimize Features

## Document Info
- **Product:** VoiceOrch
- **Feature Area:** Agent Builder → Advanced → Optimize
- **Scope:** Sliding Window Context, Auto Summarization, Staged System Prompt (individual + combined)
- **Prepared:** 2026-06-17

---

## Implementation Reference (for testers)

All three features live in `artifacts/api-server/src/orchestration/pipeline.ts`
and apply only to telephony + webcall pipeline calls. Key facts:

| Layer | Feature | Field(s) | Trigger |
|---|---|---|---|
| 2 | Sliding Window | `contextWindowTurns` | Every LLM turn |
| 3 | Auto Summarization | `tokenSummarizationEnabled`, `tokenSummarizationThresholdTurns` | `history.length >= threshold` |
| 4 | Staged Prompt | `stagedPromptEnabled`, `stagedPromptStages`, `stagedPromptCoreIdentity` | Every LLM turn + `[STAGE:X]` tag detection |

- **Global kill switch:** `platform_settings.token_optimization_enabled = "false"` disables all three layers platform-wide (cached 30 s).
- Summarization fires **asynchronously** after the LLM response — it does not block the current turn.
- Stage index (`currentStageIndex`) is per-session; resets to 0 on every new call.
- `webcall.ts` shares the same `OrchestrationPipeline` class so all three layers apply there too.

---

## Part 1 — Sliding Window Context

### TC-SW-01: Basic Window Enforcement

**Objective:** Confirm only the last N turns reach the LLM.

**Preconditions:**
- Agent created with `contextWindowTurns = 3`.
- Token optimisation enabled (platform setting = `"true"` or absent).
- At least one LLM provider configured.

**Test Steps:**
1. Start a call / webcall session with the agent.
2. Exchange 6 turns with distinct, memorable content in each turn (e.g. turn 1 mentions "red", turn 2 "blue", … turn 6 "purple").
3. On turn 7, ask: "What colour did I mention first?"

**Test Data:**
```
Turn 1 caller: "The first colour is red."
Turn 2 caller: "The second colour is blue."
Turn 3 caller: "The third colour is green."
Turn 4 caller: "The fourth colour is yellow."
Turn 5 caller: "The fifth colour is orange."
Turn 6 caller: "The sixth colour is purple."
Turn 7 caller: "What colour did I mention very first?"
```

**Expected Result:**
- Agent cannot recall "red" (it was turn 1, outside the 3-turn window).
- Agent correctly recalls content from turns 5/6/7.
- Backend log at DEBUG: `sentHistoryLen = 3` vs `fullHistoryLen = 6` visible in `onUsage` savings calculation path (`pipeline.ts:1676`).

**Pass/Fail Criteria:**
- PASS: Agent says it doesn't remember or cannot find the first colour.
- FAIL: Agent correctly names "red" from turn 1.

---

### TC-SW-02: Older Turns Dropped, Recent Turns Retained

**Objective:** Verify that exactly the last N turns — and no more — are sent.

**Preconditions:** Same as TC-SW-01 (`contextWindowTurns = 3`).

**Test Steps:**
1. Exchange 5 turns (turns 1-5 have unique keywords).
2. Ask about something from turn 3 (inside window) and turn 1 (outside window).

**Expected Result:**
- Recall of turn 3 content: **present**.
- Recall of turn 1 content: **absent** (agent cannot remember).

**Pass/Fail Criteria:**
- PASS: Asymmetric recall — recent available, older missing.
- FAIL: Agent recalls content from turn 1 when window = 3.

---

### TC-SW-03: Blank / Null Value = Full History

**Objective:** When `contextWindowTurns` is blank/null the full conversation history is sent.

**Preconditions:**
- Agent with `contextWindowTurns = null` (field left empty).

**Test Steps:**
1. Exchange 10 turns with unique keywords.
2. Ask about content from turn 1.

**Expected Result:**
- Agent recalls turn 1 content correctly.
- `sentHistoryLen == fullHistoryLen` in pipeline log.

**Pass/Fail Criteria:**
- PASS: Recall succeeds for all earlier turns.
- FAIL: Agent fails to recall even though window is unset.

---

### TC-SW-04: Tool Outputs Survive Window Truncation

**Objective:** Tool call results from older turns are not needed inside the window but the agent does not crash.

**Preconditions:**
- Agent with a tool (e.g. `end_call`, webhook tool, or native booking).
- `contextWindowTurns = 2`.

**Test Steps:**
1. Trigger a tool call on turn 2.
2. Continue conversation for 4 more turns (tool result turn is now outside the window).
3. Check agent continues normally.

**Expected Result:**
- No server 500 errors.
- Agent continues responding for turns after the window slides past the tool output.
- Call does not drop unexpectedly.

**Pass/Fail Criteria:**
- PASS: Call continues without error.
- FAIL: 500 error, crash, or call disconnects unexpectedly.

---

### TC-SW-05: Long Conversation Stability

**Objective:** Verify 50+ turn conversations do not cause performance degradation or errors.

**Preconditions:** `contextWindowTurns = 5`.

**Test Steps:**
1. Run a scripted call with 50 automated turns.
2. Monitor response latency per turn.
3. Confirm no memory leak or error in server logs after turn 20+.

**Test Data:** Alternating caller/agent messages with incremental numbers.

**Expected Result:**
- All 50 turns complete successfully.
- LLM latency does not grow proportionally with history length (window keeps it constant).
- No OOM or unhandled rejection in logs.

**Pass/Fail Criteria:**
- PASS: All turns complete; p95 LLM latency stays within 2× of baseline.
- FAIL: Latency grows linearly, OOM, or any unhandled error.

---

### TC-SW-06: Token Reduction Behaviour

**Objective:** Verify `baselineInputTokensEstimate` is larger than actual `llmInputTokensTotal` when window is active.

**Preconditions:** `contextWindowTurns = 3`; LLM provider reports usage (e.g. OpenAI).

**Test Steps:**
1. Exchange 10 turns.
2. At call end check `calls` table for token metrics or review end-of-call log.

**Expected Result:**
- `baselineInputTokensEstimate > llmInputTokensTotal` for calls with windowing active.
- Admin analytics or call detail view shows a token saving percentage > 0.

**Pass/Fail Criteria:**
- PASS: Savings > 0%.
- FAIL: Both metrics are equal (window has no effect).

---

## Part 2 — Auto Summarization

### TC-AS-01: Summary Triggered at Threshold

**Objective:** Summary fires exactly when `history.length >= tokenSummarizationThresholdTurns`.

**Preconditions:**
- `tokenSummarizationEnabled = true`.
- `tokenSummarizationThresholdTurns = 6` (low value for test speed).
- `contextWindowTurns = null` or a value ≥ 4 to ensure keepTurns leaves room.

**Test Steps:**
1. Exchange exactly 5 turns — no summary should fire yet.
2. Exchange turn 6 — summarisation trigger crosses threshold.
3. Check server log for: `"Token summarization: old turns compressed"`.

**Expected Result:**
- No summary log after turn 5.
- `"Token summarization: old turns compressed"` log appears after turn 6 is processed.
- Log includes `{ summarizedTurns: N, historyNow: M }`.

**Pass/Fail Criteria:**
- PASS: Log appears on turn 6 (or first turn ≥ threshold), not before.
- FAIL: Log never appears, or appears too early/late.

---

### TC-AS-02: Old Messages Replaced by Summary Entry

**Objective:** After summarisation, `conversationHistory[0]` is a `[CONVERSATION SUMMARY]` entry.

**Preconditions:** Same as TC-AS-01.

**Test Steps:**
1. Trigger threshold (6 turns).
2. Wait ~2 s for async summarisation to complete.
3. Add one more turn and ask the agent: "Summarise what we talked about".

**Expected Result:**
- Agent references a compact summary, not a verbatim replay of all 6 turns.
- In pipeline debug mode, `conversationHistory[0].content` starts with `[CONVERSATION SUMMARY]`.

**Pass/Fail Criteria:**
- PASS: Agent response reflects a condensed summary; history[0] is the summary entry.
- FAIL: Agent enumerates all original turns verbatim (summary didn't replace them).

---

### TC-AS-03: Conversation Meaning Preserved

**Objective:** Critical facts from early turns survive summarisation.

**Preconditions:**
- `tokenSummarizationThresholdTurns = 6`, `contextWindowTurns = 4`.
- Turn 1 contains a critical datum: caller's name and booking preference.

**Test Steps:**
1. Turn 1: "Hi, my name is Alex and I prefer morning appointments."
2. Exchange 5 more turns on unrelated topics.
3. After summarisation fires, ask: "What's my name and when do I prefer appointments?"

**Test Data:**
```
Turn 1 caller: "Hi, my name is Alex and I prefer morning appointments."
Turns 2–5: general back-and-forth (e.g. time zones, service questions).
Turn 7 caller: "Just to confirm, what is my name and when do I prefer?"
```

**Expected Result:**
- Agent correctly answers "Alex" and "morning appointments".
- This information came from the `[CONVERSATION SUMMARY]` block.

**Pass/Fail Criteria:**
- PASS: Both facts recalled correctly.
- FAIL: Agent says it doesn't know the name (summary lost the fact).

---

### TC-AS-04: Agent Answers Questions From Summarised History

**Objective:** Agent can handle follow-up questions about pre-summary content.

**Preconditions:** Same as TC-AS-03.

**Test Steps:**
1. Cover 3 different topics in turns 1–6 (e.g. pricing, availability, features).
2. Trigger threshold — wait for async summary.
3. Ask a specific question about each topic in turns 7–9.

**Expected Result:**
- Agent answers at least 2 of 3 questions correctly using summary context.
- Agent may say it's not sure about granular details (acceptable) but must not completely contradict facts.

**Pass/Fail Criteria:**
- PASS: ≥ 2/3 factual recalls correct.
- FAIL: Agent contradicts established facts or cannot answer any of them.

---

### TC-AS-05: Token Reduction After Summarisation

**Objective:** LLM input tokens decrease after summarisation compresses old turns.

**Preconditions:** Same as TC-AS-01; LLM provider reports usage.

**Test Steps:**
1. Run two identical 10-turn conversations — one with summarisation enabled, one disabled.
2. Compare total `llmInputTokensTotal` at call end.

**Expected Result:**
- Call with summarisation: fewer total input tokens.
- `baselineInputTokensEstimate > llmInputTokensTotal` in pipeline for the summarised call.

**Pass/Fail Criteria:**
- PASS: Token count lower with summarisation by > 10%.
- FAIL: Same or higher token count.

---

### TC-AS-06: Summary Updates After Multiple Thresholds

**Objective:** A second summarisation cycle fires when history fills up again.

**Preconditions:**
- `tokenSummarizationThresholdTurns = 6`, `contextWindowTurns = 3`.
- After first summary, `historyNow` = 4 (1 summary + 3 kept turns).

**Test Steps:**
1. Exchange 6 turns (first threshold).
2. Wait for first summary.
3. Exchange 3 more turns to hit `historyNow >= 6` again.
4. Check for second `"Token summarization: old turns compressed"` log line.

**Expected Result:**
- Two separate summary log entries with different `callId + timestamp`.
- History stays bounded; it does not grow indefinitely.

**Pass/Fail Criteria:**
- PASS: Second summary fires; `historyNow` stays ≤ threshold after each cycle.
- FAIL: Only one summary ever fires regardless of conversation length.

---

### TC-AS-07: Summarisation Failure Graceful Fallback

**Objective:** If the LLM summarisation call fails, the call continues without crashing.

**Preconditions:** Break the summarisation LLM temporarily (e.g. set an invalid API key just for the duration of the test, or test with network disruption).

**Test Steps:**
1. Exchange 6 turns to trigger threshold.
2. Allow summarisation call to fail.
3. Continue exchanging turns.

**Expected Result:**
- Log line: `"Token summarization failed — continuing without compression"` (warn level).
- Call does not drop; next turns complete normally.
- History is NOT partially spliced (no corruption).

**Pass/Fail Criteria:**
- PASS: Warn log + call continues without data corruption.
- FAIL: Server error, call drops, or history is corrupted.

---

## Part 3 — Staged System Prompt

### TC-SP-01: Stage-Specific Prompt Injected on First Turn

**Objective:** Verify stage[0] prompt is active from turn 1.

**Preconditions:**
- `stagedPromptEnabled = true`.
- `stagedPromptStages = [{ name: "intro", content: "You are in the introduction stage. Ask for the caller's name." }]`.
- `stagedPromptCoreIdentity = "You are a polite assistant."`.

**Test Steps:**
1. Start a call.
2. Let agent speak first (or prompt with "Hello").
3. Observe agent's opening question.

**Expected Result:**
- Agent asks for the caller's name (stage 0 instruction).
- Combined system prompt sent to LLM = `"You are a polite assistant.\n\nYou are in the introduction stage. Ask for the caller's name."`.
- Backend DEBUG log: `"Staged prompt active" { stage: "intro", idx: 0 }`.

**Pass/Fail Criteria:**
- PASS: Agent asks for name; debug log shows stage "intro" idx 0.
- FAIL: Agent ignores stage or uses the original system prompt.

---

### TC-SP-02: Stage Transition via `[STAGE:X]` Tag

**Objective:** Agent correctly transitions to the next stage when it emits `[STAGE:X]`.

**Preconditions:**
- Two stages: `intro` (collect name) → `qualify` (ask about need).
- Stage 0 prompt instructs the agent: "Once you have the caller's name, output `[STAGE:qualify]` silently at the end of your message."

**Test Steps:**
1. Start call; agent is in `intro` stage.
2. Caller provides their name.
3. Observe agent's next response — it should emit `[STAGE:qualify]` in the raw LLM output (not in TTS).
4. Confirm the next turn uses the `qualify` stage prompt.

**Expected Result:**
- Server INFO log: `"Staged prompt: transitioned to new stage" { stageName: "qualify", stageIdx: 1 }`.
- From the next turn onwards, `currentStageIndex = 1`.
- Agent starts asking qualification questions.

**Pass/Fail Criteria:**
- PASS: Transition log + agent behaviour changes to qualify stage.
- FAIL: No transition log; agent stays in intro stage indefinitely.

---

### TC-SP-03: Agent Behaviour Changes Per Stage

**Objective:** Each stage demonstrably changes agent behaviour/persona.

**Preconditions:**
- Three stages: `intro` (greeting), `sales` (pitch product), `close` (book appointment).
- Each stage has a clearly distinct instruction.

**Test Steps:**
1. Drive the agent through all three stages via scripted responses.
2. After each transition, ask an open question and record the agent's style.

**Expected Result:**
- Stage `intro`: neutral greeting, name collection.
- Stage `sales`: mentions product features.
- Stage `close`: asks to confirm a booking time.
- No cross-contamination of stage instructions.

**Pass/Fail Criteria:**
- PASS: All 3 stages exhibit distinct, correct behaviour.
- FAIL: One or more stages exhibit behaviour from another stage.

---

### TC-SP-04: Invalid Stage Name Handled Gracefully

**Objective:** A `[STAGE:nonexistent]` tag in LLM output is silently ignored.

**Preconditions:**
- Agent with two stages: `intro`, `qualify`.
- Manually inject (via a crafted user turn) or configure the LLM to emit `[STAGE:bogus]`.

**Test Steps:**
1. Force LLM to output `[STAGE:bogus]` (e.g. have the user say "Please transition to stage bogus now").
2. Observe server behaviour.
3. Continue conversation.

**Expected Result:**
- No server error; `currentStageIndex` remains unchanged.
- Pipeline silently ignores the unknown stage (the `findIndex` returns -1, branch is skipped).
- No log error — only DEBUG or no log at all.
- Next turn continues with the previous active stage.

**Pass/Fail Criteria:**
- PASS: Stage unchanged; call continues normally.
- FAIL: Server error, call drops, or stage jumps to an incorrect index.

---

### TC-SP-05: Tool Calling Continues Across Stage Transitions

**Objective:** Tool calls work correctly in all stages and are not broken by prompt swaps.

**Preconditions:**
- Agent with end_call or webhook tool configured.
- Two stages: `intro` → `close`.
- `close` stage prompt instructs to call `end_call` after confirmation.

**Test Steps:**
1. Drive agent to `close` stage.
2. Confirm appointment; agent should call `end_call` tool.
3. Verify tool executes and call ends.

**Expected Result:**
- Tool still executes despite system prompt being swapped to stage content.
- `end_call` executes; call ends normally.
- Tool call results appear in transcript.

**Pass/Fail Criteria:**
- PASS: Tool executes; call ends after confirmation.
- FAIL: Tool never fires in `close` stage (prompt swap broke tool awareness).

---

### TC-SP-06: Stage Switch Does Not Lose Conversation Context

**Objective:** Conversation history is preserved across stage transitions.

**Preconditions:** Same two-stage agent as TC-SP-02.

**Test Steps:**
1. In stage `intro`, caller provides: name = "Maria", city = "Mumbai".
2. Agent transitions to stage `qualify`.
3. In `qualify`, ask: "Where are you calling from?"

**Expected Result:**
- Agent recalls "Mumbai" from earlier context (it is still in `conversationHistory`).
- Stage transition only changes `systemPromptForTurn`; history is untouched.

**Pass/Fail Criteria:**
- PASS: Agent recalls "Mumbai" without asking again.
- FAIL: Agent asks for city again (history was wiped on transition).

---

### TC-SP-07: Core Identity Persists Across All Stages

**Objective:** `stagedPromptCoreIdentity` text appears in every stage's system prompt.

**Preconditions:**
- `stagedPromptCoreIdentity = "You must always be polite and never discuss competitors."`.
- Two stages with completely different content.

**Test Steps:**
1. In stage 0, try to ask about a competitor — agent should refuse.
2. Transition to stage 1.
3. In stage 1, ask about the competitor again.

**Expected Result:**
- Agent refuses competitor discussion in both stages (core identity enforced).
- DEBUG log for each turn shows core identity prepended.

**Pass/Fail Criteria:**
- PASS: Refusal in both stages.
- FAIL: Agent discusses competitor in either stage (core identity dropped).

---

## Part 4 — Combined Feature Testing

### TC-COMB-01: Sliding Window + Auto Summarisation

**Objective:** Both layers interact correctly — summary compresses old turns, window trims what gets sent.

**Preconditions:**
- `contextWindowTurns = 4`, `tokenSummarizationEnabled = true`, `tokenSummarizationThresholdTurns = 6`.

**Test Steps:**
1. Exchange 6 turns to trigger summarisation.
2. Wait ~2 s for async summary.
3. Exchange 3 more turns.
4. Ask about a fact from turn 1 (now in summary) and from turn 9 (inside window).

**Expected Result:**
- History after summary ≈ `[SUMMARY, t5, t6, t7, t8, t9]`.
- Window (4) trims to `[t7, t8, t9, current]` — summary entry MAY be outside the window.
- `keepTurns = contextWindowTurns = 4` (pipeline uses `contextWindowTurns` to determine how many turns to keep before summarising).
- Agent recalls turn 9 content (inside window); may not recall turn 1 detail (outside window AND summary may not capture granular detail).
- No server errors.

**Pass/Fail Criteria:**
- PASS: No crashes; both layers independently reduce tokens; window applies to post-summary history.
- FAIL: Server error, or one layer disables the other.

---

### TC-COMB-02: Sliding Window + Staged Prompts

**Objective:** Stage transitions occur correctly while window trims history.

**Preconditions:**
- `contextWindowTurns = 3`, `stagedPromptEnabled = true`, two stages.

**Test Steps:**
1. Exchange 6 turns across stage transition at turn 4.
2. Ask about stage-1 content from turn 3 (inside window) and stage-0 content from turn 1 (outside).

**Expected Result:**
- Stage transitions correctly at turn 4.
- Sliding window trims to last 3 turns at each LLM call, regardless of which stage is active.
- Stage system prompt is correctly injected in all turns.

**Pass/Fail Criteria:**
- PASS: Transitions + window both work; no cross-contamination.
- FAIL: Stage transition is ignored when window is active.

---

### TC-COMB-03: Auto Summarisation + Staged Prompts

**Objective:** Summarisation fires correctly while stage system prompts are injected.

**Preconditions:**
- `tokenSummarizationEnabled = true`, `tokenSummarizationThresholdTurns = 6`, `stagedPromptEnabled = true`, two stages.

**Test Steps:**
1. Exchange 6 turns, transitioning stages at turn 4.
2. Wait for summarisation.
3. Continue conversation and confirm stage prompt is still applied.

**Expected Result:**
- Summary fires (log: `"Token summarization: old turns compressed"`).
- After summary, staged prompt still injects the correct stage's content.
- `currentStageIndex` is unaffected by history splice (it's a separate instance variable).

**Pass/Fail Criteria:**
- PASS: Both features work post-threshold.
- FAIL: Summarisation resets stage index, or staged prompt stops injecting after summary.

---

### TC-COMB-04: All Three Features Enabled Together

**Objective:** The full combination of all three optimisation layers operates without conflict.

**Preconditions:**
- `contextWindowTurns = 4`
- `tokenSummarizationEnabled = true`, `tokenSummarizationThresholdTurns = 8`
- `stagedPromptEnabled = true`, three stages

**Test Steps:**
1. Exchange 8 turns, driving through two stage transitions.
2. Let summarisation fire.
3. Exchange 5 more turns in stage 3.
4. Ask the agent to recall a fact from turn 1, turn 5, and turn 10.
5. Try to trigger a tool call in the current stage.

**Expected Result:**
- No server errors throughout.
- Turn 1 fact: possibly recalled via summary.
- Turn 10 fact: recalled via sliding window.
- Stage 3 prompt active from turn 8 onwards.
- Tool call fires successfully.
- Both `"Token summarization: old turns compressed"` and `"Staged prompt: transitioned to new stage"` appear in logs.

**Pass/Fail Criteria:**
- PASS: All 5 sub-checks above pass.
- FAIL: Any crash, stage contamination, or tool failure.

---

### TC-COMB-05: Global Kill Switch Disables All Layers

**Objective:** Setting `token_optimization_enabled = "false"` in `platform_settings` disables all three features.

**Preconditions:**
- All three features configured on agent.
- Via Admin panel or direct DB: set `platform_settings.token_optimization_enabled = "false"`.
- Wait 31 s for the 30-second cache to expire.

**Test Steps:**
1. Exchange 10 turns.
2. Check that window is NOT applied (agent can recall turn 1).
3. Check that no summary log appears.
4. Check that staged prompt is NOT applied (original system prompt used).

**Expected Result:**
- Agent recalls content from all turns (no window).
- No `"Token summarization"` log.
- Agent uses original `systemPrompt`, not staged content.

**Pass/Fail Criteria:**
- PASS: All three layers inoperative.
- FAIL: Any layer still active despite kill switch.

---

## Part 5 — Manual Testing Checklist

### UI Configuration Checks

- [ ] `contextWindowTurns` field accepts positive integers 1–1000 (Zod: `min(1).max(1000)`).
- [ ] `contextWindowTurns` field accepts blank / null → saved as `null` in DB.
- [ ] `contextWindowTurns` rejects 0 and negative numbers (Zod validation error shown).
- [ ] `tokenSummarizationEnabled` toggle saves correctly (persists on reload).
- [ ] `tokenSummarizationThresholdTurns` is only shown when `tokenSummarizationEnabled = true`.
- [ ] `tokenSummarizationThresholdTurns` accepts blank → defaults to 20 in pipeline.
- [ ] `stagedPromptEnabled` toggle shows/hides the stages editor.
- [ ] Stages can be added, reordered, and deleted in the UI.
- [ ] `stagedPromptCoreIdentity` textarea saves and loads correctly.
- [ ] Each stage `name` and `content` field is required; saving with blank name/content shows validation error.
- [ ] Agent save + reload preserves all Optimize settings correctly.

### Call Behaviour Checks

- [ ] Live call with window `N=3` — earlier turns forgotten.
- [ ] Live call with summarisation — `[CONVERSATION SUMMARY]` visible in call transcript (check dashboard call detail).
- [ ] Live call with staged prompts — agent behaviour visibly different per stage.
- [ ] All checks repeated via webcall (browser-based call).

---

## Part 6 — API Testing Checklist

### Agent CRUD

```
POST   /api/agents          — create with contextWindowTurns, stagedPromptEnabled, etc.
GET    /api/agents/:id       — verify all optimize fields returned
PATCH  /api/agents/:id       — update contextWindowTurns; confirm DB row updated
```

- [ ] `contextWindowTurns: 0` → 422 Zod validation error.
- [ ] `contextWindowTurns: 1001` → 422 Zod validation error.
- [ ] `contextWindowTurns: null` → 200, saved as null.
- [ ] `stagedPromptStages: [{ name: "", content: "x" }]` → validate name is non-empty (check Zod schema).
- [ ] `stagedPromptEnabled: true` with `stagedPromptStages: []` → saved; pipeline skips layer gracefully.
- [ ] `tokenSummarizationThresholdTurns: 1` → check if pipeline accepts small thresholds without loop (threshold 1 means every turn triggers — verify `replaceCount >= 2` guard at `pipeline.ts:1790`).

### Platform Settings (Admin API)

```
GET  /api/admin/platform-settings
POST /api/admin/platform-settings  — set token_optimization_enabled = "false"
```

- [ ] Set kill switch to `"false"` → wait 31 s → verify all layers disabled in next call.
- [ ] Set kill switch back to `"true"` → verify layers re-enable within one 30 s cache cycle.

---

## Part 7 — Performance Test Scenarios

| Scenario | Config | Metric to Measure | Target |
|---|---|---|---|
| Long call, no opt | `contextWindowTurns = null`, all off | LLM input tokens per turn | Baseline |
| Window only | `contextWindowTurns = 5` | LLM input tokens per turn | ≤ 40% of baseline |
| Summarisation only | threshold = 10 | LLM input tokens at turn 15 | ≤ 60% of baseline |
| All three on | window=5, threshold=10, 3 stages | LLM input tokens at turn 20 | ≤ 35% of baseline |
| 50-turn call + window | `contextWindowTurns = 5` | LLM latency p95 | Within 1.5× single-turn latency |
| 50-turn call + summ | threshold = 10 | Total call LLM cost | ≤ 60% of no-opt call |

---

## Part 8 — Failure Scenarios

| Scenario | Expected Behaviour | Log to Check |
|---|---|---|
| LLM provider unreachable during summarisation | Warn log; call continues; history not modified | `"Token summarization failed"` (WARN) |
| `[STAGE:X]` tag emitted by LLM mid-sentence | Tag stripped from TTS output; transition applied silently | No TTS artefact; INFO transition log |
| `contextWindowTurns > total history length` | Window slice has no effect (returns full history); no error | No error log |
| `tokenSummarizationThresholdTurns = 1` | `replaceCount >= 2` guard (pipeline:1790) prevents summarising fewer than 2 turns | No summary until at least 2 turns exist |
| Stage array is empty, `stagedPromptEnabled = true` | Layer 4 branch skipped silently (`stages.length > 0` check) | No error; original system prompt used |
| Kill switch row missing from `platform_settings` | Defaults to enabled (`row?.value !== "false"` → true) | No warning; features work normally |
| Async summarisation still running when next turn arrives | Pipeline ignores in-flight summary (non-blocking); next turn uses un-summarised history | No race condition errors |

---

## Part 9 — Debugging Steps

### Sliding Window Not Working
1. Confirm `token_optimization_enabled` in `platform_settings` is not `"false"`.
2. Check `contextWindowTurns` in the agents DB row is an integer > 0.
3. Add a DEBUG log breakpoint or temporary log at `pipeline.ts:1597` to confirm `slice(-N)` is called.
4. Verify `sentHistoryLen < fullHistoryLen` in the `onUsage` savings path (pipeline:1676).

### Summarisation Not Firing
1. Confirm `tokenSummarizationEnabled = true` in DB.
2. Confirm `history.length >= tokenSummarizationThresholdTurns` — check threshold value.
3. Confirm `replaceCount >= 2` (`histLen - keepTurns >= 2`).
4. Check for silent LLM errors in the summarisation call at `pipeline.ts:1924`.
5. Note: summarisation is **async** — wait 2–5 s after the threshold turn before checking.

### Staged Prompt Not Transitioning
1. Check that the LLM is actually emitting `[STAGE:StageName]` in its raw response (not stripped before detection). Check pipeline:1770 regex against actual `llmResponse`.
2. Confirm `stageName.toLowerCase()` matches a stage `name` in the array exactly.
3. Check `stagedPromptEnabled = true` AND `stagedPromptStages.length > 0` in DB.
4. Confirm `token_optimization_enabled != "false"`.

### All Features Disabled Unexpectedly
1. Check `platform_settings` table: `SELECT * FROM platform_settings WHERE key = 'token_optimization_enabled';`
2. If present with value `"false"`, update to `"true"` or delete the row.
3. Wait 31 s for the 30-second in-memory cache (`_tokenOptCacheExpiry`) to expire.

---

## Part 10 — Logs to Verify

| Log Message | Level | Location | Meaning |
|---|---|---|---|
| `"Staged prompt active" { stage, idx }` | DEBUG | pipeline.ts:1607 | Layer 4 injecting stage prompt this turn |
| `"Staged prompt: transitioned to new stage" { stageName, stageIdx }` | INFO | pipeline.ts:1778 | Stage switch detected via `[STAGE:X]` tag |
| `"Token summarization: old turns compressed" { summarizedTurns, historyNow }` | INFO | pipeline.ts:1920 | Summarisation succeeded; history spliced |
| `"Token summarization failed — continuing without compression"` | WARN | pipeline.ts:1925 | LLM call for summary failed; call continues |
| `"LLM complete" { response, sentences }` | INFO | pipeline.ts:1756 | Per-turn LLM completion (check after each turn) |
| `"Turn metrics" { sttLatencyMs, llmLatencyMs, ttsFirstChunkMs }` | INFO | pipeline.ts:1816 | Latency per turn for performance checks |

**To tail logs in real time:**
```bash
# From the Replit shell (api-server workflow logs):
# Check the workflow console in the Replit sidebar
```

**To query history length from DB during a call:**
```sql
-- After a call ends
SELECT id, status, metadata FROM calls WHERE id = <call_id>;
```

---

## Part 11 — Metrics to Monitor

| Metric | Where | Healthy Sign |
|---|---|---|
| `llmInputTokensTotal` | DB `calls` table or call-end log | Decreasing vs. baseline when optimisation on |
| `baselineInputTokensEstimate` | Pipeline in-memory; logged indirectly via savings | > `llmInputTokensTotal` when window active |
| `summarizedTurns` (from log) | Server log | Positive integer; increases over long calls |
| `historyNow` (from log) | Server log | Stays bounded (≤ threshold) after each summary |
| LLM latency (`llmLatencyMs`) | `"Turn metrics"` INFO log | Not growing with conversation length when window is active |
| Stage transitions count | `"Staged prompt: transitioned"` INFO log | 1 per expected transition point |

---

## Part 12 — Easiest Validation Path Per Feature

### Sliding Window — Fastest UI Validation
1. Create an agent with `contextWindowTurns = 2`.
2. Use the **Dashboard → Webcall** feature (browser call, no phone needed).
3. Exchange 4 turns, mentioning your name in turn 1.
4. On turn 5, ask "What did I say in my very first message?"
5. **Pass**: Agent does not know (turn 1 is outside the 2-turn window).

### Sliding Window — Backend Log Validation
- After call, search server logs for the call ID.
- Find `"Turn metrics"` — if `llmInputTokens` stays constant at ~N turns' worth from turn 4 onwards, window is working.

---

### Auto Summarisation — Fastest UI Validation
1. Set `tokenSummarizationThresholdTurns = 4` (very low).
2. Exchange 4 turns.
3. Open the call detail in **Dashboard → Calls Log** after the call ends.
4. **Pass**: The transcript shows `[CONVERSATION SUMMARY] ...` as the first assistant entry.

### Auto Summarisation — Backend Log Validation
- Search logs for `"Token summarization: old turns compressed"`.
- Confirm `summarizedTurns` > 0 and `historyNow` < threshold.

---

### Staged Prompt — Fastest UI Validation
1. Create two stages: `intro` (ask for name) and `info` (ask for preferred contact time).
2. Add to stage 0 prompt: "Once you have the name, end your response with `[STAGE:info]`."
3. Provide your name in the call.
4. **Pass**: Agent's next question shifts to asking about preferred contact time (stage 1 active).

### Staged Prompt — Backend Log Validation
- Search logs for `"Staged prompt: transitioned to new stage"`.
- Confirm `stageIdx` increments from 0 to 1.
