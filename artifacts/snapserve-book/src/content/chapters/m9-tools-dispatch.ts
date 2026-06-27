import type { Chapter } from "../types";

export const toolsDispatch: Chapter = {
  slug: "tools-dispatch",
  moduleId: "m9",
  number: "10.1",
  title: "The Tool Dispatch System",
  summary:
    "Inside `tool-executor.ts` — how the pipeline routes tool calls to the right handler and feeds results back to the LLM.",
  estMinutes: 20,
  fileRef: "artifacts/api-server/src/services/tool-executor.ts",
  prerequisites: ["tool-execution", "session-and-pipeline"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "Two files, one concern",
      paragraphs: [
        "Tool calling in SnapServe spans two files. `pipeline.ts` owns the low-level mechanics: detecting `tool_calls` in the LLM stream, playing a filler sentence, dispatching via `handleToolCallInner`, and calling `continueWithToolResult` to resume the conversation. `tool-executor.ts` owns the **business logic**: the actual implementations of call transfer, booking, SMS, webhook, and schedule_callback that the dispatcher invokes.",
        "This separation keeps the pipeline focused on timing and state, while the executor stays focused on side effects. If you're debugging why a booking didn't get created, you look in `tool-executor.ts`. If you're debugging why the agent spoke over the tool result, you look in `pipeline.ts`.",
      ],
    },
    {
      kind: "concept",
      title: "Tools in the agent config: the full taxonomy",
      body: [
        "When a user creates an agent in the dashboard and adds tools, each tool is stored as a JSON object in the `agentConfig.tools` array. Each tool has a `type` (the executor to use) and a `name` (what the LLM calls it). Here's the full set of supported tool types:",
        "**`end_call`** — hangs up the call with an optional goodbye message. Always available as a built-in, even without explicit configuration.",
        "**`call_transfer`** — initiates a warm transfer to a human agent at a configured `transferNumber`. The pipeline plays a transfer announcement, then hands off the WebSocket.",
        "**`webhook`** — HTTP POST to an operator-provided URL with the tool arguments. The response is returned to the LLM.",
        "**`send_sms`** — sends a text message to the caller's number via the telephony provider. The message template can include LLM-interpolated values.",
        "**`native_booking`** / **`calcom_booking`** — scheduling tools that integrate with SnapServe's scheduling engine or cal.com respectively. Both expose check-availability, book, reschedule, and cancel operations.",
        "**`schedule_callback`** — a built-in that schedules a future outbound call to the caller.",
      ],
    },
    {
      kind: "code",
      filename: "services/tool-executor.ts",
      language: "typescript",
      intro:
        "The `executeToolCall` function exported from `tool-executor.ts` and called by the pipeline dispatcher. It's a switch on `tool.type` that delegates to the right executor.",
      code: `export async function executeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  context: ToolCallContext
): Promise<ToolResult> {
  const { agent, callId, callerPhone, config } = context;

  const tool = agent.tools.find(t => t.name === toolName);
  if (!tool) {
    return { success: false, result: "Tool not found" };
  }

  try {
    switch (tool.type) {
      case "call_transfer":
        return await executeCallTransfer(tool, args, context);
      case "webhook":
        return await executeWebhookTool(tool, args, context);
      case "send_sms":
        return await executeSendSms(tool, args, context);
      case "native_booking":
        return await executeNativeBooking(tool, args, context);
      case "calcom_booking":
        return await executeCalcomBooking(tool, args, context);
      default:
        return { success: false, result: "Unknown tool type" };
    }
  } catch (err) {
    logger.warn({ toolName, err }, "Tool execution failed");
    return { success: false, result: "Tool execution failed" };
  }
}`,
      lines: [
        {
          lines: "7-9",
          label: "tool lookup by name",
          explanation:
            "The LLM emits a `name` string (e.g. `\"check_calendar\"`). The lookup finds the matching tool object in `agent.tools` by name. If no match, return a failure result rather than throwing — a missing tool should degrade gracefully, not crash the call.",
        },
        {
          lines: "13-24",
          label: "switch on tool.type",
          explanation:
            "TypeScript's discriminated union on `tool.type` means each case is fully typed — `executeCallTransfer` receives a `tool: AgentTool & { type: 'call_transfer' }`, giving it access to `tool.transferNumber` without casts.",
        },
        {
          lines: "26-29",
          label: "catch all errors",
          explanation:
            "Tool execution should never crash the call. Any error (network timeout, invalid booking slot, SMS API failure) is caught here, logged, and returned as a failure result. The LLM receives the failure string and can tell the caller 'Sorry, I couldn't complete that action.'",
        },
      ],
    },
    {
      kind: "prose",
      heading: "Call Transfer: the warm handoff",
      paragraphs: [
        "A warm transfer is when the AI agent gracefully hands the caller to a human agent, usually after gathering information. The LLM calls the `call_transfer` tool when it determines human intervention is needed — typically because the customer has a complaint, a complex query, or explicitly requests a human.",
        "The transfer plays a configured announcement (`\"Transferring you to our team now.\"`) in the caller's language, then instructs the telephony provider to redirect the call to the `transferNumber`. From the telephony provider's perspective, this is a new leg — a standard SIP transfer or PSTN redirect.",
        "A critical edge case: if the transfer number is busy or doesn't answer, SnapServe falls back to ending the call gracefully rather than leaving the caller in silence. The fallback message is the agent's `goodbyeMessage` with a transfer-failure suffix.",
      ],
    },
    {
      kind: "code",
      filename: "services/tool-executor.ts",
      language: "typescript",
      intro:
        "The call transfer executor. The actual transfer mechanism differs per provider — Twilio uses TwiML `<Dial>`, Plivo uses an XML response, VoBiz uses its REST transfer endpoint.",
      code: `async function executeCallTransfer(
  tool: AgentTool & { type: "call_transfer" },
  _args: Record<string, unknown>,
  ctx: ToolCallContext
): Promise<ToolResult> {
  const { config, agent } = ctx;

  // Play the transfer announcement first
  const announcement = tool.transferMessage
    ?? (agent.language?.startsWith("hi") ? "आपको अभी ट्रांसफर कर रहे हैं।"
      : "Transferring you now. Please hold.");

  await config.speak(announcement);

  // Signal the pipeline to transfer (provider-specific implementation)
  config.onTransfer({
    to: tool.transferNumber,
    mode: tool.transferMode ?? "blind",
  });

  return { success: true, result: "Transfer initiated" };
}`,
      lines: [
        {
          lines: "8-12",
          label: "localised announcement",
          explanation:
            "The transfer message is either configured explicitly on the tool, or defaults to a language-appropriate fallback. The check `agent.language?.startsWith('hi')` catches `hi-IN`, `hi`, etc. A real production system might have a full i18n table here.",
        },
        {
          lines: "15-18",
          label: "config.onTransfer()",
          explanation:
            "`onTransfer` is a callback on `SessionConfig` that the telephony layer implemented when the session was created. It knows the provider (Twilio, VoBiz) and issues the correct transfer command. The executor doesn't need to know which provider is in use.",
        },
      ],
    },
    {
      kind: "concept",
      title: "Non-streaming tool call detection",
      body: [
        "Most LLMs stream `tool_calls` correctly alongside or instead of text content. But some don't — Sarvam's LLM API, for example, doesn't emit `delta.tool_calls` in its streaming SSE events. For these models, the pipeline maintains two concurrent requests: a streaming one (for text) and a non-streaming one (for tool calls).",
        "When the streaming response finishes, if a tool was detected in the non-streaming response, the pipeline discards the streamed text and uses the tool result instead. This adds ~200ms of latency for models that need it, but it's the only way to get reliable tool extraction.",
        "The streaming/non-streaming split is handled transparently inside the LLM adapter — the pipeline always calls `adapter.stream()` and the adapter decides internally whether to do the dual-request trick.",
      ],
    },
    {
      kind: "connections",
      title: "Tool dispatch architecture",
      nodes: [
        { id: "llm",    label: "LLM adapter",        sublabel: "emits tool_calls",  chapterSlug: "llm-adapters" },
        { id: "pipe",   label: "pipeline.ts",         sublabel: "handleToolCallInner", chapterSlug: "tool-execution" },
        { id: "exec",   label: "tool-executor.ts",    sublabel: "executeToolCall",   current: true },
        { id: "xfer",   label: "Call transfer",       sublabel: "onTransfer()" },
        { id: "wh",     label: "Webhook tool",        sublabel: "HTTP POST" },
        { id: "sms",    label: "Send SMS",            sublabel: "telephony provider" },
        { id: "book",   label: "Booking tools",       sublabel: "native / cal.com",  chapterSlug: "scheduling" },
      ],
      edges: [
        { from: "llm",  to: "pipe",  label: "tool_calls" },
        { from: "pipe", to: "exec",  label: "dispatch" },
        { from: "exec", to: "xfer",  label: "call_transfer" },
        { from: "exec", to: "wh",    label: "webhook" },
        { from: "exec", to: "sms",   label: "send_sms" },
        { from: "exec", to: "book",  label: "booking" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "Why is the call transfer implementation delegated to `config.onTransfer()` rather than calling the telephony API directly in `tool-executor.ts`?",
          choices: [
            "Because `tool-executor.ts` doesn't have access to the telephony credentials",
            "The executor doesn't know which provider (Twilio, VoBiz, Plivo) is in use — the callback encapsulates that",
            "To avoid circular imports between services",
            "Because transfers are always asynchronous",
          ],
          correctIndex: 1,
          explanation:
            "`config.onTransfer()` is a callback injected at session creation time by the telephony layer. The executor calls it blindly — the callback knows the provider and does the right thing. This is the adapter pattern applied to session callbacks.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "`tool-executor.ts` owns business logic; `pipeline.ts` owns timing/state — they're separated by the `ToolCallContext` interface",
        "Tool type determines which executor runs: `call_transfer`, `webhook`, `send_sms`, `native_booking`, `calcom_booking`",
        "All tool errors are caught and returned as failure strings — tools must never crash the call",
        "Transfer announcements are localised; the actual transfer is issued via `config.onTransfer()` (provider-agnostic callback)",
        "Non-streaming tool detection: some LLMs (e.g. Sarvam) require a parallel non-streaming request for tool extraction",
      ],
    },
  ],
};
