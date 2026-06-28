import type { Chapter } from "../types";

export const readingCallLogs: Chapter = {
  slug: "reading-call-logs",
  moduleId: "m15",
  number: "16.1",
  title: "Reading Call Execution Logs",
  summary:
    "How to use the call execution log system to debug a live or historical call — the event types, the timeline view, and the most useful log patterns for diagnosing common failures.",
  estMinutes: 12,
  fileRef: "artifacts/api-server/src/orchestration/executionLogger.ts",
  prerequisites: ["session-and-pipeline", "tool-execution"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "The two-tier logging system",
      paragraphs: [
        "SnapServe has two parallel logging systems. The first is the **structured application log** — pino-based JSON output to stdout, visible in Railway's log viewer. These logs are for operators: they include request IDs, error stacks, and system events.",
        "The second is the **call execution log** — structured events written to the `call_execution_logs` Postgres table during a live call. These logs are for users: they show the story of a call from the agent's perspective. They appear in the dashboard Call Detail page as a scrollable timeline.",
        "Every call execution log entry has: `callId`, `agentId`, `eventType`, `message`, `data` (JSON blob with event-specific fields), and `createdAt`. The `eventType` field is how you find the relevant entries quickly.",
      ],
    },
    {
      kind: "concept",
      title: "Key event types and what they tell you",
      body: [
        "**`call_started`** — the WebSocket opened. `data.fromNumber`, `data.toNumber`, `data.direction`. If this event is missing, the session was never established — check the telephony provider's answer webhook.",
        "**`stt_partial` / `stt_final`** — STT output. `data.transcript`, `data.confidence`, `data.languageCode`. If you see a long gap between `stt_partial` entries and no `stt_final`, the endpointing timer fired a force-finalize (controlled by `FORCE_FINALIZE_MS`). If there are no STT events at all after `call_started`, the audio stream isn't reaching the STT provider.",
        "**`llm_start` / `llm_first_token` / `llm_done`** — LLM turn timing. The gap between `llm_start` and `llm_first_token` is the LLM latency. If `llm_done` never appears after `llm_first_token`, the LLM stream stalled mid-response.",
        "**`tts_start` / `tts_chunk` / `tts_done`** — TTS synthesis. `data.text` shows what was synthesised. If `tts_done` appears but the caller heard nothing, the audio was played but the telephony WebSocket wasn't connected.",
        "**`tool_call`** — the LLM requested a tool execution. `data.toolName`, `data.args`, `data.result`. Compare `data.args` to `data.result` to debug tool failures.",
        "**`call_ended`** — `data.reason` (`'natural'`, `'max_duration'`, `'error'`), `data.durationSeconds`, `data.billingMode`. If this event is missing and the call is stuck `in_progress`, `endSession()` hung before completion (see next chapter).",
      ],
    },
    {
      kind: "code",
      filename: "orchestration/executionLogger.ts",
      language: "typescript",
      intro: "The `createExecutionLogger` factory — creates a scoped logger that writes to the `call_execution_logs` table.",
      code: `export function createExecutionLogger(
  callId:  number,
  agentId: number | null,
) {
  return async function logEvent(
    eventType: string,
    message:   string,
    data?:     Record<string, unknown>,
  ): Promise<void> {
    try {
      await db.insert(callExecutionLogsTable).values({
        callId,
        agentId,
        eventType,
        message,
        data: data ? JSON.stringify(data) : null,
      });
    } catch (err) {
      // Execution logs are best-effort — never let a log write failure
      // propagate to the call pipeline.
      logger.error({ callId, eventType, err }, "executionLogger: write failed");
    }
  };
}`,
      lines: [
        {
          lines: "5-8",
          label: "scoped logger function",
          explanation:
            "`createExecutionLogger` returns a function, not an object. Call sites use `const log = createExecutionLogger(callId, agentId)` then `log('tool_call', 'schedule_callback invoked', { toolName, args })`. This keeps the API ergonomic for fire-and-forget use.",
        },
        {
          lines: "17-20",
          label: "catch and swallow",
          explanation:
            "Log write failures are caught and logged to the application log (pino) but NOT rethrown. A Postgres hiccup during a call must never crash the call pipeline. Execution logs are best-effort diagnostic data, not transactional state.",
        },
      ],
    },
    {
      kind: "prose",
      heading: "Debugging a stuck 'Listening...' hang",
      paragraphs: [
        "The 'Listening...' hang is the most common issue on Indian telephony: the caller speaks, but the agent never responds. To diagnose it, open the Call Detail page and check the execution log timeline.",
        "**No `stt_partial` entries after the greeting** — audio isn't reaching the STT provider. Check: 1) Is the telephony WebSocket sending audio frames? (Look for 'Vobiz WS received audio' in the application log.) 2) Is the STT WebSocket open? (`stt_connected` event should appear.) 3) Is the audio format correct (8kHz LINEAR16 for VoBiz, not μ-law)?",
        "**`stt_partial` entries but no `stt_final` after 2+ seconds** — endpointing isn't triggering. The safety net (`FORCE_FINALIZE_MS`, default 1800ms) should fire a force-finalize. If it didn't, check if the call is in the `Listening` state (`pipelineState` in the application log).",
        "**`stt_final` present but no `llm_start`** — the transcript was received but LLM turn didn't start. Check: 1) Is the transcript non-empty? 2) Is the barge-in echo gate dropping it? (`isPlaying = true` at transcript time would suppress the turn.)",
      ],
    },
    {
      kind: "callout",
      variant: "tip",
      title: "The application log and execution log are complementary",
      body: [
        "The execution log shows WHAT happened in the call (events, transcripts, tool calls). The application log shows WHY things happened or failed (WebSocket errors, DB errors, provider API errors). When debugging, start with the execution log to identify which step failed, then search the application log for that `callId` or `sessionId` around the same timestamp for the error detail.",
        "In Railway, filter pino logs by `callId` using the log search: `\"callId\":927` will show all application log lines for that call.",
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "A call's execution log shows `call_started`, `tts_done` (greeting played), but no `stt_partial` entries. The caller says they heard the greeting. What's the most likely cause?",
          choices: [
            "The LLM is not responding — check `llm_start` events",
            "The STT WebSocket is not connected or audio isn't reaching the STT provider",
            "The barge-in echo gate is suppressing all transcripts",
            "The force-finalize timer fired but produced an empty transcript",
          ],
          correctIndex: 1,
          explanation:
            "If the greeting played (`tts_done` present) but no `stt_partial` events appear, the audio path from the telephony WebSocket to the STT provider is broken. Either the STT WebSocket isn't open (`stt_connected` event missing), or the audio frames aren't being forwarded from the telephony adapter to the STT adapter.",
        },
        {
          prompt: "The `call_ended` event is missing from a call that shows as 'in_progress' in the database. What does this indicate?",
          choices: [
            "The call is still active — the user hasn't hung up yet",
            "endSession() hung before writing the `call_ended` log entry and updating the status",
            "The telephony provider closed the connection without firing the hangup webhook",
            "The execution logger's DB write failed — the event was lost",
          ],
          correctIndex: 1,
          explanation:
            "`call_ended` is logged by `endSession()` near the end of its cleanup. If it's missing AND the call is stuck `in_progress`, `endSession()` never completed — most likely because `recording.finalize()` hung (DB pool exhaustion on the WAV insert). The 60-second timeout added to `recording.finalize()` prevents this from happening.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Two log systems: application log (pino → Railway) for operators, execution log (Postgres table) for users",
        "Key event sequence: call_started → stt_partial → stt_final → llm_start → llm_first_token → tts_done → (repeat) → call_ended",
        "Missing `stt_partial` = audio not reaching STT. Missing `stt_final` = endpointing not triggering",
        "Missing `call_ended` + stuck `in_progress` = `endSession()` hung (recording finalize timeout)",
        "Application log and execution log are complementary — use both to find 'what failed' + 'why'",
      ],
    },
  ],
};
