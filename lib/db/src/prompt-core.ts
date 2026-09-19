/**
 * Structured agent prompt core (Phase 1).
 *
 * Authoring is split into Identity / Call purpose / Flow / Instructions.
 * Runtime compiles those into ONE system-instruction string. Legacy agents
 * with only `systemPrompt` compile to that string unchanged.
 *
 * No RAG behaviour lives here.
 */

export type PromptCoreDirection = "inbound" | "outbound" | "both";

export type PromptCoreIdentity = {
  name?: string;
  role?: string;
  company?: string;
  persona?: string;
  language?: string;
};

export type PromptCoreCallContext = {
  direction?: PromptCoreDirection;
  whyThisCall?: string;
  primaryObjective?: string;
  successCriteria?: string;
};

export type PromptCoreFlowStep = {
  title: string;
  objective?: string;
};

export type PromptCoreInstructions = {
  mustDo?: string[];
  mustNotDo?: string[];
  escalation?: string[];
  behavioural?: string[];
};

export type PromptCore = {
  identity?: PromptCoreIdentity;
  callContext?: PromptCoreCallContext;
  flow?: PromptCoreFlowStep[];
  instructions?: PromptCoreInstructions;
};

/** Form-shaped instructions (one textarea per list). */
export type PromptCoreForm = {
  identity?: PromptCoreIdentity;
  callContext?: PromptCoreCallContext;
  flow?: PromptCoreFlowStep[];
  mustDo?: string;
  mustNotDo?: string;
  escalation?: string;
  behavioural?: string;
};

export const DEFAULT_FLOW_STARTERS: PromptCoreFlowStep[] = [
  { title: "GREETING", objective: "Identify yourself and understand why they called." },
  {
    title: "PROFILE",
    objective: "Collect:\n- name\n- location\n- qualification\n- experience\n- languages\n- notice period",
  },
  { title: "QUALIFY", objective: "Determine eligibility for the relevant offering." },
  { title: "MAIN", objective: "Handle the core request. Explain only relevant details." },
  { title: "OBJECTIONS", objective: "Answer concerns briefly. Do not invent facts." },
  { title: "CONFIRM", objective: "Confirm interest and the next step." },
  { title: "CLOSE", objective: "End politely. Do not claim an action succeeded unless confirmed." },
];

const DIRECTIONS = new Set<PromptCoreDirection>(["inbound", "outbound", "both"]);

function trim(s: unknown): string {
  return typeof s === "string" ? s.trim() : "";
}

export function linesToList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((x) => trim(x)).filter(Boolean);
  }
  return trim(raw)
    .split("\n")
    .map((x) => x.replace(/^[-*•]\s*/, "").trim())
    .filter(Boolean);
}

export function listToLines(list: string[] | undefined): string {
  return (list ?? []).join("\n");
}

function compactIdentity(raw: PromptCoreIdentity | undefined): PromptCoreIdentity | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const identity: PromptCoreIdentity = {};
  const name = trim(raw.name);
  const role = trim(raw.role);
  const company = trim(raw.company);
  const persona = trim(raw.persona);
  const language = trim(raw.language);
  if (name) identity.name = name;
  if (role) identity.role = role;
  if (company) identity.company = company;
  if (persona) identity.persona = persona;
  if (language) identity.language = language;
  return Object.keys(identity).length ? identity : undefined;
}

function compactCallContext(raw: PromptCoreCallContext | undefined): PromptCoreCallContext | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const ctx: PromptCoreCallContext = {};
  const direction = trim(raw.direction);
  if (DIRECTIONS.has(direction as PromptCoreDirection)) {
    ctx.direction = direction as PromptCoreDirection;
  }
  const why = trim(raw.whyThisCall);
  const obj = trim(raw.primaryObjective);
  const success = trim(raw.successCriteria);
  if (why) ctx.whyThisCall = why;
  if (obj) ctx.primaryObjective = obj;
  if (success) ctx.successCriteria = success;
  return Object.keys(ctx).length ? ctx : undefined;
}

function compactFlow(raw: unknown): PromptCoreFlowStep[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const steps: PromptCoreFlowStep[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const title = trim((item as PromptCoreFlowStep).title);
    const objective = trim((item as PromptCoreFlowStep).objective);
    if (!title && !objective) continue;
    steps.push({
      title: title || `STEP ${steps.length + 1}`,
      ...(objective ? { objective } : {}),
    });
  }
  return steps.length ? steps : undefined;
}

function compactInstructions(raw: PromptCoreInstructions | undefined): PromptCoreInstructions | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: PromptCoreInstructions = {};
  const mustDo = linesToList(raw.mustDo);
  const mustNotDo = linesToList(raw.mustNotDo);
  const escalation = linesToList(raw.escalation);
  const behavioural = linesToList(raw.behavioural);
  if (mustDo.length) out.mustDo = mustDo;
  if (mustNotDo.length) out.mustNotDo = mustNotDo;
  if (escalation.length) out.escalation = escalation;
  if (behavioural.length) out.behavioural = behavioural;
  return Object.keys(out).length ? out : undefined;
}

/** Drop empty fields so storage stays small and hasPromptCore is honest. */
export function compactPromptCore(raw: unknown): PromptCore | null {
  if (!raw || typeof raw !== "object") return null;
  const src = raw as PromptCore & PromptCoreForm;
  const identity = compactIdentity(src.identity);
  const callContext = compactCallContext(src.callContext);
  const flow = compactFlow(src.flow);
  const fromArrays = compactInstructions(src.instructions);
  const fromForm = compactInstructions({
    mustDo: linesToList(src.mustDo),
    mustNotDo: linesToList(src.mustNotDo),
    escalation: linesToList(src.escalation),
    behavioural: linesToList(src.behavioural),
  });
  const instructions = fromArrays ?? fromForm;
  const core: PromptCore = {};
  if (identity) core.identity = identity;
  if (callContext) core.callContext = callContext;
  if (flow) core.flow = flow;
  if (instructions) core.instructions = instructions;
  return Object.keys(core).length ? core : null;
}

export function parsePromptCore(raw: unknown): PromptCore | null {
  return compactPromptCore(raw);
}

export function hasPromptCore(raw: unknown): boolean {
  return compactPromptCore(raw) != null;
}

export function emptyPromptCoreForm(): PromptCoreForm {
  return {
    identity: { name: "", role: "", company: "", persona: "", language: "" },
    callContext: { whyThisCall: "", primaryObjective: "", successCriteria: "" },
    flow: [],
    mustDo: "",
    mustNotDo: "",
    escalation: "",
    behavioural: "",
  };
}

export function promptCoreToForm(raw: unknown): PromptCoreForm {
  const empty = emptyPromptCoreForm();
  const core = compactPromptCore(raw);
  if (!core) return empty;
  return {
    identity: {
      name: core.identity?.name ?? "",
      role: core.identity?.role ?? "",
      company: core.identity?.company ?? "",
      persona: core.identity?.persona ?? "",
      language: core.identity?.language ?? "",
    },
    callContext: {
      direction: core.callContext?.direction,
      whyThisCall: core.callContext?.whyThisCall ?? "",
      primaryObjective: core.callContext?.primaryObjective ?? "",
      successCriteria: core.callContext?.successCriteria ?? "",
    },
    flow: (core.flow ?? []).map((s) => ({ title: s.title, objective: s.objective ?? "" })),
    mustDo: listToLines(core.instructions?.mustDo),
    mustNotDo: listToLines(core.instructions?.mustNotDo),
    escalation: listToLines(core.instructions?.escalation),
    behavioural: listToLines(core.instructions?.behavioural),
  };
}

function kv(label: string, value: string | undefined): string | null {
  const v = trim(value);
  return v ? `${label}: ${v}` : null;
}

function bulletBlock(heading: string, items: string[] | undefined): string | null {
  if (!items?.length) return null;
  return `${heading}\n${items.map((i) => `- ${i}`).join("\n")}`;
}

function compileIdentity(identity: PromptCoreIdentity | undefined, agentName?: string, agentLanguage?: string): string | null {
  const lines = [
    kv("Name", identity?.name || agentName),
    kv("Role", identity?.role),
    kv("Company", identity?.company),
    kv("Style", identity?.persona),
    kv("Language", identity?.language || agentLanguage),
  ].filter(Boolean);
  if (!lines.length) return null;
  return `IDENTITY\n${lines.join("\n")}`;
}

function compileCallPurpose(ctx: PromptCoreCallContext | undefined): string | null {
  if (!ctx) return null;
  const parts: string[] = [];
  if (ctx.direction === "inbound") parts.push("You are handling an inbound call.");
  else if (ctx.direction === "outbound") parts.push("You are making an outbound call.");
  else if (ctx.direction === "both") parts.push("You handle inbound and outbound calls.");
  if (ctx.whyThisCall) parts.push(ctx.whyThisCall);
  if (ctx.primaryObjective) {
    parts.push(`Objective:\n${ctx.primaryObjective}`);
  }
  if (ctx.successCriteria) {
    parts.push(`Success:\n${ctx.successCriteria}`);
  }
  if (!parts.length) return null;
  return `CALL PURPOSE\n${parts.join("\n\n")}`;
}

function compileFlow(steps: PromptCoreFlowStep[] | undefined): string | null {
  if (!steps?.length) return null;
  const body = steps.map((s, i) => {
    const head = `${i + 1}. ${s.title.toUpperCase()}`;
    return s.objective ? `${head}\n${s.objective}` : head;
  }).join("\n\n");
  return `CALL FLOW\n${body}`;
}

function compileBehaviour(instructions: PromptCoreInstructions | undefined): string | null {
  if (!instructions) return null;
  const blocks = [
    bulletBlock("Must do", instructions.mustDo),
    bulletBlock("Must not do", instructions.mustNotDo),
    bulletBlock("Escalation", instructions.escalation),
    bulletBlock("Behaviour", instructions.behavioural),
  ].filter(Boolean);
  if (!blocks.length) return null;
  return `BEHAVIOUR\n${blocks.join("\n\n")}`;
}

export type CompilePromptCoreOpts = {
  core?: unknown;
  fallbackPrompt?: string | null;
  agentName?: string | null;
  agentLanguage?: string | null;
};

/**
 * Compile structured core + optional legacy script into one runtime prompt.
 *
 * If `core` is empty, returns `fallbackPrompt` unchanged (byte-identical for
 * existing agents). If core is present, structured blocks lead; leftover
 * `systemPrompt` is appended as ADDITIONAL SCRIPT so nothing is lost while
 * operators migrate off the 10k essay.
 */
export function compilePromptCore(opts: CompilePromptCoreOpts): string {
  const fallback = trim(opts.fallbackPrompt);
  const core = compactPromptCore(opts.core);
  if (!core) return opts.fallbackPrompt ?? "";

  const sections = [
    compileIdentity(core.identity, trim(opts.agentName) || undefined, trim(opts.agentLanguage) || undefined),
    compileCallPurpose(core.callContext),
    compileFlow(core.flow),
    compileBehaviour(core.instructions),
  ].filter((s): s is string => !!s);

  let compiled = sections.join("\n\n");
  if (fallback && fallback !== compiled && !compiled.includes(fallback)) {
    compiled = compiled
      ? `${compiled}\n\nADDITIONAL SCRIPT\n${fallback}`
      : fallback;
  }
  return compiled;
}
