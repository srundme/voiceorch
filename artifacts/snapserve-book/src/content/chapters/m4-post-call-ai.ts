import type { Chapter } from "../types";

export const postCallAi: Chapter = {
  slug: "post-call-ai",
  moduleId: "m4",
  number: "5.10",
  title: "Post-Call AI: Summary & Disposition",
  summary:
    "What happens after `onCallEnd()` fires — the LLM pipeline that summarises, classifies, and dispatches every completed call.",
  estMinutes: 18,
  fileRef: "artifacts/api-server/src/orchestration/session.ts",
  prerequisites: ["session-and-pipeline", "llm-adapters"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "The call isn't really over when the line drops",
      paragraphs: [
        "When `config.onCallEnd()` fires and the WebSocket closes, the call is over for the caller. But `endSession()` in `session.ts` still has a lot of work to do. It runs a sequence of **post-call AI jobs** — asynchronously, so they don't block the telephony provider's webhook response — that turn the raw conversation transcript into structured business intelligence.",
        "The three main jobs are: **call summary** (a human-readable paragraph describing what happened), **disposition** (a structured classification matching the agent's configured taxonomy), and **webhook dispatch** (delivering all of this to the operator's backend). Understanding this pipeline is how you understand what lands in the Call Log's detail view.",
      ],
    },
    {
      kind: "concept",
      title: "Managed vs. BYOP on the post-call path",
      body: [
        "The post-call LLM jobs need an API key. SnapServe uses the same key resolution logic as the live call: check if the user has a BYOP key configured for the agent's LLM provider. If yes, use that. If not, fall back to the **managed key** — a Groq API key the platform controls, stored in `platform_settings`.",
        "When falling back to the managed key, the provider is switched to `groq` and the model to `llama-3.3-70b-versatile`, regardless of what the agent is configured to use. This is intentional: the summary job doesn't need the agent's primary model. A fast, cheap model is enough for summarisation.",
        "This fallback means post-call summarisation works for all users on the managed plan without any setup.",
      ],
    },
    {
      kind: "code",
      filename: "orchestration/session.ts",
      language: "typescript",
      intro:
        "The managed-key fallback at the start of the post-call AI block. This pattern appears identically in the summary, disposition, and caller-memory paths.",
      code: `const llmProvs = await db.select().from(providersTable).where(
  and(
    eq(providersTable.isActive, true),
    eq(providersTable.userId, ag.userId!),
    eq(providersTable.providerName, ag.llmProvider)
  )
);
let sumLlmKey: string | null = llmProvs[0]
  ? decryptKey(llmProvs[0].apiKey)
  : null;
let sumLlmProvider = ag.llmProvider;
let sumLlmModel    = ag.llmModel;

// Managed plan: no BYOP key → fall back to platform managed key (Groq)
if (!sumLlmKey) {
  const [row] = await db.select()
    .from(platformSettingsTable)
    .where(eq(platformSettingsTable.key, "managed_qwen_key"));
  sumLlmKey = row?.value?.trim() || process.env["GROQ_API_KEY"] || null;
  if (sumLlmKey) {
    sumLlmProvider = "groq";
    sumLlmModel = "llama-3.3-70b-versatile";
  }
}`,
      lines: [
        {
          lines: "1-10",
          label: "BYOP key lookup",
          explanation:
            "First, try to find the user's own key for the agent's configured LLM provider. `decryptKey` handles the AES-256-GCM decryption for keys stored after the encryption rollout, and passes plaintext through for legacy keys.",
        },
        {
          lines: "14-22",
          label: "Managed fallback",
          explanation:
            "If no BYOP key exists, look up `managed_qwen_key` in `platform_settings`. Despite the name, the value is a Groq API key (the column name is historical). The env var `GROQ_API_KEY` is the ultimate fallback if the DB row is also absent. Provider AND model must be switched together — using a Groq key with `provider: 'openai'` returns a 401.",
        },
      ],
    },
    {
      kind: "prose",
      heading: "Job 1: Call Summary",
      paragraphs: [
        "The summary job sends the full conversation transcript to the LLM with a simple prompt: \"Summarise this call in 2-3 sentences covering what was discussed, any actions taken, and the outcome.\" The result is stored in `calls.call_summary` and displayed prominently in the Call Log detail view.",
        "Edge case: if the transcript is empty (the caller hung up before speaking, or the pipeline failed to produce any STT output), the summary job is skipped and a placeholder string `\"No conversation took place on this call\"` is written instead. This prevents wasting LLM tokens on an empty transcript and avoids a confusing empty summary in the UI.",
      ],
    },
    {
      kind: "prose",
      heading: "Job 2: Disposition",
      paragraphs: [
        "**Disposition** is the structured version of the summary. Instead of a free-text paragraph, it classifies the call against a predefined taxonomy — the agent's configured `dispositionSchema` or its linked call-disposition taxonomy. Each entry in the taxonomy is a key/label pair with a type (string, boolean, select, etc.).",
        "The LLM is given the transcript and the full taxonomy as a JSON schema and asked to fill in the values. For example, a sales agent might have `{ leadQuality: 'hot|warm|cold', productMentioned: boolean, followUpRequired: boolean }`. The LLM reads the conversation and returns a JSON object matching that schema.",
        "The disposition result is stored in `calls.disposition_result` as JSONB and shown as a structured card in the Call Log. It's also included in the webhook payload so operators can route calls by outcome in their CRM.",
      ],
    },
    {
      kind: "code",
      filename: "orchestration/session.ts",
      language: "typescript",
      intro:
        "The fire-and-forget block that runs summary, disposition, and webhook dispatch sequentially inside one async IIFE. Sequential (not parallel) because the webhook payload should include both the summary and disposition results.",
      code: `void (async () => {
  let callSummary     = "";
  let dispositionResult: Record<string, unknown> | null = null;

  // 1. Generate call summary
  if (hasTranscript && sumLlm) {
    callSummary = await generateCallSummary(transcript, sumLlm);
    await db.update(callsTable)
      .set({ callSummary })
      .where(eq(callsTable.id, session.callId));
  }

  // 2. Disposition classification
  if (dispositionSchema.length > 0 && sumLlm) {
    dispositionResult = await extractDispositionResult(
      transcript, dispositionSchema, sumLlm
    );
    await db.update(callsTable)
      .set({ dispositionResult })
      .where(eq(callsTable.id, session.callId));
  }

  // 3. Webhook dispatch (includes both results)
  if (ag.webhookUrl) {
    await dispatchWebhooks(ag.userId, "call.ended", {
      callId:     session.callId,
      summary:    callSummary,
      disposition: dispositionResult,
      // … latency, duration, transcript …
    });
  }
})();`,
      lines: [
        {
          lines: "1",
          label: "void (async () => { … })()",
          explanation:
            "The `void` keyword explicitly discards the promise — this is intentional. The post-call jobs run after `endSession` returns, so they don't block the telephony provider's HTTP response. If a summary takes 3 seconds, the call-end webhook already returned `200 OK` by then.",
        },
        {
          lines: "5-10",
          label: "summary → DB update",
          explanation:
            "Summary is written to `calls.call_summary` immediately after generation, so it appears in the Call Log even if the subsequent disposition job fails. Never hold back partial results.",
        },
        {
          lines: "12-19",
          label: "disposition → DB update",
          explanation:
            "`extractDispositionResult` sends the transcript + schema to the LLM and parses the response as JSON. If the LLM returns invalid JSON, the function returns `null` and the field stays empty rather than crashing.",
        },
        {
          lines: "21-27",
          label: "webhook dispatch",
          explanation:
            "The webhook fires after both AI jobs complete so the payload includes the final summary and disposition. The call record in the DB is already updated by this point, so the operator's backend can also query the API for the full call object.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "insight",
      title: "TRAI opt-out & DPDP PII scan also run post-call",
      body: [
        "Two compliance jobs also run in the post-call window: the TRAI opt-out scan (looking for phrases like 'don't call me again') and the DPDP PII scan (flagging transcripts that contain personally identifiable information for downstream redaction). Both are fire-and-forget and run in parallel with the summary job. See the Compliance chapter for details.",
      ],
    },
    {
      kind: "connections",
      title: "Post-call pipeline",
      nodes: [
        { id: "end",     label: "endSession()",           sublabel: "session.ts",   current: true },
        { id: "billing", label: "Billing debit",          sublabel: "wallet tx" },
        { id: "record",  label: "Recording finalize",     sublabel: "recorder.ts",  chapterSlug: "call-recording" },
        { id: "summary", label: "Call summary LLM",       sublabel: "calls.call_summary" },
        { id: "disp",    label: "Disposition LLM",        sublabel: "calls.disposition_result" },
        { id: "webhook", label: "call.ended webhook",     sublabel: "operator backend" },
        { id: "memory",  label: "Caller memory update",   sublabel: "caller_profiles",  chapterSlug: "caller-memory" },
      ],
      edges: [
        { from: "end",     to: "billing",  label: "await" },
        { from: "end",     to: "record",   label: "await" },
        { from: "end",     to: "summary",  label: "async IIFE" },
        { from: "summary", to: "disp",     label: "sequential" },
        { from: "disp",    to: "webhook",  label: "sequential" },
        { from: "end",     to: "memory",   label: "async IIFE" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "Why are the summary, disposition, and webhook jobs run sequentially inside one async IIFE rather than in parallel?",
          choices: [
            "Sequential execution is faster for LLM calls",
            "The webhook payload should include both the summary and disposition results",
            "Parallel execution would cause race conditions in the database",
            "The LLM API doesn't support concurrent requests",
          ],
          correctIndex: 1,
          explanation:
            "The webhook fires last so it can include the completed summary and disposition in its payload. If all three ran in parallel, the webhook might fire before the LLM jobs finish, delivering an incomplete payload.",
        },
        {
          prompt: "When the managed plan fallback kicks in for post-call summarisation, which model does SnapServe use?",
          choices: [
            "The same model the agent is configured with",
            "GPT-4o from the platform's OpenAI account",
            "llama-3.3-70b-versatile via Groq",
            "A distilled model embedded in the api-server binary",
          ],
          correctIndex: 2,
          explanation:
            "The managed key is a Groq API key, and the model is hardcoded to `llama-3.3-70b-versatile`. Both the provider AND model must be switched together to avoid 401 errors.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "Post-call AI runs after `endSession` returns — fire-and-forget so it doesn't block the provider's webhook",
        "Key resolution: BYOP key first, managed Groq key fallback — both provider AND model must switch together",
        "Summary → Disposition → Webhook runs sequentially so the webhook payload includes both AI results",
        "Empty transcripts get a placeholder string; the summary job is skipped to avoid wasting tokens",
        "Disposition maps the conversation to a structured schema configured per-agent, stored as JSONB",
      ],
    },
  ],
};
