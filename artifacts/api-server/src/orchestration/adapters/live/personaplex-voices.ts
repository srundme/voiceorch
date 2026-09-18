/**
 * NVIDIA PersonaPlex (Moshi) — self-hosted full-duplex speech-to-speech.
 *
 * Voices are .pt embeddings shipped in nvidia/personaplex-7b-v1 voices.tgz.
 * Live calls talk 8 kHz PCM to a GPU pcm_bridge; the bridge speaks Opus 24 kHz
 * to `python -m moshi.server` on /api/chat.
 */

export const PERSONAPLEX_VOICES = [
  "NATF0", "NATF1", "NATF2", "NATF3",
  "NATM0", "NATM1", "NATM2", "NATM3",
  "VARF0", "VARF1", "VARF2", "VARF3", "VARF4",
  "VARM0", "VARM1", "VARM2", "VARM3", "VARM4",
] as const;

export type PersonaplexVoice = (typeof PERSONAPLEX_VOICES)[number];

/** Natural male — closest to Irfan on the Jobshop intake line. */
export const DEFAULT_PERSONAPLEX_VOICE: PersonaplexVoice = "NATM1";

const VOICE_SET = new Set<string>(PERSONAPLEX_VOICES);

export function resolvePersonaplexVoice(raw: string | undefined | null): PersonaplexVoice {
  const t = (raw ?? "").trim().replace(/\.pt$/i, "").toUpperCase();
  if (VOICE_SET.has(t)) return t as PersonaplexVoice;
  return DEFAULT_PERSONAPLEX_VOICE;
}

export function personaplexVoiceFile(voice: string): string {
  return `${resolvePersonaplexVoice(voice)}.pt`;
}

export function personaplexWsUrlFromEnv(): string | null {
  const u = (process.env["PERSONAPLEX_WS_URL"] ?? "").trim();
  return u || null;
}

export type VoiceStackId = "classic" | "gemini_live" | "personaplex";

export function resolveVoiceStack(raw: string | undefined | null): VoiceStackId {
  if (raw === "gemini_live") return "gemini_live";
  if (raw === "personaplex") return "personaplex";
  return "classic";
}

/**
 * Intake auto-opts into PersonaPlex only when PERSONAPLEX_WS_URL is set on the
 * API server. Without that URL, classic cascade stays live so irfan does not
 * go mute. Explicit gemini_live still wins.
 */
export function resolveSessionVoiceStack(opts: {
  agentType?: string | null;
  raw?: string | null;
}): VoiceStackId {
  const configured = resolveVoiceStack(opts.raw);
  if (configured === "gemini_live") return "gemini_live";
  const url = personaplexWsUrlFromEnv();
  if (configured === "personaplex") return url ? "personaplex" : "classic";
  if (opts.agentType === "intake_inbound" && url) return "personaplex";
  return configured;
}

const PERSONAPLEX_PROMPT_MAX = 1800;

/** This GPU line is JobShop BPO screening for life. Keep in sync with pcm_bridge WARM_PROMPT. */
export const JOBSHOP_MOSHI_FLOW =
  "You are Irfan, recruiter at JobShop, India's largest BPO recruitment company. " +
  "You only screen BPO jobs. Interviews are face to face in Bangalore. " +
  "No work from home. No virtual interviews. " +
  "Never invent company names, openings, cities, kilometres, or salaries. " +
  "Never ask for their phone number. Never say you are an AI. " +
  'Speak first: "Hello, this is Irfan from JobShop." ' +
  "Simple Indian English. One question at a time. Let them finish. " +
  "1) What job they want. If not BPO: JobShop called because they applied for a BPO role on Naukri. We only hire BPO. Be polite and end. " +
  "2) Which city. If not Bangalore: face to face only. Ask if they will relocate. If no, end politely. " +
  "3) If they complain about many calls: they applied to several Naukri jobs. They can be blocked via Suma, Arbaz or Riyaz; once blocked they cannot reach JobShop. " +
  "4) BPO and Bangalore or relocating: before connecting to company HR you need basics. HR will ask the same. Ask if they are ok to proceed or want a human now. " +
  "5) International voice, domestic voice, or non-voice. " +
  "6) If domestic: mother tongue and Hindi fluency. " +
  "7) Fresher or BPO experience. Fresher: intro, family, hobby, judge English. Experienced: each company, dates, role, why they left, offer letter, relieving letter, payslips, notice served. " +
  "8) Age or year of birth, then latest education (regular or open), 12th, 10th, gaps. " +
  "9) What they actually want. Do not force a process. " +
  "10) Non-voice only: do not hang up. Note location and expected salary. Do not quote a fake opening. We will WhatsApp or email when one exists. If they speak well, voice pays more and grows more. Do not invent a CTC. " +
  "11) US shifts start 5:30pm, 6:30pm, 7:30pm, 8:30pm, not only 10pm. Ask day, UK, or US preference. " +
  "12) Area and commute. Do not invent distance. " +
  "13) Last CTC, take-home, expected salary. If too high: only certain bands now; we will call if something higher opens. Never promise a fake salary. " +
  "14) Most BPO hires are immediate joiners. If they resign only after an offer, note it. Do not invent joining dates. " +
  "15) Companies they already interviewed or worked. Mention 30 or 90 day cooling. Do not name a hiring company they did not mention. " +
  "16) Confirm what they want. You have no live CRM. Do not offer fake companies. A human matches real openings. Offer to connect to a human. " +
  "17) If they will attend face to face within 2 days: ask them to WhatsApp Hi to 9964080000 and tap Book my Appointment while still on this call. Never give a personal number.";

/**
 * Moshi bakes this before handshake. Intake on this GPU is the JobShop
 * recruiter flow only — not the 20k tool script.
 */
export function buildPersonaplexTextPrompt(opts: {
  agentName?: string | null;
  systemPrompt: string;
  greeting?: string | null;
  isIntake?: boolean;
}): string {
  if (opts.isIntake) return JOBSHOP_MOSHI_FLOW;
  const name = (opts.agentName ?? "Irfan").trim() || "Irfan";
  const greeting = (opts.greeting ?? "").trim().replace(/"/g, "'");
  const body = opts.systemPrompt
    .replace(/\s+/g, " ")
    .replace(/\b(call|use)\s+save_candidate_details\b[^.]*/gi, "")
    .trim()
    .slice(0, PERSONAPLEX_PROMPT_MAX);
  const greet = greeting
    ? ` Speak first: "${greeting}"`
    : ` Speak first: "Hello, this is ${name}."`;
  return `You are ${name}. ${body}${greet} Never say you are an AI.`.replace(/\s+/g, " ").trim();
}
