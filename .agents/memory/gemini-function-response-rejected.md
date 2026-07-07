---
name: Gemini functionResponse in user role — rejected
description: Gemini API now rejects functionResponse parts placed in role:user messages, crashing every post-tool LLM call silently and then breaking the next caller turn.
---

## Rule
Never send `functionResponse` parts inside a `role: "user"` message to the Gemini API (`@google/generative-ai` SDK). The API now throws synchronously (< 15 ms, no network round-trip):
```
[GoogleGenerativeAI Error]: Content with role 'user' can't contain 'functionResponse' part
```

## Why
This was the documented Gemini format for function call responses (user-role message with a functionResponse part). A recent Gemini API update rejects it. The SDK validates this client-side before even making a network call.

## How to apply
In `artifacts/api-server/src/orchestration/adapters/llm/google.ts → buildHistory`:

- `{role: "tool"}` history entries → `{role: "user", parts: [{text: '[Tool "name" result: <content>]'}]}`
- `{role: "assistant", toolCalls}` history entries → `{role: "model", parts: [{text: spokenText || '[called name]'}]}`
- `lastMessage` for tool turns → plain text string, not `Part[]` with functionResponse

This keeps history in valid user→model alternation. Tool result messages already contain the verbal instruction ("Now speak naturally to the caller…") so model output is unchanged.

## Failure signature (call logs)
The bug is SILENT in call logs because `continueWithToolResult` has no LLM request/response logging. Symptoms:
1. Tool executes successfully (Execution Completed logged)
2. No LLM request log after tool → no TTS → 11+ second silence
3. Silence reprompt fires
4. On the NEXT caller turn: LLM fails with the functionResponse error (NOW visible in call logs)
5. Call ends with `retryAttempted: false, fallbackAttempted: false` (because the SDK throws before any network call)
