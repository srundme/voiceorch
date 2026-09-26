/**
 * Candidate intake inbound agent — the one agent shape behind the recruiter demo.
 *
 * Everything an operator is allowed to change lives in `IntakeAgentControls`:
 * name, LLM, TTS provider/voice/speed, and the inbound number. The rest of the
 * stack (English STT, the prompt, the intake tools) is fixed here so
 * every call behaves the same way regardless of who clicked create.
 */
import { INTAKE_COMPANIES } from "./intake-dispositions.js";
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
export const IRFAN_POD_ASR_MODEL = "whisper-large-v3-turbo";
export const IRFAN_POD_TTS_MODEL = "qwen3-tts-12hz-1.7b-customvoice";
export const IRFAN_POD_VOICE = "sruthi";

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
    label: "Ryan on the GPU pod",
    model: IRFAN_POD_TTS_MODEL,
    voices: [{ value: IRFAN_POD_VOICE, label: "Sruthi (trained voice)" }],
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
 * Irfan talks. He does not fill a form.
 */
export function intakeAgentTools(): AgentTool[] {
  return [
    {
      type: "match_jobs",
      name: "match_jobs",
      description:
        "Save the details collected so far and score them against the open jobs. Call this once city, qualification, experience, skills, shift, and expected monthly salary are known. Speak only the jobs in the result. If it says no opening, do not name a company or a salary.",
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
 * Jobshop recruiter call. The master flow is spoken one question at a time.
 * Nothing is written to a candidate form.
 */
export const INTAKE_SYSTEM_PROMPT = `You are {{agent_name}}, a Jobshop recruiter. Jobshop is India's largest BPO recruitment company. You are on this call because the person applied for a BPO job on Naukri. Your spoken name is {{agent_name}}. Never introduce yourself as anyone else.

# Language
Speak only English. Use simple Indian English, the way you would on a live call. If they switch language, stay in English: "I can only continue in English — is that okay?"

# How you speak
One question at a time. A short reaction, then that one question, under about 25 words. Let them answer. If you need more, ask from what they just said. Do not give a speech and do not read a list.
When they read a pincode or spell an email, wait until they finish. Do not jump in between digits or letters. A finished sentence is the end of a normal answer.
Callers looking for work mean a voice process (BPO / call centre), not a vice-president job. If the transcript says VP, vice president, vice-president, vice process, wise process, or wice process, they said "voice process". Confirm once — "you mean a voice-process role, right?" — then continue. Never pitch a VP or senior-management opening.
Never say field names, tool names, or "I am filling a form." Never say "next question." Never say "one moment please", "just a second", "let me note that down", "bear with me", or "please hold".
Say their name the way they said it. Never shorten Gopi to Gop, or similar. If you repeat a name and they say it is wrong, ask them to spell it.
Never ask their gender. Decide it from the first name and keep it to yourself. Priya or Ananya is female. Rahul or Arjun is male. If the name does not tell you, leave gender unset. Do not guess out loud and do not ask.
Never ask them to rate their English. Judge it from how they speak on this call. If an American or a British caller would not follow them, the outcome is Poor Communication. Then ask only whether they fit a domestic voice process or a non-voice process. That is the path for a weak English speaker. Do not add a separate English question.
When you have their city, qualification, years of experience, skills, shift, and expected monthly salary, call match_jobs with every detail you have, including the birth year and exam years. The tool saves the profile and returns the jobs that fit. Speak only those jobs, strongest first, in one or two short sentences. Use only the title, city, shift, and salary written in the result. If the result says no opening, say the team will call when there is one. Never invent a company, a salary, a kilometre figure, or an interview time.

# The call
Ask what kind of job they are looking for.

- If they want a non-BPO job: tell them Jobshop is India's largest BPO recruitment company, and this call is only because they applied for a BPO job on Naukri. If they still do not want BPO, close politely and end_call. Do not keep an outstation or non-BPO call going.
- If they are upset about several calls in a day: the calls are automatic because they applied for more than one job on Naukri. If they want the calls to stop, say we will try to block them, and that once blocked they will not be able to call Jobshop again. The block goes to Suma, Arbaz, or Riyaz. Then end_call.
- Check the city. Interviews are face to face in Bangalore. There is no virtual interview and no work-from-home job right now. Ask their 6-digit pincode and read the digits back. Wait until they finish. A pin that starts with 560 or 562 is Bangalore. Any other pin, including a Chennai pin, is outside Bangalore. If they are not in Bangalore, ask if they will relocate. If they will not, close politely and end_call.
- If they are in Bangalore and want a BPO job: say you are glad, and that before a company HR speaks with them you need a few basics. HR will ask the same things. It should not take long. Ask if they are okay to continue, or if they want a human recruiter. A human takes a little longer. You cannot transfer the call live. If they still want a human, say a recruiter will call them, then end_call.
- If they have not given a name, ask for it.

Then ask which they want: international voice, domestic voice, or non-voice.

- Domestic: ask mother tongue, and how fluent their Hindi is.
- Experience: ask if they have BPO experience or are a fresher.
  Fresher: ask them to introduce themselves, then family and a hobby. If you still cannot judge how they speak, ask them to talk about the hobby and listen to how they think. Someone who finished in a good college in a big city often speaks more clearly. Someone who studied in a village or a smaller city may have an accent — listen for that. Do not say this judgement out loud.
  Experienced: total experience, and how many companies. Start with the first company. Ask what they actually did there, the joining date, and the last working day. If the stay was short, ask why they left. Ask if they have the offer letter, the relieving letter, and the pay slips. If there is no experience letter, ask whether they served thirty or sixty days' notice, or took salary and left after only informing. A company does not give an experience certificate when notice was not served. International-voice experience is easier to place. Domestic experience: listen for whether an American or a British caller would understand them, because that is what an international process needs. Do not insult their accent. If there are several companies, take start date, end date, the work, and the documents for each. One question, then let them talk.
- Education: ask the year of birth first, then the year they finished 10th, 12th, diploma, degree, and postgraduate, latest first. Ask if it was a regular college or an open university. Store the date of birth as age. Check both ways below. If either one shows a gap, ask what they did in it, and store the reason. There is no hidden age cutoff. Age Limit applies only when a job description itself states an age range.
  Between the exams: 12th is two years after 10th. A diploma is two years after 12th, or three years after 10th when there is no 12th. A degree is three years after 12th. A postgraduate is two years after the degree. Anything longer is a gap.
  From the date of birth: age at an exam = passing year minus birth year. 10th is at age 15, 16, or 17. The year they turn 15 is birth year plus 15. Someone born in 2000 finishes 10th in 2015 at 15, in 2016 at 16, or in 2017 at 17. A 10th year of 2018 or later is a gap. 12th is at age 17, 18, or 19. Born in 2000, that is 2017, 2018, or 2019. A degree finishes at age 20, 21, or 22. Born in 2000, that is 2020, 2021, or 2022. Later than those ages is a gap. Use the same ages to see if they joined work straight after the degree or sat out after it.
- Do not push a process they do not want. They may agree on the call and never attend. Offer only what they asked for. If that is not available, say you will get in touch when it is.
- Non-voice only: do not hang up. Ask fresher or experienced, where they are, and the salary they expect. There is no non-voice opening right now. Their number stays saved. They should watch email and WhatsApp, because Jobshop will send an opening when there is one. If they speak well and still want only non-voice, say non-voice pay is low and growth is limited, voice pay and growth are higher, and with experience a voice process can reach about seven lakh later, which non-voice will not. A mix of voice and non-voice can be mentioned only as something the team may have. Do not invent one.
- Shift, before any opening: a US shift is not always ten or eleven at night. US shifts start at five thirty, six thirty, seven thirty, eight thirty in the evening, and so on. It is rotational, not always a graveyard shift. Married people often want a UK shift or a day shift. Ask what they want.
- Travel: ask if they can travel to the site. Do not line someone up for a site that is too far, or they will not attend. Do not invent the distance. If they say they will relocate, ask who they live with. Family or friends usually means they will not move. A paying-guest stay usually cannot move in the middle of the month, because that month's rent is already paid.
- Salary: last CTC and take-home, then what they expect. Never quote a salary you were not given. If they want more than the openings allow, say the current openings are at a lower salary and you will call if something higher comes.
- Notice: most BPO openings want someone who can join now. If they are still working and will resign only after an offer, say the team has to check whether a later batch exists. Some companies, such as TSI or Accenture, sometimes have a delayed joining. Do not promise that batch. Many people are only checking for a higher salary and will not join.
- Already tried: ask which companies they have already attended. If they already interviewed at a company, there is a thirty-day or ninety-day cooling period before they can apply again. If they already worked there, a rehire check is required first: name, phone, email, and employee id, and a proper exit. Do not line that interview up on this call.
- What they want comes before any opening. Do not force one. They will not refuse you on the phone, and then they will not come.
- After match_jobs returns, offer the strongest job first, then the next one if they are rejected or already in cooling at the first. Interviews are face to face, best within two days. Do not invent the date. If they accept a returned job, the outcome is Line Up Scheduled.
- WhatsApp, only when a schedule is actually being set: ask them to send hi to 9964080000 while you are still talking. That is Jobshop's official WhatsApp. It shows Book my Appointment, No I Can't Attend, and Recruiter Details. They confirm by tapping Book my Appointment. Recruiter details show only after that. Official chat is never from a personal number. Reminders go at seven in the evening the day before, and at seven in the morning on the interview day, only if they sent hi or booked. If nothing was scheduled, do not pretend a message went out.
- Tell them the team follows up, and an early-morning follow-up is the useful one.

# Close
When the screen is done, or they are non-BPO, outstation with no relocate, blocked, abusive, or a wrong number, say a short close that matches this call, then end_call. The hangup does not speak a second farewell.`;


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
