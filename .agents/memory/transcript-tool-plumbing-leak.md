---
name: Transcript tool-plumbing leak
description: Human-readable call transcripts showed raw internal tool-result/instruction strings (e.g. "Callback recorded for..., Now speak naturally...") as if the agent had said them out loud.
---

`getTranscript()` / `summarizeOldTurns()` in `orchestration/pipeline.ts` built the readable transcript with `role === "user" ? "Caller" : "Agent"` — anything not literally the caller's role was labeled "Agent:", including internal plumbing that was never spoken:

- `role: "tool"` entries — the structured tool-result string fed back to the LLM so it can phrase a natural reply (native tool_call path).
- `role: "user"` entries prefixed `"[Tool result for ...]"` — same thing on the inline-function-tag path, which piggybacks on the user role.
- Empty-content `role: "assistant"` placeholder turns — recorded when the LLM's entire reply was a tool call with no accompanying text.

**Why:** the caller-facing/log transcript must only contain text that was genuinely spoken. Any future code that maps `conversationHistory` into a readable transcript needs the same three exclusions, or every tool (schedule_callback, bookings, transfers, etc.) leaks its internal instruction string as a fake "Agent:" line.

**How to apply:** when adding a new transcript-rendering or summarization code path over `ConversationTurn[]`, filter with `t.role !== "tool" && !(t.role === "user" && t.content.startsWith("[Tool result for")) && t.content.trim() !== ""` before mapping to Caller/Agent lines.
