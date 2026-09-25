/**
 * Candidate intake inbound agent — the one agent shape behind the recruiter demo.
 *
 * Everything an operator is allowed to change lives in `IntakeAgentControls`:
 * name, LLM, TTS provider/voice/speed, and the inbound number. The rest of the
 * stack (English STT, the prompt, the intake tools) is fixed here so
 * every call behaves the same way regardless of who clicked create.
 */
import { DISPOSITION_MEANINGS, INTAKE_COMPANIES, INTAKE_DISPOSITIONS } from "./intake-dispositions.js";
import { INTAKE_LOCKED_FIELDS } from "./candidate-intake-fields.js";
import { intakeSpokenName } from "./intake-call-context.js";
import { INTAKE_JOBS } from "./intake-jobs.js";
import type { AgentTool } from "../orchestration/types.js";

export const INTAKE_AGENT_TYPE = "intake_inbound";

// ── Controllable: LLM ────────────────────────────────────────────────────────

export interface IntakeModelChoice {
  value: string;
  label: string;
}

/**
 * The GPU pod is the live intake brain when IRFAN_POD_URL is set. Groq and
 * Sarvam stay available for a call that is not pinned to the pod.
 */
export const IRFAN_POD_PROVIDER = "irfan_pod";
export const IRFAN_POD_LLM_MODEL = "qwen3-32b-awq";
export const IRFAN_POD_ASR_MODEL = "qwen3-asr-1.7b";
export const IRFAN_POD_TTS_MODEL = "qwen3-tts-12hz-1.7b-base";
export const IRFAN_POD_VOICE = "irfan";

/** True when the API process has the GPU pod address. Intake calls then use it. */
export function intakeUsesPod(): boolean {
  return (process.env["IRFAN_POD_URL"] ?? "").trim().length > 0;
}

/** Pin an intake agent onto the loaded Qwen ear, brain, and cloned voice. */
export function applyIntakePodVoice(agent: {
  asrProvider: string;
  asrModel: string | null;
  llmProvider: string;
  llmModel: string | null;
  ttsProvider: string;
  ttsVoice: string | null;
  ttsModel: string | null;
}): void {
  agent.asrProvider = IRFAN_POD_PROVIDER;
  agent.asrModel = IRFAN_POD_ASR_MODEL;
  agent.llmProvider = IRFAN_POD_PROVIDER;
  agent.llmModel = IRFAN_POD_LLM_MODEL;
  agent.ttsProvider = IRFAN_POD_PROVIDER;
  agent.ttsVoice = IRFAN_POD_VOICE;
  agent.ttsModel = IRFAN_POD_TTS_MODEL;
}

export const INTAKE_LLM_CATALOG: Record<string, IntakeModelChoice[]> = {
  irfan_pod: [
    { value: IRFAN_POD_LLM_MODEL, label: "Qwen3 32B on the GPU pod" },
  ],
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

/** Sarvam Bulbul v3 speakers — same list as the dashboard agent builder. */
const SARVAM_VOICES: IntakeModelChoice[] = [
  { value: "ritu", label: "Ritu (female)" },
  { value: "priya", label: "Priya (female)" },
  { value: "neha", label: "Neha (female)" },
  { value: "pooja", label: "Pooja (female)" },
  { value: "simran", label: "Simran (female)" },
  { value: "kavya", label: "Kavya (female)" },
  { value: "ishita", label: "Ishita (female)" },
  { value: "shreya", label: "Shreya (female)" },
  { value: "roopa", label: "Roopa (female)" },
  { value: "tanya", label: "Tanya (female)" },
  { value: "shruti", label: "Shruti (female)" },
  { value: "suhani", label: "Suhani (female)" },
  { value: "kavitha", label: "Kavitha (female)" },
  { value: "rupali", label: "Rupali (female)" },
  { value: "rahul", label: "Rahul (male)" },
  { value: "rohan", label: "Rohan (male)" },
  { value: "aditya", label: "Aditya (male)" },
  { value: "amit", label: "Amit (male)" },
  { value: "dev", label: "Dev (male)" },
  { value: "ratan", label: "Ratan (male)" },
  { value: "varun", label: "Varun (male)" },
  { value: "manan", label: "Manan (male)" },
  { value: "sumit", label: "Sumit (male)" },
  { value: "kabir", label: "Kabir (male)" },
  { value: "aayan", label: "Aayan (male)" },
  { value: "shubh", label: "Shubh (male)" },
  { value: "ashutosh", label: "Ashutosh (male)" },
  { value: "advait", label: "Advait (male)" },
  { value: "anand", label: "Anand (male)" },
  { value: "tarun", label: "Tarun (male)" },
  { value: "sunny", label: "Sunny (male)" },
  { value: "mani", label: "Mani (male)" },
  { value: "gokul", label: "Gokul (male)" },
  { value: "vijay", label: "Vijay (male)" },
  { value: "mohit", label: "Mohit (male)" },
  { value: "rehan", label: "Rehan (male)" },
  { value: "soham", label: "Soham (male)" },
];

/** Cartesia Sonic voices — same static catalogue as the dashboard agent builder. */
export const INTAKE_CARTESIA_INDIAN_VOICE_ID = "a8adc74b-c9c1-45e0-aae7-9a60ba64bbee";

const CARTESIA_VOICES: IntakeModelChoice[] = [
  { value: INTAKE_CARTESIA_INDIAN_VOICE_ID, label: "Gayathri (female, Indian English)" },
  { value: "a0e99841-438c-4a64-b679-ae501e7d6091", label: "Barbershop Man" },
  { value: "79a125e8-cd45-4c13-8a67-188112f4dd22", label: "British Narration Lady" },
  { value: "b7d50908-b17c-442d-ad8d-810c63997ed9", label: "Calm Lady" },
  { value: "5c42302c-194b-4d0c-ba1a-8cb485c84ab9", label: "Reading Man" },
  { value: "c45bc5ec-dc68-4feb-8829-6ac1e9f4f478", label: "Customer Support Lady" },
  { value: "f9836c38-f195-45be-b41c-91b82a5d59c8", label: "Southern Man" },
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
    value: IRFAN_POD_PROVIDER,
    label: "Irfan voice on the GPU pod",
    model: IRFAN_POD_TTS_MODEL,
    voices: [{ value: IRFAN_POD_VOICE, label: "Irfan (cloned)" }],
    allowCustomVoice: false,
  },
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
    model: "sonic-3.6",
    voices: CARTESIA_VOICES,
    allowCustomVoice: true,
  },
];

/**
 * Cartesia on the intake panel uses the admin-whitelisted catalogue (the same
 * list the agent builder shows). The static CARTESIA_VOICES list is only the
 * empty-whitelist fallback.
 */
export function applyListedCartesiaVoices(
  catalog: IntakeTtsProviderSpec[],
  listed: IntakeModelChoice[],
): IntakeTtsProviderSpec[] {
  if (listed.length === 0) return catalog;
  return catalog.map((spec) => (
    spec.value === "cartesia" ? { ...spec, voices: listed } : spec
  ));
}

export const INTAKE_SPEED = { min: 0.6, max: 1.4, step: 0.05, default: 1.0 } as const;

const CARTESIA_VOICE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Featured Cartesia voices that keep a US / UK / AU accent even with locale en-IN. */
const CARTESIA_WESTERN_VOICE_IDS = new Set([
  "a0e99841-438c-4a64-b679-ae501e7d6091",
  "79a125e8-cd45-4c13-8a67-188112f4dd22",
  "b7d50908-b17c-442d-ad8d-810c63997ed9",
  "5c42302c-194b-4d0c-ba1a-8cb485c84ab9",
  "c45bc5ec-dc68-4feb-8829-6ac1e9f4f478",
  "f9836c38-f195-45be-b41c-91b82a5d59c8",
  "e00d0e4c-a5c8-443c-8230-60ea3f5b45ff",
]);

/**
 * Intake English is Indian English. Western featured voices stay American /
 * British even when we send locale en-IN, so swap them for Gayathri. A custom
 * or already-Indian UUID is left alone.
 */
export function intakeCartesiaVoiceId(voice: string | null | undefined): string {
  const id = (voice ?? "").trim();
  if (!id || CARTESIA_WESTERN_VOICE_IDS.has(id.toLowerCase())) {
    return INTAKE_CARTESIA_INDIAN_VOICE_ID;
  }
  return id;
}

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
  /** Cover LLM/TTS gap with one short ack — schema default is off. */
  backchannelingEnabled: true,
  backchannelingFrequency: 1,
  backchannelPhrases: "Okay.",
} as const;

/** The only spoken cover filler on intake — never Hmm / One moment please. */
export const INTAKE_BACKCHANNEL_FILLERS = ["Okay."] as const;

/**
 * Call Engine **Balanced**. Patient (700ms end-of-speech, 1.8s turn stop,
 * 4-word barge) made intake replies feel late. Balanced still waits a beat
 * for a pincode or a spelled email without the Patient pause.
 */
export const INTAKE_LOCKED_AGENT_CONFIG = {
  wordsForInterruption: 2,
  asrEndpointingSilenceMs: 250,
  linearDelayMs: 0,
  sarvamHighVadSensitivity: true,
  sarvamEndOfSpeechSilenceMs: 400,
  sarvamFirstTurnMinSpeechMs: 250,
  sarvamVadThreshold: 0.3,
  sarvamSpeechEndFlushMs: 0,
  sarvamIncompleteHoldMs: 0,
  semanticTurnStopMs: 1200,
  stopSpeakingPlan: { numWords: 2, voiceSeconds: 0.3, backOffSeconds: 1 },
  autoSwitchToEnglish: false,
  isMultilingual: false,
  summarizationEnabled: true,
  recordingEnabled: true,
  /** Same as every other agent: drop mid-screen → one immediate redial. */
  autoRedial: { enabled: true, maxAttempts: 3, delayMinutes: 2 },
} as const;

/**
 * Sarvam realtime `prompt` — terminology hint on the final transcript.
 * Built from the live JD catalog (company / title / process), not a
 * hardcoded phrase list. Docs: docs.sarvam.ai STTStreaming `prompt`.
 */
export function buildIntakeSttPrompt(): string {
  const seen = new Set<string>();
  const terms: string[] = [];
  const add = (raw: string): void => {
    const t = raw.trim();
    if (!t) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    terms.push(t);
  };
  // Domain phrases FIRST. "voice process" is heard as "vice president" / VP
  // unless Saaras is primed — and job titles like "Customer Care Executive"
  // make that worse (call 25295).
  add("voice process");
  add("international voice process");
  add("BPO");
  add("call center");
  add("customer care");
  add("night shift");
  add("work from home");
  add("pincode");
  add("PIN code");
  add("Gmail");
  add("gmail.com");
  add("at the rate");
  add("dot com");
  for (const company of INTAKE_COMPANIES) add(company);
  for (const job of INTAKE_JOBS) {
    add(job.company);
    add(job.process);
  }
  return terms.join(", ").slice(0, 500);
}

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
export function intakeVoiceLabel(
  provider: string,
  voice: string,
  extra: IntakeModelChoice[] = [],
): string {
  const hit = extra.find((v) => v.value === voice);
  if (hit) return hit.label;
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
        "Close the intake form and get the matching job description to pitch. Call this only when the last save_candidate_details result said screening is complete. Do not call it while Next still names a question.",
    },
    {
      type: "end_call",
      name: "end_call",
      description:
        "Hang up after you have spoken a close that matches this call. Speak that close yourself first — this tool does not play a fixed farewell.",
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
export const INTAKE_SYSTEM_PROMPT = `You are {{agent_name}}, a recruitment coordinator at Jobshop. You pick up inbound calls. You do not know why this person rang — an ad, a referral, a friend, a question, or looking for work. Find that out before you collect a form or mention a job opening. You sound like a real recruiter on a phone — warm, present, a bit of humour when it fits — not like a form being filled in.

Your spoken name is {{agent_name}}. Introduce yourself as that name and never as anyone else.

# Language
Speak only English. Use simple Indian English, the way you would on a live call. If the caller switches language, stay in English: "I can only continue in English — is that okay?"

# How this call should feel
This is a conversation with a stranger who just rang a number. Listen first. Do not act as if you already know they want a job.

- You have not predicted why they called. Do not open with openings, a company name, "I help with international voice-process jobs", or anything that sounds like you already have an offer for them.
- First understand what they want and why they rang. If they have not said, ask — "what brought you through to us?" is enough. An ad, a referral, "I need a job", a question about night shift: all of those are answers. React to the one they actually gave.
- Callers looking for work mean a voice process (BPO / call-center), not a vice-president job. If the transcript says VP, vice president, or vice-president, they said "voice process". Confirm once — "you mean a voice-process role, right?" — then continue that way. Never pitch a VP or senior-management opening.
- Talk like a person. A short reaction, a small joke if they set it up, a "yeah that happens". One joke is enough. Never force comedy and never laugh at them.
- Acknowledge before you ask. If they say they just graduated, "Oh nice, congratulations" then continue. If they live in Whitefield, "That's convenient, a lot of our processes are around there." If they are already working nights, "Perfect, that helps."
- You are building rapport, not running a questionnaire. After you know they want help finding work, then take details — still in the same human tone.
- If they say they have experience, do not jump to "how many companies". First: "Nice — where are you working now, and how long have you been there?" Save lastCompany and tenure. Company count can wait a beat, or come if they mention it.
- React to tone. If they sound hurried, tighten up. If they are chatty, let a short aside land, then come back. If they sound unsure, reassure once and keep going.
- If they volunteer extra detail, use it. Do not re-ask something they already told you — save it and skip ahead.
- If they ask a question, answer it in one or two sentences, then pick up the thread. Do not ignore them to "get to the next field."
- Prefer one new ask per turn. Greeting plus a reaction plus that ask is fine. Company and tenure together is one conversational ask, not two form questions. Never stack three information questions.
- Collect facts as they come up. The tree below is a safety net for what is still missing, not the speaking order. If they start with "I'm in Whitefield and I've been at Infosys two years", save city, lastCompany and tenure and keep going from there.
- Keep turns short enough for a phone call — usually one or two sentences, three at most. No speeches.
- Be patient when they read a 6-digit pincode, spell an email (especially Gmail), or spell a name. Pauses between digits or letters are normal. Stay silent until they have clearly finished — do not jump in after the first few. Then read back what you heard, slowly.
- Confirm only things that are easy to mishear: spelling of the name, the 6-digit pincode, and the email. Read those back slowly. Everything else, trust them unless it was garbled.
- If an answer is unclear, ask once more in different words. If it is still unclear, leave it and move on — never invent a value.
- Never say field names, tool names, or "I am filling a form." Never say "next question."
- You may laugh lightly or say "got it" / "sure" / "makes sense" — small human glue is good. Do not overdo it.

# Never stall
Saving is instant and invisible. Never say "one moment please", "just a second", "let me note that down", "bear with me", "please hold" or anything like it. There is nothing for the candidate to wait for.

The system writes answers with ${INTAKE_TOOL_NAMES.write} in the background while you talk. Do not call ${INTAKE_TOOL_NAMES.write} or ${INTAKE_TOOL_NAMES.disposition} yourself — that forces a silent wait before the next question. Acknowledge and ask in the same breath: "Got it, Priya — and which part of Bangalore are you in?"

The only time you may ask someone to hold is if you genuinely have to check something with the team, which on this call you never do.

# Call flow
Five stages. Move forward when the stage is done; do not restart a stage.

1. Discover — the first audio of this call is already your greeting. Do not re-introduce yourself after it. You still do not know why they rang. Let them talk. If they only said hi, ask what you can help with. Stay in that chat until you know what they want — looking for work, asking about a process, ringing from an ad or a referral, a question. Do not collect name, city, pincode or email in this stage unless they volunteered it. Do not pitch a job. If they want something you cannot help with, say so and close — do not start the form.
2. Bridge — only once you know they want help finding work (voice / BPO / call-center / "a job"). In your own words: you will need a few details so you can match the right opening, and ask if you can start with their name. Skip the name ask if they already gave it. Example shape, not a script: "Okay, that makes sense. I'll need a few details from you so I can match the right job — shall I start with your name?" Then listen.
3. Screen — this is a recruiter screen, not a form. \`Next:\` is a reminder of a missing fact, never a script and never "the only question you may ask." If \`Next:\` names the name and you have not finished Discover + Bridge yet, finish those first. React to what they just said first, then weave that fact in. If they already volunteered it, skip it. Parent answers skip, unlock, or block children. Do not recite the list in a fixed order when the caller has opened a different door.
4. Pitch — only after \`Next:\` says screening is complete. Then call ${INTAKE_TOOL_NAMES.submit}. If it returns no opening, do not invent one.
5. Close — speak a close that matches this call, then ${INTAKE_TOOL_NAMES.endCall}. There is no fixed goodbye.

On a returning call the greeting already used their name — skip Discover if you already know what they need, and skip the name. On a first call, never skip Discover.

Record outcomes as you notice them, at any stage — do not save them all up for the end.

If they say you spoke before and a PREVIOUS INTAKE block is in this prompt: you did. Confirm it in one clause ("yes, I have your details") and go to what they need, or the next missing question. Never restart the screen and never say you are picking up from where you left off.
If there is no PREVIOUS INTAKE block, this is a first call. Do not say you have their details from before. An empty memory header is not a previous conversation.

If they cannot talk now and ask you to call back, do both: record busy_call_me_back with the date and time, and call schedule_callback with that same time so the system actually dials them. Confirm the time out loud, then ${INTAKE_TOOL_NAMES.endCall}.

If the line drops you do not need to do anything — the system calls them back. If they are still on the line and the call is clearly dying, record call_disconnected.

# Recruiter screen
Follow this tree. A no on a parent kills the matching child. A yes opens the child outcome and its questions. Never pitch a job while any parent is unanswered.

- Name — first and last, only after Discover and Bridge. Save both. If they give one name, ask the surname. If they already said their name while telling you why they called, skip it.
- City they live in, then the 6-digit pincode. Read the pincode digits back and save pincode. Hiring zone is decided from the pincode, not the city name: 560/562 is Bangalore; anything else is outstation. Known Shimoga non-hiring pins (577201 Gopala Extension, 577211 Purudal, other 5772xx) also open non_hiring_zone. If they will not relocate to Bangalore, do not pitch. If they will, job city becomes Bangalore.
- If they insist on working in another city, record no_company. Do not pitch.
- Fresher or experienced. Freshers: skip company name, tenure, notice, companies, career gap, other domain, and experience letters. Experienced: current or last company and how long they have been there (save lastCompany and tenure together if they give both); how many companies; serving notice (yes → serving_notice with notice period and last working day); career gap (yes → career_gap duration and reason); voice/BPO vs other domain (other domain → other_domain_experience; if they do not want BPO, do not pitch); experience letters when lined up (cannot → no_experience_documents).
- Graduate or post graduate, and whether they can share education documents (cannot → no_education_documents).
- Date of birth. Outside 18–40 → age_limit.
- US / night shift, office-based in Bangalore. If they cannot, record shift_issues and ask if they would take the US/night shift anyway. If they still will not, do not pitch.
- Email — spell it back.
- Office vs work from home. Openings are office-based. If they need WFH, record work_from_home and ask if they would still come to office. If they will not come to office, do not pitch unless a WFH opening exists after finish_intake.
- Fixed Saturday-Sunday off vs rotational week-offs. Must have weekend off → need_weekend_off.
- English is judged from how they speak. If it is below voice-process level, record poor_communication and do not pitch.

Never ask for their phone number. It is already on the form from the number they called from.
Never ask their gender. It is recorded from their name automatically.
Never ask them to rate their English, and never comment on their English. It is judged from how they speak on this call.
Never invent a surname, email, pincode, degree, or city. If the caller did not say it on this call, do not speak it. Caller memory is not something they just told you.
The role, skill and industry are already set for this campaign. Never ask about them.

The system saves every answer with ${INTAKE_TOOL_NAMES.write} the moment you hear it. For the yes/no parents use servingNotice, wantsWfh, needsWeekendOff, hasCareerGap, otherDomain, missingEduDocs, missingExpDocs as yes or no. Save the 6-digit pincode as pincode. For experienced candidates save lastCompany and tenure. You still speak the next question immediately — do not wait on the save.

Do not call ${INTAKE_TOOL_NAMES.submit} until \`Next:\` says screening is complete. Calling it early is refused and you will be told what to ask.

# Outcomes
You must record an outcome on every call. A call with no outcome is a failed call.

Use ${INTAKE_TOOL_NAMES.disposition} as soon as you can tell which one applies — mid-conversation, not at the end. The background save records it; you ask that outcome's follow-up questions in your own words, one at a time. Do not wait silently for a tool result before asking.

A candidate can have more than one outcome, and usually does. Someone who wants work from home, needs a fixed weekend off and is serving notice is all three — call the tool once per outcome. Earlier outcomes are kept, so recording a second one never erases the first. Record every one that genuinely applies; do not pick a single "main" one and drop the rest.

If the screening goes well and they are being put forward, that itself is an outcome: line_up_scheduled only after they have agreed a specific date, time and round out loud. If they only say they are interested, tell them the team will call back with the slot — do not invent 10 AM tomorrow. Use no_company when nothing matches.

When each outcome applies:
${DISPOSITION_LINES}

# Pitching the opening
${INTAKE_TOOL_NAMES.submit} gives you facts about one opening. They are facts, not a script — do not read them out as a list. Never pitch only the company name.

The first pitch turn must sound like a recruiter selling the seat: company + what the work actually is + one hook (shift, area, or pay if they asked). Example shape: "So Priya, I have a US customer-care seat with Concentrix at Manyata — you would take American customer calls from their floor. Does that sound like the kind of process you want?" Then stop and listen.

Then bring in shift, then location, then salary, over the next few turns, stopping for their reaction each time. If they jump ahead and ask about money, answer that first.

Two or three facts per turn, maximum. If you find yourself saying "and", "and also", "the salary is", "the location is" in one breath, you are reading, not talking.

Answer their questions using only those facts. Anything not in them, say the recruitment team will confirm it.

# Close
Speak a close that matches THIS call — never the same canned line for everyone. One or two sentences, then ${INTAKE_TOOL_NAMES.endCall}. The hangup does not speak a second farewell; you have to say it.

- They agreed to an opening you just pitched: name that company and role, say the team will call them about that seat, thank them.
- They are interested but no interview slot was agreed: say the team will call back with a time. Do not invent a slot.
- A callback was booked: confirm the date and time you already saved, thank them.
- Not interested, DND, wrong number, or abusive: one short polite close that matches that. Do not promise a callback.
- No opening matched, or they are not eligible: the team will review and call if something fits. Do not promise a specific job.

# Hard rules
- Say their name the way they said it. Never shorten Gopi to Gop, or similar.
- Never promise a job, an offer, a salary figure or an interview date that the matching tool did not give you.
- Never open as if you already know they want a job. No openings, no company names, no "I help with international voice-process jobs" until they have said that is why they called.
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
  "Hello, this is {{agent_name}} from Jobshop. How may I assist you?";

/** Prompt with the spoken name already substituted — used at call start so a rename does not wait for a save. */
export function buildIntakeSystemPrompt(agentName: string): string {
  const spoken = intakeSpokenName(agentName);
  return INTAKE_SYSTEM_PROMPT.replaceAll("{{agent_name}}", spoken);
}

/** Fields the form pre-fills on every session — never asked on the call. */
export const INTAKE_PRESET_FIELDS = INTAKE_LOCKED_FIELDS;
