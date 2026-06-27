import type { Chapter } from "../types";

export const toolExecution: Chapter = {
  slug: "tool-execution",
  moduleId: "m4",
  number: "5.7",
  title: "AI Tool Execution",
  summary:
    "How the LLM triggers real-world side effects mid-call — transfers, webhooks, SMS, bookings, and more.",
  estMinutes: 22,
  fileRef: "artifacts/api-server/src/orchestration/pipeline.ts",
  prerequisites: ["session-and-pipeline", "llm-adapters"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "A conversational AI that can only talk is a toy. SnapServe agents can **act** — transfer the caller to a human, fire a webhook, send an SMS, book a meeting slot, or hang up gracefully — all triggered by the LLM mid-conversation. This capability is called *tool calling* (also known as function calling), and it's where voice AI becomes genuinely useful.",
        "Every tool a SnapServe agent can use is defined in the agent's `tools` array, saved as JSONB in the database. When the LLM decides to use a tool, it emits a special structured response instead of plain text. The pipeline intercepts that, executes the corresponding action, feeds the result back to the model, and the conversation continues — all in under a second.",
      ],
    },
    {
      kind: "concept",
      title: "OpenAI tool calling: the protocol",
      body: [
        "Tool calling is a standard OpenAI API feature, and almost every major LLM now supports it. Instead of replying with text, the model replies with a `tool_calls` array. Each entry has a `name` (which tool to run) and `arguments` (a JSON object of parameters). Your application then runs the tool and replies to the model with a `tool` role message containing the result. The model's next reply is the spoken response, informed by what the tool returned.",
        "**Key insight:** the model never *runs* the tool — it only *requests* it. The application decides whether to honor the request. In SnapServe, the pipeline is the executor, and it enforces safety rules: only tools configured on the agent are dispatchable, and built-ins like `end_call` are always available.",
        "Some models (like Sarvam, some Mistral configs) don't stream `tool_calls` correctly. The pipeline detects this and uses a parallel non-streaming call to get the tool payload, then resumes streaming for the spoken reply.",
      ],
    },
    {
      kind: "analogy",
      title: "The LLM is the manager, the pipeline is the assistant",
      body: [
        "Imagine an executive on a phone call who can lean over and whisper to their assistant: \"Book a meeting for Tuesday\". The assistant (the pipeline) does the actual calendar work, then whispers back: \"Done — 2pm is confirmed\". The executive then speaks that confirmation to the caller. The caller never knew there was a second person in the room.",
        "The LLM is the executive: it decides what needs to happen. The pipeline is the assistant: it executes and reports. The caller only hears the conversation.",
      ],
    },
    {
      kind: "code",
      filename: "orchestration/pipeline.ts",
      language: "typescript",
      intro:
        "Every agent gets these tools injected at LLM call time. The two built-ins — `end_call` and `schedule_callback` — are always available, regardless of what the agent has configured.",
      code: `const SCHEDULE_CALLBACK_TOOL_DEF: ToolDefinition = {
  name: "schedule_callback",
  description: "Schedule a callback for the caller at a specific time",
  parameters: {
    type: "object",
    properties: {
      scheduledAt: { type: "string", description: "ISO 8601 datetime" },
      notes:       { type: "string", description: "Reason for callback" },
    },
    required: ["scheduledAt"],
  },
};

// Built-in tool always added to the list:
toolDefs.push(SCHEDULE_CALLBACK_TOOL_DEF);`,
      lines: [
        {
          lines: "1-11",
          label: "SCHEDULE_CALLBACK_TOOL_DEF",
          explanation:
            "A `ToolDefinition` is what the LLM sees — it's the function signature the model uses to decide when and how to call a tool. The `parameters` block is a JSON Schema object that the model must comply with when generating arguments. The pipeline validates these args before executing.",
        },
        {
          lines: "13",
          label: "toolDefs.push()",
          explanation:
            "Built-ins are injected every call so the LLM always knows it can schedule a callback, even if the agent UI doesn't explicitly expose that tool. Agent-configured tools (call_transfer, webhook, etc.) are pushed in a loop before this.",
        },
      ],
    },
    {
      kind: "code",
      filename: "orchestration/pipeline.ts",
      language: "typescript",
      intro:
        "The `handleToolCallInner` method is the main dispatcher. It checks the tool name against the agent's configured tools and executes the matching action.",
      code: `private async handleToolCallInner(
  toolName: string,
  args: Record<string, unknown>
): Promise<string | undefined> {

  // ── 1. Built-in: end_call ────────────────────────────────────────
  if (toolName === "end_call") {
    const endCallTool = this.agent.tools.find(t => t.type === "end_call");
    await this.executeEndCall(
      endCallTool ?? { type: "end_call", goodbyeMessage: undefined }
    );
    return undefined;
  }

  // ── 2. Built-in: schedule_callback ──────────────────────────────
  if (toolName === "schedule_callback") {
    const scheduledAt = new Date(args["scheduledAt"] as string);
    const notes = args["notes"] as string | undefined;
    await scheduleCallbackRequested({
      agentId: this.config.agentId,
      toNumber: this.config.callerPhone ?? "",
      callId: this.config.callId,
      scheduledAt, notes,
    });
    return "Callback scheduled successfully.";
  }

  // ── 3. Agent-configured tools ────────────────────────────────────
  const tool = this.agent.tools.find(t => t.name === toolName);
  if (!tool) return undefined;

  if (tool.type === "call_transfer")  return this.executeCallTransfer(tool, args);
  if (tool.type === "end_call")       return this.executeEndCall(tool);
  if (tool.type === "webhook")        return this.executeWebhookTool(tool, args);
  if (tool.type === "send_sms")       return this.executeSendSms(tool, args);
  // … booking tool types handled separately …
}`,
      lines: [
        {
          lines: "7-13",
          label: "end_call branch",
          explanation:
            "The `end_call` tool is always available, even if not in the agent's configured tools. When the LLM decides to hang up, the pipeline calls `executeEndCall` which plays the configured goodbye message, then fires `config.onCallEnd()` — the callback that tears down the session.",
        },
        {
          lines: "15-25",
          label: "schedule_callback branch",
          explanation:
            "The LLM can schedule a future callback for the caller. The `scheduledAt` comes from the LLM's parsed arguments (a string it wrote, like `\"2024-01-15T14:00:00+05:30\"`). The pipeline writes a row to `scheduled_callbacks` via `scheduleCallbackRequested`. The callback poller fires it later.",
        },
        {
          lines: "27-37",
          label: "agent-configured tools",
          explanation:
            "All other tools are matched by `name` against `this.agent.tools`. The `name` is what the LLM uses (e.g. `\"book_appointment\"`); the `type` tells the pipeline which executor to run. This separation lets you give a tool any name in the LLM prompt while keeping the execution logic clean.",
        },
      ],
    },
    {
      kind: "prose",
      heading: "The Webhook Tool: calling out to the real world",
      paragraphs: [
        "The most flexible tool is the **webhook** type. When the LLM calls it, SnapServe makes an HTTP POST to the URL configured by the agent operator. The request body includes the agent ID, call ID, tool name, and any arguments the LLM passed. The webhook handler's response body (a string) is sent back to the LLM as the tool result, which the model can then use in its next reply.",
        "This is incredibly powerful: an operator can hook any backend API to the voice agent without touching SnapServe's code. Booking an order, looking up a customer record, fetching a real-time price — all of these can be done via a webhook tool.",
      ],
    },
    {
      kind: "code",
      filename: "orchestration/pipeline.ts",
      language: "typescript",
      intro: "The webhook executor: build the payload, POST to the configured URL, return the response body to the LLM.",
      code: `private async executeWebhookTool(
  tool: AgentTool & { type: "webhook" },
  args: Record<string, unknown>
): Promise<string> {
  const body = JSON.stringify({
    agentId: this.config.agentId,
    callId:  this.config.callId,
    tool:    tool.name,
    args,
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (tool.secret) {
    // HMAC-SHA256 signature so the receiving server can verify the request
    headers["X-VoiceOrch-Signature"] =
      "sha256=" + createHmac("sha256", tool.secret)
        .update(body, "utf8").digest("hex");
  }

  const res = await fetch(tool.url!, { method: "POST", headers, body });
  const text = await res.text();
  return text.slice(0, 2000); // cap at 2 000 chars so LLM context stays bounded
}`,
      lines: [
        {
          lines: "4-10",
          label: "standardised payload",
          explanation:
            "Every webhook call gets `agentId`, `callId`, `tool` name, and `args`. The receiving server always knows which agent made the call and which call it belongs to, so it can look up customer context from its own database.",
        },
        {
          lines: "13-20",
          label: "HMAC signature",
          explanation:
            "If the tool has a `secret` configured, the pipeline signs the body with HMAC-SHA256 and sends the hex digest in `X-VoiceOrch-Signature`. The receiving server should verify this before trusting the payload — identical to how GitHub and Stripe sign their webhooks.",
        },
        {
          lines: "22",
          label: "2 000-char cap",
          explanation:
            "The response is fed back to the LLM as a `tool` role message. LLM context windows are precious — a tool returning a 50 KB HTML page would waste thousands of tokens and slow the next reply. Capping at 2 000 chars forces webhook authors to return concise, useful data.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "Tool filler sentences",
      body: [
        "When the LLM fires a tool, the pipeline can't speak while waiting for the result — that would be silence on the line, which sounds like a hang-up. To paper over the gap, the pipeline picks a filler sentence (e.g. \"Let me check that for you.\") from a language-aware lookup table (`TOOL_FILLERS`) and speaks it while the tool executes. This keeps the call feeling alive.",
        "The filler is synthesised in the background; the tool executes in the foreground. If the tool returns in < 500ms, the filler might overlap — that's fine, TTS drains before the result reply starts.",
      ],
    },
    {
      kind: "prose",
      heading: "Booking tools: native vs. cal.com",
      paragraphs: [
        "SnapServe has two booking integrations: **native** (its own PostgreSQL scheduling engine) and **cal.com** (an external SaaS). Both expose the same conceptual tools to the LLM: `check_availability`, `book_appointment`, `list_bookings`, `reschedule`, `cancel`.",
        "The native tools call the scheduling service directly in-process, using advisory-locked SQL to prevent double-bookings. The cal.com tool makes REST calls to api.cal.com. Either way, the LLM sees the same interface and never knows (or cares) which backend is used.",
        "Booking tools also get special system-prompt injections — a `[SCHEDULING TOOL GUIDE]` block that tells the LLM the calendar's timezone, event type name, and duration, so it can ask the caller for the right information before calling the tool.",
      ],
    },
    {
      kind: "connections",
      title: "Tool call flow end to end",
      nodes: [
        { id: "llm",      label: "LLM adapter",         sublabel: "streams tool_calls",     current: true },
        { id: "pipeline", label: "OrchestrationPipeline", sublabel: "pipeline.ts",          chapterSlug: "session-and-pipeline" },
        { id: "filler",   label: "TTS filler",           sublabel: "\"Let me check…\"" },
        { id: "exec",     label: "Tool executor",        sublabel: "handleToolCallInner" },
        { id: "extern",   label: "External system",      sublabel: "webhook / DB / SMS" },
        { id: "resume",   label: "continueWithToolResult", sublabel: "LLM sees result" },
      ],
      edges: [
        { from: "llm",      to: "pipeline", label: "tool_calls detected" },
        { from: "pipeline", to: "filler",   label: "play while waiting" },
        { from: "pipeline", to: "exec",     label: "dispatch" },
        { from: "exec",     to: "extern",   label: "HTTP / SQL / API" },
        { from: "extern",   to: "exec",     label: "result string" },
        { from: "exec",     to: "resume",   label: "return result" },
        { from: "resume",   to: "llm",      label: "next LLM turn" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "What does the LLM actually receive when a tool call completes?",
          choices: [
            "A function return value injected directly into the system prompt",
            "A new 'tool' role message appended to conversation history",
            "A webhook from SnapServe notifying the model of the result",
            "Nothing — the tool result is only used to update the DB",
          ],
          correctIndex: 1,
          explanation:
            "The OpenAI tool-calling protocol works by appending a `tool` role message to the conversation history. The model's next call includes this message, so it can read the result and generate a spoken reply.",
        },
        {
          prompt: "Why does the webhook executor cap the response body at 2 000 characters?",
          choices: [
            "To stay within HTTP header size limits",
            "Because the database column can't store more",
            "To keep LLM context bounded and responses fast",
            "Because the LLM will error on longer inputs",
          ],
          correctIndex: 2,
          explanation:
            "LLM context windows are shared by the system prompt, conversation history, and all tool results. A large tool response eats tokens that would otherwise carry conversation context, slowing inference and increasing cost.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Tool calling lets the LLM trigger real-world actions — transfers, webhooks, bookings, SMS — without the caller knowing",
        "`handleToolCallInner` is the central dispatcher: it checks built-ins first, then matches agent-configured tools by name",
        "Webhook tools sign their payload with HMAC-SHA256 so the receiving server can verify the request",
        "Filler sentences paper over tool execution latency so the line doesn't go silent",
        "Booking tools (native and cal.com) share the same LLM interface; the system-prompt guide tells the LLM how to collect the right details",
      ],
    },
  ],
};
