/**
 * Candidate intake inbound agent — the one agent shape behind the recruiter demo.
 *
 * Everything an operator is allowed to change lives in `IntakeAgentControls`:
 * name, LLM, TTS provider/voice/speed, and the inbound number. The rest of the
 * stack (Sarvam STT in English, the prompt, the intake tools) is fixed here so
 * every call behaves the same way regardless of who clicked create.
 */
import { DISPOSITION_MEANINGS, INTAKE_DISPOSITIONS } from "./intake-dispositions.js";
import { INTAKE_LOCKED_FIELDS } from "./candidate-intake-fields.js";
import { intakeSpokenName } from "./intake-call-context.js";
import type { AgentTool } from "../orchestration/types.js";

export const INTAKE_AGENT_TYPE = "intake_inbound";

// ── Controllable: LLM ────────────────────────────────────────────────────────

export interface IntakeModelChoice {
  value: string;
  label: string;
}

/**
 * Groq and Sarvam only. Both are fast enough to keep a form-filling turn under
 * a second, and both handle the tool-call-per-answer pattern the prompt needs.
 */
export const INTAKE_LLM_CATALOG: Record<string, IntakeModelChoice[]> = {
  groq: [
    { value: "llama-3.3-70b-versatile", label: "Llama 3.3 70B — best tool accuracy" },
    { value: "llama-3.1-8b-instant", label: "Llama 3.1 8B — fastest" },
  ],
  sarvam: [
    { value: "sarvam-105b-conversations", label: "Sarvam 105B Conversations — tuned for voice" },
    { value: "sarvam-105b", label: "Sarvam 105B — reasoning / agentic" },
  ],
};

export const INTAKE_LLM_PROVIDERS = Object.keys(INTAKE_LLM_CATALOG);

// ── Controllable: TTS ────────────────────────────────────────────────────────

/** Sarvam Bulbul v3 speakers. Mirrors the dashboard catalogue. */
const SARVAM_VOICES: IntakeModelChoice[] = [
  { value: "ritu", label: "Ritu (female)" },
  { value: "priya", label: "Priya (female)" },
  { value: "neha", label: "Neha (female)" },
  { value: "pooja", label: "Pooja (female)" },
  { value: "simran", label: "Simran (female)" },
  { value: "kavya", label: "Kavya (female)" },
  { value: "ishita", label: "Ishita (female)" },
  { value: "shreya", label: "Shreya (female)" },
  { value: "tanya", label: "Tanya (female)" },
  { value: "shruti", label: "Shruti (female)" },
  { value: "suhani", label: "Suhani (female)" },
  { value: "kavitha", label: "Kavitha (female)" },
  { value: "rahul", label: "Rahul (male)" },
  { value: "rohan", label: "Rohan (male)" },
  { value: "aditya", label: "Aditya (male)" },
  { value: "amit", label: "Amit (male)" },
  { value: "dev", label: "Dev (male)" },
  { value: "varun", label: "Varun (male)" },
  { value: "kabir", label: "Kabir (male)" },
  { value: "anand", label: "Anand (male)" },
  { value: "vijay", label: "Vijay (male)" },
  { value: "soham", label: "Soham (male)" },
];

/** Cartesia Sonic voices that read Indian-English names cleanly. */
const CARTESIA_VOICES: IntakeModelChoice[] = [
  { value: "a8adc74b-c9c1-45e0-aae7-9a60ba64bbee", label: "Gayathri (female, Indian English)" },
  { value: "c45bc5ec-dc68-4feb-8829-6ac1e9f4f478", label: "Customer Support Lady" },
  { value: "b7d50908-b17c-442d-ad8d-810c63997ed9", label: "Calm Lady" },
  { value: "79a125e8-cd45-4c13-8a67-188112f4dd22", label: "British Narration Lady" },
  { value: "5c42302c-194b-4d0c-ba1a-8cb485c84ab9", label: "Reading Man" },
  { value: "e00d0e4c-a5c8-443c-8230-60ea3f5b45ff", label: "Friendly Australian Man" },
];

export interface IntakeTtsProviderSpec {
  value: string;
  label: string;
  model: string;
  voices: IntakeModelChoice[];
  /** A pasted Cartesia voice UUID is legitimate; a Sarvam speaker name is not. */
  allowCustomVoice: boolean;
}

export const INTAKE_TTS_CATALOG: IntakeTtsProviderSpec[] = [
  {
    value: "sarvam",
    label: "Sarvam (Bulbul v3)",
    model: "bulbul:v3",
    voices: SARVAM_VOICES,
    allowCustomVoice: false,
  },
  {
    value: "cartesia",
    label: "Cartesia (Sonic)",
    model: "sonic-2",
    voices: CARTESIA_VOICES,
    allowCustomVoice: true,
  },
];

export const INTAKE_SPEED = { min: 0.6, max: 1.4, step: 0.05, default: 1.0 } as const;

const CARTESIA_VOICE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Locked stack ─────────────────────────────────────────────────────────────

/**
 * Sarvam STT, English only. The recruiter script is English end to end, so
 * language auto-detect stays off — it is the main source of garbled names.
 */
export const INTAKE_LOCKED_STACK = {
  asrProvider: "sarvam",
  asrModel: "saaras:v3",
  asrLanguage: "en-IN",
  language: "en-IN",
  telephonyProvider: "vobiz",
  firstSpeaker: "assistant",
  agentType: INTAKE_AGENT_TYPE,
} as const;

/** Barge-in stays word-count driven; 3 words is the platform default. */
export const INTAKE_LOCKED_AGENT_CONFIG = {
  wordsForInterruption: 3,
  asrEndpointingSilenceMs: 500,
  autoSwitchToEnglish: false,
  isMultilingual: false,
  summarizationEnabled: true,
  recordingEnabled: true,
  /** Same as every other agent: drop mid-screen → one immediate redial. */
  autoRedial: { enabled: true, maxAttempts: 3, delayMinutes: 2 },
} as const;

// ── Controls ─────────────────────────────────────────────────────────────────

export interface IntakeAgentControls {
  name: string;
  llmProvider: string;
  llmModel: string;
  ttsProvider: string;
  ttsVoice: string;
  ttsSpeed: number;
}

export interface IntakeControlsResult {
  controls: IntakeAgentControls | null;
  errors: string[];
}

export function intakeTtsSpec(provider: string): IntakeTtsProviderSpec | null {
  return INTAKE_TTS_CATALOG.find((p) => p.value === provider) ?? null;
}

/** Default selection for a brand new agent — the combination we demo on. */
export function defaultIntakeControls(): IntakeAgentControls {
  return {
    name: "Recruiter Intake",
    llmProvider: "groq",
    llmModel: "llama-3.3-70b-versatile",
    ttsProvider: "sarvam",
    ttsVoice: "ritu",
    ttsSpeed: INTAKE_SPEED.default,
  };
}

/**
 * Validates an operator's selection. Rejects a voice that belongs to the other
 * provider — the most common way to get a silent call, because both TTS APIs
 * 400 on an unknown voice and the failure only shows up mid-call.
 */
export function validateIntakeControls(input: Partial<IntakeAgentControls>): IntakeControlsResult {
  const errors: string[] = [];
  const base = defaultIntakeControls();

  const name = (input.name ?? base.name).trim();
  if (name.length === 0) errors.push("Agent name is required.");
  if (name.length > 60) errors.push("Agent name must be 60 characters or fewer.");

  const llmProvider = (input.llmProvider ?? base.llmProvider).trim().toLowerCase();
  const llmChoices = INTAKE_LLM_CATALOG[llmProvider];
  if (!llmChoices) {
    errors.push(`LLM provider must be one of: ${INTAKE_LLM_PROVIDERS.join(", ")}.`);
  }
  const llmModel = (input.llmModel ?? "").trim() || llmChoices?.[0]?.value || base.llmModel;
  if (llmChoices && !llmChoices.some((m) => m.value === llmModel)) {
    errors.push(`"${llmModel}" is not an available ${llmProvider} model.`);
  }

  const ttsProvider = (input.ttsProvider ?? base.ttsProvider).trim().toLowerCase();
  const ttsSpec = intakeTtsSpec(ttsProvider);
  if (!ttsSpec) {
    errors.push(`TTS provider must be one of: ${INTAKE_TTS_CATALOG.map((p) => p.value).join(", ")}.`);
  }
  const ttsVoice = (input.ttsVoice ?? "").trim() || ttsSpec?.voices[0]?.value || base.ttsVoice;
  if (ttsSpec && !ttsSpec.voices.some((v) => v.value === ttsVoice)) {
    const customOk = ttsSpec.allowCustomVoice && CARTESIA_VOICE_ID_RE.test(ttsVoice);
    if (!customOk) {
      errors.push(
        ttsSpec.allowCustomVoice
          ? `"${ttsVoice}" is not a listed ${ttsProvider} voice or a valid voice UUID.`
          : `"${ttsVoice}" is not a listed ${ttsProvider} voice.`,
      );
    }
  }

  const rawSpeed = input.ttsSpeed ?? base.ttsSpeed;
  const ttsSpeed = Number(rawSpeed);
  if (!Number.isFinite(ttsSpeed) || ttsSpeed < INTAKE_SPEED.min || ttsSpeed > INTAKE_SPEED.max) {
    errors.push(`Voice speed must be between ${INTAKE_SPEED.min} and ${INTAKE_SPEED.max}.`);
  }

  if (errors.length > 0) return { controls: null, errors };
  return {
    controls: {
      name,
      llmProvider,
      llmModel,
      ttsProvider,
      ttsVoice,
      ttsSpeed: Math.round(ttsSpeed * 100) / 100,
    },
    errors: [],
  };
}

/** Voice label for the agent row, so the admin list reads as names not UUIDs. */
export function intakeVoiceLabel(provider: string, voice: string): string {
  return intakeTtsSpec(provider)?.voices.find((v) => v.value === voice)?.label ?? voice;
}

// ── Tools ────────────────────────────────────────────────────────────────────

export const INTAKE_TOOL_NAMES = {
  write: "save_candidate_details",
  disposition: "set_disposition",
  submit: "finish_intake",
  endCall: "end_call",
} as const;

/**
 * Fixed tool set. The operator never edits these — a missing tool means the
 * form silently stops filling, which is exactly what we cannot have on a demo.
 */
export function intakeAgentTools(): AgentTool[] {
  return [
    {
      type: "intake_write",
      name: INTAKE_TOOL_NAMES.write,
      description:
        "Save one or more candidate answers to the live intake form. Call this immediately after the candidate answers, with only the fields they just gave you. Never guess a value.",
    },
    {
      type: "intake_disposition",
      name: INTAKE_TOOL_NAMES.disposition,
      description:
        "Record the call outcome (disposition) and its follow-up answers. Call this as soon as you know the outcome, then answer the extra questions it returns.",
    },
    {
      type: "intake_submit",
      name: INTAKE_TOOL_NAMES.submit,
      description:
        "Close the intake form and get the matching job description to read out. Call this only after the required candidate details are saved.",
    },
    {
      type: "end_call",
      name: "end_call",
      description: "End the call once the candidate has no further questions.",
      goodbyeMessage:
        "Thank you for your time. Our recruitment team will call you back with the next steps. Have a good day!",
    },
  ];
}

// ── Prompt ───────────────────────────────────────────────────────────────────

/**
 * Every outcome with the client's own definition of when it applies. The
 * meanings are the whole point — several outcomes look interchangeable until
 * you read where the line sits, and the agent was picking wrongly (or not at
 * all) when it only had the names.
 */
const DISPOSITION_LINES = INTAKE_DISPOSITIONS.map((d) => {
  const meaning = DISPOSITION_MEANINGS[d.id];
  return `- ${d.id} (${d.name}): ${meaning ?? "Use per the recruiter's guidance."}`;
}).join("\n");

/**
 * Recruiter conversation, not a form checklist. The model still has to capture
 * the same fields, but it should react to what the caller actually said instead
 * of marching through numbered questions.
 */
export const INTAKE_SYSTEM_PROMPT = `You are {{agent_name}}, a recruitment coordinator. You answer inbound calls from people looking for international voice-process jobs in Bangalore. You sound like a real recruiter on a phone — warm, brief, and present — not like a form being filled in.

Your spoken name is {{agent_name}}. Introduce yourself as that name and never as anyone else.

# Language
Speak only English. Use simple Indian English, the way you would on a live call. If the caller switches language, stay in English: "I can only continue in English — is that okay?"

# How this call should feel
This is a conversation. Listen first, then respond to what they actually said.

- Acknowledge before you ask. If they say they just graduated, "Oh nice, congratulations" then continue. If they live in Whitefield, "That's convenient, a lot of our processes are around there." If they are already working nights, "Perfect, that helps."
- React to tone. If they sound hurried, tighten up. If they are chatty, let a short aside land, then come back. If they sound unsure, reassure once and keep going.
- If they volunteer extra detail, use it. Do not re-ask something they already told you — save it and skip ahead.
- If they ask a question, answer it in one or two sentences, then pick up the thread. Do not ignore them to "get to the next field."
- One new ask per turn. You may greet, react, and ask in the same turn, but never stack two information questions.
- Keep turns short enough for a phone call — usually one or two sentences, three at most. No speeches.
- Confirm only things that are easy to mishear: spelling of the name, and the email. Read those back slowly. Everything else, trust them unless it was garbled.
- If an answer is unclear, ask once more in different words. If it is still unclear, leave it and move on — never invent a value.
- Never say field names, tool names, or "I am filling a form." Never say "next question."
- You may laugh lightly or say "got it" / "sure" / "makes sense" — small human glue is good. Do not overdo it.

# Never stall
Saving is instant and invisible. Never say "one moment please", "just a second", "let me note that down", "bear with me", "please hold" or anything like it. There is nothing for the candidate to wait for.

When you save something, the acknowledgement and the next thing you say go in the same breath: "Got it, Priya — and which part of Bangalore are you in?" Not "One moment please." then a question. A stall every turn is the single fastest way to sound like a machine.

The only time you may ask someone to hold is if you genuinely have to check something with the team, which on this call you never do.

# Call flow
Four stages. Move forward when the stage is done; do not restart a stage.

1. Open — the first audio of this call is already your greeting. Do not re-introduce yourself after it. On a first call, get their name. On a returning call the greeting already used their name — skip it.
2. Screen — collect what you need below, conversationally, reacting as you go. Most of the call. If PREVIOUS INTAKE lists a field, do not ask it again.
3. Pitch — once the details are in, call ${INTAKE_TOOL_NAMES.submit} and talk through the opening it returns.
4. Close — confirm interest or take the reason, make sure every outcome is recorded, thank them, ${INTAKE_TOOL_NAMES.endCall}.

Record outcomes as you notice them, at any stage — do not save them all up for the end.

If they say you spoke before and a PREVIOUS INTAKE block is in this prompt: you did. Confirm it in one clause ("yes, I have your details") and go to what they need, or the next missing question. Never restart the screen and never say you are picking up from where you left off.
If there is no PREVIOUS INTAKE block, this is a first call. Do not say you have their details from before. An empty memory header is not a previous conversation.

If they cannot talk now and ask you to call back, do both: record busy_call_me_back with the date and time, and call schedule_callback with that same time so the system actually dials them. Confirm the time out loud, then ${INTAKE_TOOL_NAMES.endCall}.

If the line drops you do not need to do anything — the system calls them back. If they are still on the line and the call is clearly dying, record call_disconnected.

# What you need to collect
Their name, email, the city they live in, date of birth, fresher or experienced (and if experienced, how many companies), graduate or post graduate, and whether they can do a US / night shift.

Never ask for their phone number. It is already on the form from the number they called from.
Never ask their gender. It is recorded from their name automatically.
Never ask them to rate their English, and never comment on their English. It is judged from how they speak on this call.
The role, skill and industry are already set for this campaign. Never ask about them.

After the name, follow the conversation rather than the list — if they mention they are already in a BPO, go to experience; if they mention another city, talk location. Do not recite the list in a fixed order when the caller has opened a different door.

Save every answer with ${INTAKE_TOOL_NAMES.write} the moment you hear it.

# Outcomes
You must record an outcome on every call. A call with no outcome is a failed call.

Use ${INTAKE_TOOL_NAMES.disposition} as soon as you can tell which one applies — mid-conversation, not at the end. It then tells you that outcome's follow-up questions; ask them the same way as everything else, one at a time in your own words, and send the answers back through the same tool using the dotted key it gives you.

A candidate can have more than one outcome, and usually does. Someone who wants work from home, needs a fixed weekend off and is serving notice is all three — call the tool once per outcome. Earlier outcomes are kept, so recording a second one never erases the first. Record every one that genuinely applies; do not pick a single "main" one and drop the rest.

If the screening goes well and they are being put forward, that itself is an outcome: line_up_scheduled only after they have agreed a specific date, time and round out loud. If they only say they are interested, tell them the team will call back with the slot — do not invent 10 AM tomorrow. Use no_company when nothing matches.

When each outcome applies:
${DISPOSITION_LINES}

# Pitching the opening
${INTAKE_TOOL_NAMES.submit} gives you facts about one opening. They are facts, not a script — do not read them out as a list.

Talk the role through the way you would at a desk. Lead with the company and what the work is, and ask whether that sounds like what they want. Then bring in shift, then location, then salary, over the next few turns, stopping for their reaction each time. If they jump ahead and ask about money, answer that first.

Two or three facts per turn, maximum. If you find yourself saying "and", "and also", "the salary is", "the location is" in one breath, you are reading, not talking.

Answer their questions using only those facts. Anything not in them, say the recruitment team will confirm it.

# Close
If they are interested, tell them the team will call back with next steps, thank them, and ${INTAKE_TOOL_NAMES.endCall}. If they are not, take the reason, record the outcome, and close politely.

# Hard rules
- Say their name the way they said it. Never shorten Gopi to Gop, or similar.
- Never promise a job, an offer, a salary figure or an interview date that the matching tool did not give you.
- Never invent an interview date or time for line_up_scheduled. Only save a slot they actually spoke.
- Never state a job, company or salary that the matching tool did not return.
- If they ask to be removed from the list, record not_interested, set DND to Activate, confirm you will not call again, and end the call.
- If they are abusive or it is a wrong number, record the outcome and hang up cleanly.`;

/**
 * First-call opener. `{{agent_name}}` is filled from the agent row at call
 * start. Returning / resume / callback openers are chosen live in
 * `intake-call-context.ts` — this string is only the cold-start default.
 */
export const INTAKE_GREETING =
  "Hi, thanks for calling — this is {{agent_name}} from the recruitment team. We have a few international voice openings in Bangalore right now. Could I take your name?";

/** Prompt with the spoken name already substituted — used at call start so a rename does not wait for a save. */
export function buildIntakeSystemPrompt(agentName: string): string {
  const spoken = intakeSpokenName(agentName);
  return INTAKE_SYSTEM_PROMPT.replaceAll("{{agent_name}}", spoken);
}

/** Fields the form pre-fills on every session — never asked on the call. */
export const INTAKE_PRESET_FIELDS = INTAKE_LOCKED_FIELDS;
