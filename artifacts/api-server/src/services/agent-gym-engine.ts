/** Pure gym conversation + scoring. No database. */

export const GYM_LESSONS_HEADING = "## Approved gym lessons";
export const INTERRUPT_TAG = "[INTERRUPT]";

export interface GymPersona {
  id: string;
  name: string;
  goal: string;
  interrupt: boolean;
  personaPrompt: string;
  successCriteria: string[];
  maxTurns: number;
}

export const GYM_PERSONAS: GymPersona[] = [
  {
    id: "busy_interrupter",
    name: "Busy interrupter",
    goal: "Cut the agent off twice, change the subject, then ask one real question.",
    interrupt: true,
    maxTurns: 8,
    successCriteria: [
      "Agent recovers after being cut off without restarting the whole greeting",
      "Agent answers the real question",
      "Agent does not talk over the customer after an interrupt",
    ],
    personaPrompt:
      "You are a busy person who answered a sales/service call while doing something else. You interrupt mid-sentence, say 'wait wait', change the topic, then eventually ask one concrete question. Keep lines to 1–2 spoken sentences.",
  },
  {
    id: "confused_buyer",
    name: "Confused buyer",
    goal: "Misunderstand the offer twice, then decide only if the agent explains clearly.",
    interrupt: false,
    maxTurns: 8,
    successCriteria: [
      "Agent rephrases without sounding impatient",
      "Agent does not invent prices, dates, or policies",
      "Agent checks understanding before pushing to book",
    ],
    personaPrompt:
      "You are interested but confused. You mix up what the agent said, ask 'sorry what?' and 'so this is free?' You only agree if they explain simply. If they rush you, you stall.",
  },
  {
    id: "skeptical_price",
    name: "Skeptical on price",
    goal: "Push on cost, competitors, and 'call me later' — see if the agent stays honest.",
    interrupt: true,
    maxTurns: 8,
    successCriteria: [
      "Agent does not invent a discount or competitor claim",
      "Agent handles 'call me later' without being pushy",
      "Agent recovers if interrupted during the pitch",
    ],
    personaPrompt:
      "You are skeptical. Interrupt the pitch with 'how much?' and 'that's expensive, the other place is cheaper.' Ask them to call later. You may hang up if they invent facts or pressure you.",
  },
  {
    id: "wrong_person",
    name: "Wrong person / voicemail-ish",
    goal: "Say this is the wrong number or you are not the decision maker.",
    interrupt: false,
    maxTurns: 6,
    successCriteria: [
      "Agent does not keep pitching after wrong-person is clear",
      "Agent asks who to speak to or offers a callback politely",
      "Agent ends cleanly instead of looping",
    ],
    personaPrompt:
      "You answered someone else's phone, or this is the wrong person. Say so early. If they keep selling, get annoyed and hang up. Do not play along as the intended customer.",
  },
  {
    id: "ready_to_book",
    name: "Ready to book",
    goal: "Be cooperative and try to complete the agent's actual goal.",
    interrupt: false,
    maxTurns: 8,
    successCriteria: [
      "Agent collects what it needs without rambling",
      "Agent confirms next step clearly",
      "Agent does not invent availability or prices",
    ],
    personaPrompt:
      "You are the right person and you have a few minutes. Answer questions helpfully. If asked for a name use Priya Sharma, phone 9876543210, and prefer weekday evenings. If they never ask for a next step, prompt 'so what do I do next?'",
  },
];

export type GymChatFn = (opts: {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}) => Promise<string>;

export interface GymTurn {
  role: "assistant" | "user";
  content: string;
  interrupted?: boolean;
}

export interface GymConversationResult {
  turns: GymTurn[];
  endedBy: "customer" | "max_turns";
  interruptCount: number;
}

export interface GymScorecard {
  scores: {
    interruptRecovery: number;
    stayedOnGoal: number;
    answeredQuestions: number;
    didNotHallucinate: number;
    naturalTurnTaking: number;
  };
  overall: number;
  pass: boolean;
  failures: string[];
  lessons: string[];
  suggestedPromptAddendum: string;
}

export type GymRunSource = "gym" | "campaign";

export interface GymRunResultJson {
  source: GymRunSource;
  personaId: string | null;
  suiteId: string | null;
  interruptCount: number;
  scores: GymScorecard["scores"] | null;
  pass: boolean | null;
  failures: string[];
  lessons: string[];
  suggestedPromptAddendum: string;
  callId?: number;
  approvedAt?: string;
}

function stripInterrupt(text: string): { content: string; interrupted: boolean } {
  const trimmed = text.trim();
  const tagged = trimmed.toUpperCase().startsWith(INTERRUPT_TAG);
  if (!tagged) return { content: trimmed, interrupted: false };
  return {
    content: `${INTERRUPT_TAG} ${trimmed.slice(INTERRUPT_TAG.length).trim()}`,
    interrupted: true,
  };
}

function isEndCall(text: string): boolean {
  const t = text.trim().toUpperCase().replace(/[\[\]]/g, "");
  return t === "END_CALL" || t === "END CALL" || t.startsWith("END_CALL");
}

export function agentGymSystemPrompt(agentPrompt: string): string {
  return `${agentPrompt.trim()}

You are on a live phone call. Reply with one spoken turn only — the words you would say out loud. No markdown, no stage directions.
If the customer's last message starts with ${INTERRUPT_TAG}, they cut you off mid-sentence. Recover naturally. Do not restart the whole greeting unless they ask who you are.`;
}

export function customerGymSystemPrompt(persona: GymPersona, language?: string | null): string {
  const lang = language?.trim() ? `Speak in ${language}.` : "Match the agent's language.";
  return `You are a customer on a live phone call, testing a voice agent. Stay in character. Never mention tests, AI, or scorecards.
${lang}
Persona: ${persona.personaPrompt}
Your goal: ${persona.goal}
${persona.interrupt ? `You SHOULD interrupt at least once: start that turn with exactly ${INTERRUPT_TAG} then your spoken words.` : `Do not interrupt. Wait for the agent to finish.`}
Keep each turn to 1–3 spoken sentences.
When you would hang up or the conversation is done, reply with exactly END_CALL and nothing else.`;
}

export async function runGymConversation(opts: {
  agentPrompt: string;
  greeting?: string | null;
  persona: GymPersona;
  language?: string | null;
  chat: GymChatFn;
}): Promise<GymConversationResult> {
  const agentSystem = agentGymSystemPrompt(opts.agentPrompt);
  const customerSystem = customerGymSystemPrompt(opts.persona, opts.language);
  const turns: GymTurn[] = [];
  let interruptCount = 0;
  const maxTurns = Math.max(2, Math.min(opts.persona.maxTurns || 8, 12));

  const greeting = opts.greeting?.trim();
  if (greeting) {
    turns.push({ role: "assistant", content: greeting });
  } else {
    const opening = await opts.chat({
      system: agentSystem,
      messages: [{ role: "user", content: "The customer just answered the phone. Speak only your opening line." }],
    });
    turns.push({ role: "assistant", content: opening || "Hello?" });
  }

  for (let i = 0; i < maxTurns; i++) {
    const customerRaw = await opts.chat({
      system: customerSystem,
      messages: toCustomerView(turns),
    });
    if (!customerRaw || isEndCall(customerRaw)) {
      return { turns, endedBy: "customer", interruptCount };
    }
    const spoken = stripInterrupt(customerRaw);
    if (spoken.interrupted) interruptCount += 1;
    turns.push({
      role: "user",
      content: spoken.content,
      interrupted: spoken.interrupted || undefined,
    });

    const agentReply = await opts.chat({
      system: agentSystem,
      messages: toAgentView(turns),
    });
    if (!agentReply || isEndCall(agentReply)) {
      if (agentReply && !isEndCall(agentReply)) turns.push({ role: "assistant", content: agentReply });
      return { turns, endedBy: "customer", interruptCount };
    }
    turns.push({ role: "assistant", content: agentReply });
  }

  return { turns, endedBy: "max_turns", interruptCount };
}

function toAgentView(turns: GymTurn[]): Array<{ role: "user" | "assistant"; content: string }> {
  return turns.map((t) => ({ role: t.role, content: t.content }));
}

function toCustomerView(turns: GymTurn[]): Array<{ role: "user" | "assistant"; content: string }> {
  return turns.map((t) => ({
    role: t.role === "assistant" ? "user" : "assistant",
    content: t.content.replace(/^\s*\[INTERRUPT\]\s*/i, ""),
  }));
}

export function parseScorecard(raw: string): GymScorecard {
  const empty: GymScorecard = {
    scores: {
      interruptRecovery: 0,
      stayedOnGoal: 0,
      answeredQuestions: 0,
      didNotHallucinate: 0,
      naturalTurnTaking: 0,
    },
    overall: 0,
    pass: false,
    failures: ["Scorer returned no JSON"],
    lessons: [],
    suggestedPromptAddendum: "",
  };
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return empty;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return empty;
  }
  const scoresRaw = (parsed["scores"] ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(5, n));
  };
  const scores = {
    interruptRecovery: num(scoresRaw["interruptRecovery"]),
    stayedOnGoal: num(scoresRaw["stayedOnGoal"]),
    answeredQuestions: num(scoresRaw["answeredQuestions"]),
    didNotHallucinate: num(scoresRaw["didNotHallucinate"]),
    naturalTurnTaking: num(scoresRaw["naturalTurnTaking"]),
  };
  const avg = (Object.values(scores).reduce((a, b) => a + b, 0) / 5) * 20;
  let overall = typeof parsed["overall"] === "number" ? parsed["overall"] : Number(parsed["overall"]);
  if (!Number.isFinite(overall)) overall = avg;
  overall = Math.max(0, Math.min(100, Math.round(overall)));
  const lessons = Array.isArray(parsed["lessons"])
    ? parsed["lessons"].filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    : [];
  const failures = Array.isArray(parsed["failures"])
    ? parsed["failures"].filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    : [];
  const addendum = typeof parsed["suggestedPromptAddendum"] === "string"
    ? parsed["suggestedPromptAddendum"].trim()
    : "";
  const pass = typeof parsed["pass"] === "boolean" ? parsed["pass"] : overall >= 70 && failures.length === 0;
  return { scores, overall, pass, failures, lessons, suggestedPromptAddendum: addendum };
}

export function mergeGymPromptAddendum(current: string, addendum: string): { next: string; applied: boolean } {
  const lesson = addendum.trim();
  if (!lesson) return { next: current, applied: false };
  if (current.includes(lesson)) return { next: current, applied: false };
  if (current.includes(GYM_LESSONS_HEADING)) {
    return { next: `${current.trimEnd()}\n\n${lesson}`, applied: true };
  }
  return { next: `${current.trimEnd()}\n\n${GYM_LESSONS_HEADING}\n${lesson}\n`, applied: true };
}

export function formatGymTranscript(turns: GymTurn[]): string {
  return turns
    .map((t) => {
      const who = t.role === "assistant" ? "Agent" : "Customer";
      const tag = t.interrupted ? " [interrupted]" : "";
      return `${who}${tag}: ${t.content}`;
    })
    .join("\n");
}

export function gymScoreSystemPrompt(): string {
  return `You score a voice-agent phone call. Be harsh on invented facts, ignored interrupts, and looping.
Reply with JSON only:
{
  "scores": {
    "interruptRecovery": 0-5,
    "stayedOnGoal": 0-5,
    "answeredQuestions": 0-5,
    "didNotHallucinate": 0-5,
    "naturalTurnTaking": 0-5
  },
  "overall": 0-100,
  "pass": true/false,
  "failures": ["short bullet"],
  "lessons": ["what the agent should do next time"],
  "suggestedPromptAddendum": "2-5 imperative prompt lines to add, or empty string if nothing to change"
}`;
}

export function scorecardUserPrompt(opts: {
  agentPrompt: string;
  transcript: string;
  persona?: GymPersona | null;
  successCriteria?: string[];
}): string {
  const criteria = (opts.successCriteria ?? opts.persona?.successCriteria ?? []).join("\n- ");
  const personaLine = opts.persona
    ? `Customer persona: ${opts.persona.name}\nGoal: ${opts.persona.goal}\n`
    : "Source: a real campaign or production call.\n";
  return `${personaLine}Success criteria:\n- ${criteria || "Handle the caller helpfully without inventing facts."}

Agent system prompt (excerpt):
${opts.agentPrompt.slice(0, 2500)}

Transcript:
${opts.transcript.slice(0, 8000)}`;
}

/** Live calls on managed agents use platform keys. Gym must do the same. */
export type GymLlmSource = "byop" | "managed";

export interface GymLlmPlan {
  source: GymLlmSource;
  provider: string;
  model: string | null;
  managedKeys: string[];
}

export function managedKeysForProvider(provider: string): string[] {
  switch (provider) {
    case "google":
    case "gemini":
      return ["managed_gemini_key"];
    case "groq":
      return ["managed_groq_key", "managed_qwen_key"];
    case "qwen":
      return ["managed_qwen_key", "managed_groq_key"];
    case "openai":
      return ["managed_openai_key"];
    case "sarvam":
      return ["managed_sarvam_key"];
    default:
      return [`managed_${provider}_key`];
  }
}

export function planGymLlmSource(opts: {
  agentMode?: string | null;
  llmProvider: string;
  llmModel: string | null;
  hasByopKey: boolean;
}): GymLlmPlan {
  const provider = (opts.llmProvider || "sarvam").toLowerCase();
  const isByop = (opts.agentMode ?? "managed") === "byop";
  if (isByop && opts.hasByopKey) {
    return { source: "byop", provider, model: opts.llmModel, managedKeys: [] };
  }
  return {
    source: "managed",
    provider,
    model: opts.llmModel,
    managedKeys: managedKeysForProvider(provider),
  };
}
