import type { Chapter } from "../types";

export const agentBuilder: Chapter = {
  slug: "agent-builder",
  moduleId: "m7",
  number: "7.3",
  title: "The Agent Builder",
  summary:
    "The multi-step form where users wire up an agent's STT + LLM + TTS + telephony pipeline.",
  estMinutes: 16,
  fileRef: "artifacts/dashboard/src/pages/",
  prerequisites: ["react-vite-app", "data-hooks"],
  status: "published",
  blocks: [
    {
      kind: "prose",
      heading: "What & Why",
      paragraphs: [
        "Every voice agent that SnapServe runs — the thing that picks up the phone, listens, thinks, and talks back — is configured in **one screen**: the Agent Builder. This is where a user picks Deepgram for speech-to-text, GPT-4o for the brain, Cartesia for the voice, and Vobiz for the phone line, then writes the system prompt and tunes a hundred knobs like barge-in sensitivity and voicemail behavior.",
        "It's the most complex page in the whole dashboard — `builder.tsx` is nearly 5,000 lines. But it's built from a handful of patterns you already half-know: a **Zod schema** as the single source of truth, **react-hook-form** to drive a tabbed form, a **transform function** to reshape the flat form into the nested API payload, and a **generated mutation hook** to save it. Learn those four moving parts and the whole giant file becomes readable.",
        "This chapter walks the real `pages/agents` files: `edit.schema.ts` (the shape), `builder.tsx` (the tabbed form + save), and `edit.tsx` (the payload transform).",
      ],
    },
    {
      kind: "concept",
      title: "One schema, many tabs",
      body: [
        "The Agent Builder is a **multi-step form**: instead of one endless scroll, fields are grouped into tabs — Overview, Prompt, Voice, Tools, Analysis, Voicemail, Advanced. But it is **not** seven separate forms. It's one `react-hook-form` instance whose fields are scattered across the tabs. Switching tabs just shows a different slice of the same form state.",
        "**react-hook-form** keeps all field values in a single store and re-renders as little as possible. **Zod** describes the valid shape of that store; `zodResolver` connects them so validation rules live in exactly one place. The form's `defaultValues` define a brand-new agent; loading an existing one calls `form.reset(...)` to repopulate every field.",
        "A subtle but important idea: the **form shape is flat and UI-friendly**, while the **API shape is nested**. The form has `bargeInEnabled`, `startSpeakingWaitSecs`, `complianceIrdai` as top-level fields; the API wants them tucked inside an `agentConfig` object. A transform function bridges the two on save.",
      ],
    },
    {
      kind: "analogy",
      title: "A studio mixing console",
      body: [
        "Think of a recording studio's mixing console. The **channel strips** are the providers — one fader for the mic input (STT), one for the effects rack (LLM), one for the monitor output (TTS), one for the line out (telephony). The **rows of knobs** below are the fine-tuning: gain, EQ, reverb — here, barge-in thresholds, silence timeouts, voicemail rules.",
        "An engineer doesn't rebuild the console for every song; they load a **preset** (your saved agent), tweak a few knobs, and hit save. The Agent Builder is that console, and `buildUpdateAgentPayload` is the act of writing the current knob positions back onto the preset.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/dashboard/src/pages/agents/edit.schema.ts",
      language: "typescript",
      intro:
        "Start with the shape. The top of the Zod schema is the pipeline itself — the four providers that define what an agent is.",
      code: `export const agentFormSchema = z.object({
  name:              z.string().min(1, "Name is required"),
  description:       z.string().optional(),
  asrProvider:       z.string().min(1, "ASR Provider is required"),
  asrModel:          z.string().optional(),
  llmProvider:       z.string().min(1, "LLM Provider is required"),
  llmModel:          z.string().optional(),
  ttsProvider:       z.string().min(1, "TTS Provider is required"),
  ttsVoice:          z.string().optional(),
  ttsModel:          z.string().optional(),
  telephonyProvider: z.string().min(1, "Telephony Provider is required"),
  systemPrompt:      z.string().min(1, "System prompt is required"),
  // …`,
      lines: [
        {
          lines: "4-5",
          label: "the STT stage",
          explanation:
            "`asrProvider` (ASR = automatic speech recognition, i.e. speech-to-text) is **required** with a friendly error; `asrModel` is optional because each provider has a sensible default. This is the first link in the pipeline.",
        },
        {
          lines: "6-7",
          label: "the LLM stage",
          explanation:
            "`llmProvider` + optional `llmModel` — the brain. Same required/optional pattern. The valid choices come from `@/lib/agent-providers` (imported at the top of the file).",
        },
        {
          lines: "8-10",
          label: "the TTS stage",
          explanation:
            "`ttsProvider`, plus `ttsVoice` and `ttsModel` — the mouth. Three fields because a voice picks both a model and a specific voice id.",
        },
        {
          lines: "11-12",
          label: "telephony + prompt",
          explanation:
            "`telephonyProvider` is the phone line, and `systemPrompt` is required — an agent with no instructions is useless. Below this (elided) live ~80 more optional knobs: barge-in, voicemail, compliance, tools, and more.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "why",
      title: "Why a schema instead of plain useState?",
      body: [
        "With ~90 fields, hand-rolling `useState` per field would be madness, and validation would be copy-pasted everywhere. A single Zod schema gives you: typed values (`AgentFormValues` is inferred from it), one place for every rule and error message, and instant validation via `zodResolver`. The backend has its **own** validation too — this is the friendly first line of defense, not the only one.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/dashboard/src/pages/agents/builder.tsx",
      language: "typescript",
      intro:
        "The 'steps' of the multi-step form are just a typed list. This `TABS` array drives the tab strip you click across the top.",
      code: `type TabId = "overview" | "prompt" | "voice" | "tools" | "analysis" | "voicemail" | "advanced" | "logs" | "versions";

interface TabDef { id: TabId; label: string; icon: React.ReactNode }

const TABS: TabDef[] = [
  { id: "overview",    label: "Overview",    icon: <Bot className="h-3.5 w-3.5" /> },
  { id: "prompt",      label: "Prompt",      icon: <FileText className="h-3.5 w-3.5" /> },
  { id: "voice",       label: "Voice",       icon: <Mic className="h-3.5 w-3.5" /> },
  { id: "tools",       label: "Tools",       icon: <Wrench className="h-3.5 w-3.5" /> },
  { id: "analysis",    label: "Analysis",    icon: <BarChart3 className="h-3.5 w-3.5" /> },
  { id: "voicemail",   label: "Voicemail",   icon: <VoicemailIcon className="h-3.5 w-3.5" /> },
  { id: "advanced",    label: "Advanced",    icon: <SlidersHorizontal className="h-3.5 w-3.5" /> },
  { id: "logs",        label: "Logs",        icon: <List className="h-3.5 w-3.5" /> },
  { id: "versions",    label: "Versions",    icon: <History className="h-3.5 w-3.5" /> },
];`,
      lines: [
        {
          lines: "1",
          label: "TabId union",
          explanation:
            "A string-literal union — the only valid tab names. `activeTab` is typed as `TabId`, so a typo like `\"overviw\"` won't compile. Cheap, powerful type safety.",
        },
        {
          lines: "5-13",
          label: "the data-driven tab strip",
          explanation:
            "Tabs are **data**, not hand-written JSX. The component `TABS.map(...)` over this array to render the buttons, so adding a tab is one line here. The first seven are form tabs; `logs` and `versions` render different (non-form) views.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/dashboard/src/pages/agents/builder.tsx",
      language: "typescript",
      intro:
        "The single form instance for the whole editor. One `useForm`, wired to the Zod schema, seeded with the defaults for a fresh agent.",
      code: `  const form = useForm<AgentFormValues>({
    resolver: zodResolver(agentFormSchema),
    defaultValues: {
      name: "", description: "", asrProvider: "deepgram", asrModel: "",
      llmProvider: "openai", llmModel: "", ttsProvider: "cartesia",
      ttsVoice: "", ttsModel: "", telephonyProvider: "vobiz",
      systemPrompt: "", temperature: 0.40, maxDuration: 300,
      // …
    },
  });`,
      lines: [
        {
          lines: "1",
          label: "useForm<AgentFormValues>",
          explanation:
            "`AgentFormValues` is the type inferred from the Zod schema, so the form store is fully typed — `form.watch(\"asrProvider\")` returns a `string`, `form.watch(\"temperature\")` a `number`.",
        },
        {
          lines: "2",
          label: "resolver: zodResolver(agentFormSchema)",
          explanation:
            "This is the bridge. Every validation runs the schema; errors land in `form.formState.errors` keyed by field name. One line connects all ~90 rules.",
        },
        {
          lines: "4-7",
          label: "sensible defaults",
          explanation:
            "A new agent starts on Deepgram + OpenAI + Cartesia + Vobiz, temperature 0.40, 300-second max. These defaults define the 'create' experience; the elided part sets the rest of the knobs.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/dashboard/src/pages/agents/builder.tsx",
      language: "typescript",
      intro:
        "Rendering the active tab is delightfully simple: it's the same `form` handed to whichever tab component matches `activeTab`.",
      code: `        <Form {...form}>
          <form onSubmit={e => e.preventDefault()} className="flex-1 min-h-0 overflow-hidden">
            {activeTab === "overview"  && <OverviewTab form={form} rateMap={rateMap} agent={agent} />}
            {activeTab === "prompt"    && <PromptTab form={form} />}
            {activeTab === "voice"     && <VoiceTab form={form} />}
            {activeTab === "tools"     && <ToolsTab form={form} agentId={agentId} />}
            {activeTab === "analysis"  && <AnalysisTab form={form} agentId={agentId} />}
            {activeTab === "voicemail" && <VoicemailTab form={form} />}
            {activeTab === "advanced"  && <AdvancedTab form={form} agent={agent} />}
          </form>
        </Form>`,
      lines: [
        {
          lines: "2",
          label: "onSubmit preventDefault",
          explanation:
            "The native form submit is suppressed — saving is triggered by a button calling `onSave`, not by Enter inside a field. This stops accidental submits from a stray keystroke in a 90-field form.",
        },
        {
          lines: "3-9",
          label: "one form, many slices",
          explanation:
            "Each tab is a component that receives the **same** `form` object. Because they all share one store, a value you type on the Voice tab is still there when you flip to Advanced and back. This is the heart of the multi-step pattern.",
        },
      ],
    },
    {
      kind: "concept",
      title: "Flat form → nested payload",
      body: [
        "The form is intentionally flat so the UI stays simple, but the API expects a tidy nested object. The agent's core fields (name, providers, prompt) sit at the top level, while dozens of tuning knobs get folded into a single `agentConfig` blob — and only when they differ from the default, to keep payloads lean.",
        "`buildUpdateAgentPayload` is the translator. It destructures the knobs out of the form, assembles `agentConfig`, serializes the tools into the API's JSON-schema shape, and returns the final body the mutation hook will PATCH to the server.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/dashboard/src/pages/agents/edit.tsx",
      language: "typescript",
      intro:
        "The transform function. It pulls the knobs out of the flat form and rebuilds them as nested config — note how it only includes values that differ from the defaults.",
      code: `export function buildUpdateAgentPayload(data: AgentFormValues) {
  const {
    webhookSecret, promptVariables, vadSilenceMs, bargeInEnabled, bargeInEnergyThreshold, bargeInMinFrames,
    // …
    ...rest
  } = data;
  const agentConfig: Record<string, unknown> = {};
  if (webhookSecret) agentConfig["webhookSecret"] = webhookSecret;
  if (promptVariables?.length) agentConfig["promptVariables"] = promptVariables;
  // …
  agentConfig["startSpeakingPlan"] = {
    waitSeconds:            startSpeakingWaitSecs          ?? 0,
    onPunctuationSeconds:   startSpeakingOnPunctuationSecs ?? 0,
    onNoPunctuationSeconds: startSpeakingOnNoPunctuationSecs ?? 0,
    onNumberSeconds:        startSpeakingOnNumberSecs      ?? 0,
  };
  // …
  return {
    ...rest,
    firstSpeaker: rest.firstSpeaker === "user" ? "user" : "assistant",
    tools: serializedTools,
    asrLanguage: rest.asrLanguage || null,
    // …
    ...(Object.keys(agentConfig).length > 0 ? { agentConfig } : {}),
  };
}`,
      lines: [
        {
          lines: "2-6",
          label: "destructure the knobs out",
          explanation:
            "It pulls every tuning field (`vadSilenceMs`, `bargeInEnabled`, …) out of the form data, leaving the core fields collected in `...rest`. This cleanly separates 'goes into agentConfig' from 'stays top-level'.",
        },
        {
          lines: "8-9",
          label: "only include what's set",
          explanation:
            "`if (webhookSecret) …` and `if (promptVariables?.length) …` — empty/falsy values are skipped, so the payload only carries meaningful overrides. Smaller, cleaner requests.",
        },
        {
          lines: "11-16",
          label: "rebuild nested structures",
          explanation:
            "Four flat fields (`startSpeakingWaitSecs`, …) are reassembled into the nested `startSpeakingPlan` object the API wants, with `?? 0` defaults. The UI flatness is purely cosmetic — it's nested again here.",
        },
        {
          lines: "18-25",
          label: "the final body",
          explanation:
            "`...rest` spreads the core fields, then it normalizes a few (`firstSpeaker`, `asrLanguage` → `null`), attaches the serialized `tools`, and **conditionally** includes `agentConfig` only if anything was set. That last spread trick is how you add a key only when needed.",
        },
      ],
    },
    {
      kind: "code",
      filename: "artifacts/dashboard/src/pages/agents/builder.tsx",
      language: "typescript",
      intro:
        "Saving ties it all together: validate (via the schema), transform, fire the generated mutation, then invalidate the cache so the UI refreshes.",
      code: `  const onSave = form.handleSubmit(
    async (data) => {
      try {
        const payload = buildUpdateAgentPayload(data);
        await updateAgent.mutateAsync({ id: agentId, data: payload as any });
        queryClient.invalidateQueries({ queryKey: getGetAgentQueryKey(agentId) });
        queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });
        toast({ title: "Saved", description: \`\${data.name} updated.\` });
      } catch (err) {
        const mapped = mapApiErrors(err);
        if (mapped) { Object.entries(mapped).forEach(([k, v]) => form.setError(k as any, { message: v })); }
        toast({ title: "Error", description: formatApiError(err), variant: "destructive" });
      }
    },
    // …second callback: on validation failure, jump to the tab with the first bad field…
  );`,
      lines: [
        {
          lines: "1-2",
          label: "form.handleSubmit(onValid, onInvalid)",
          explanation:
            "`handleSubmit` runs the Zod schema first. The first callback fires only if validation **passes**, receiving the clean, typed `data`. The second (elided) fires on failure.",
        },
        {
          lines: "4-5",
          label: "transform, then mutate",
          explanation:
            "Build the nested payload, then call `updateAgent.mutateAsync` — the generated `useUpdateAgent()` hook from the previous chapter. It PATCHes `/api/agents/:id` with the `Bearer` token attached automatically.",
        },
        {
          lines: "6-7",
          label: "invalidate after save",
          explanation:
            "Invalidate both the single-agent query and the agents list, so the editor and the sidebar both reflect the new state. This is the 'invalidate, don't refetch by hand' pattern in action.",
        },
        {
          lines: "8",
          label: "success toast",
          explanation:
            "A friendly confirmation. Note the template string uses `data.name` — the freshly-saved name — for a personal touch.",
        },
        {
          lines: "10-12",
          label: "map server errors back to fields",
          explanation:
            "If the backend rejects the save, `mapApiErrors` turns its error into per-field messages via `form.setError`, so the bad field lights up red — and a destructive toast shows the overall message.",
        },
      ],
    },
    {
      kind: "callout",
      variant: "gotcha",
      title: "Validation errors hijack the active tab",
      body: [
        "Because fields are spread across tabs, a validation error might be on a tab you can't see. The elided second callback of `handleSubmit` maps the first failing field to its tab (e.g. `systemPrompt` → 'prompt', `ttsProvider` → 'voice') and calls `setActiveTab(...)`, then toasts something like 'System prompt is required (Prompt tab)'. Without this, users would hit Save, see an error, and have no idea where it is.",
      ],
    },
    {
      kind: "code",
      filename: "artifacts/dashboard/src/pages/agents/builder.tsx",
      language: "typescript",
      intro:
        "Creating a brand-new agent is its own tiny flow — fire a mutation with a starter pipeline, then navigate into the editor.",
      code: `  const handleCreate = () => {
    createAgent.mutate(
      { data: { name: "New Agent", asrProvider: "azure", asrModel: "en-US-standard", llmProvider: "openai", llmModel: "gpt-4o-mini", ttsProvider: "cartesia", ttsVoice: "", ttsModel: "", telephonyProvider: "vobiz", systemPrompt: "You are a helpful AI voice assistant.", greetingMessage: "Hello", language: "en-US" } as any },
      { onSuccess: (agent) => handleSelect(agent.id), onError: (err: unknown) => toast({ title: "Error", description: formatApiError(err), variant: "destructive" }) }
    );
  };`,
      lines: [
        {
          lines: "2-3",
          label: "createAgent.mutate(starter pipeline)",
          explanation:
            "`useCreateAgent()` is another generated mutation hook. The new agent ships with a complete working pipeline (Azure STT, GPT-4o-mini, Cartesia TTS, Vobiz telephony) so it can take a call before the user changes anything.",
        },
        {
          lines: "4",
          label: "onSuccess → navigate",
          explanation:
            "`mutate` (not `mutateAsync`) takes callbacks. On success it calls `handleSelect(agent.id)`, which routes to `/app/agents/:id` — dropping the user straight into the editor for their new agent.",
        },
      ],
    },
    {
      kind: "connections",
      title: "How it connects",
      intro:
        "The Agent Builder turns form clicks into a saved pipeline that drives live calls. Click a box to jump to its chapter.",
      nodes: [
        { id: "route", label: "App.tsx route", sublabel: "/app/agents/:id", chapterSlug: "react-vite-app" },
        { id: "schema", label: "edit.schema.ts", sublabel: "Zod form schema", current: true },
        { id: "builder", label: "agents/builder.tsx", sublabel: "THIS FILE — tabs + form", current: true },
        { id: "payload", label: "buildUpdateAgentPayload", sublabel: "edit.tsx transform", current: true },
        { id: "hook", label: "useUpdateAgent()", sublabel: "generated mutation", chapterSlug: "data-hooks" },
        { id: "server", label: "PATCH /api/agents/:id", sublabel: "agents route", chapterSlug: "routes-anatomy" },
        { id: "pipeline", label: "Live call pipeline", sublabel: "uses the config", chapterSlug: "session-and-pipeline" },
      ],
      edges: [
        { from: "route", to: "builder", label: "renders editor" },
        { from: "schema", to: "builder", label: "validates fields" },
        { from: "builder", to: "payload", label: "on save" },
        { from: "payload", to: "hook", label: "mutateAsync(payload)" },
        { from: "hook", to: "server", label: "PATCH agent" },
        { from: "server", to: "pipeline", label: "config drives STT/LLM/TTS" },
      ],
    },
    {
      kind: "quiz",
      questions: [
        {
          prompt: "How many `useForm` instances power the seven editable tabs of the Agent Builder?",
          choices: [
            "One per tab (seven total).",
            "One — every tab component shares the same `form` object.",
            "Two — one for basic and one for advanced.",
            "Zero — it uses plain useState.",
          ],
          correctIndex: 1,
          explanation:
            "There's a single `useForm` instance; each tab receives the same `form` prop and renders a slice of it, so values persist as you switch tabs.",
        },
        {
          prompt: "Why does `buildUpdateAgentPayload` exist between the form and the API?",
          choices: [
            "To encrypt the data.",
            "To reshape the flat, UI-friendly form values into the API's nested shape (e.g. fold knobs into `agentConfig`).",
            "To cache the agent.",
            "To validate the form a second time.",
          ],
          correctIndex: 1,
          explanation:
            "The form is flat for simple UI; the API wants nested structures like `agentConfig` and `startSpeakingPlan`. The transform bridges the two and includes only non-default overrides.",
        },
        {
          prompt: "After `updateAgent.mutateAsync` succeeds, why does `onSave` call `queryClient.invalidateQueries`?",
          choices: [
            "To log the user out.",
            "To mark the agent and agent-list queries stale so the editor and sidebar refetch the updated data.",
            "To retry the save.",
            "To clear the form.",
          ],
          correctIndex: 1,
          explanation:
            "Invalidating the relevant query keys forces TanStack Query to refetch, so every view of that agent reflects the just-saved changes without manual state juggling.",
        },
      ],
    },
    {
      kind: "keyTakeaways",
      items: [
        "The Agent Builder is one big multi-step form: a single `useForm` instance whose fields are spread across tabs (Overview, Prompt, Voice, Tools, …).",
        "`edit.schema.ts` is the single source of truth — Zod defines the ~90 fields, `zodResolver` wires validation, and `AgentFormValues` is inferred from it.",
        "The agent's identity is its pipeline: required `asrProvider`, `llmProvider`, `ttsProvider`, `telephonyProvider`, plus the system prompt.",
        "`buildUpdateAgentPayload` translates the flat form into the API's nested shape (`agentConfig`, `startSpeakingPlan`, serialized tools), including only non-default overrides.",
        "Saving = validate → transform → `useUpdateAgent().mutateAsync` → invalidate queries; validation errors auto-jump you to the tab holding the first bad field.",
      ],
    },
  ],
};
