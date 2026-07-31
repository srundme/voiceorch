---
name: Outbound call-screening bot handling
description: How outbound calls answered by iPhone/Google call-screening bots are detected and handled
---
Module: orchestration/callScreening.ts + pipeline wiring (outbound only, first 25s from pipeline start).
Rules:
1. Detection is phrase-based on final STT transcripts. NEVER add generic patterns like "what is this call about" / "who is this" — real humans say those in the first seconds (reviewer-flagged false positive).
2. Reply exactly once: state business+reason (explicit `screeningResponse` raw agent_config field → derived from greeting → generic), then stay silent even if the screener speaks again. If greeting audio is still playing at detection, WAIT (bounded 10s) then speak — skipping on isPlaying silently drops the reply.
3. Real-human pickup = first non-screener final after responding → one-shot SCREENING_PICKUP_NOTE in the volatile prompt tail (before datetime) tells the LLM to restart the greeting.
4. Screening exchanges are stored in conversationHistory prefixed "[call screening bot]" and MUST stay filtered out of updateCallerProfile's history input (session.ts) or screener boilerplate pollutes durable caller memory.
**Why:** carrier AMD classifies screeners as human (they speak naturally); pitching into a screener wastes minutes and gets calls rejected.
