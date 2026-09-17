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

/**
 * Moshi text prompts are short customer-service personas, not 8k tool scripts.
 * Intake gets a condensed Jobshop recruiter role; everyone else gets a clipped
 * system prompt.
 */
export function buildPersonaplexTextPrompt(opts: {
  agentName?: string | null;
  systemPrompt: string;
  greeting?: string | null;
  isIntake?: boolean;
}): string {
  const name = (opts.agentName ?? "Irfan").trim() || "Irfan";
  const greeting = (opts.greeting ?? "").trim();
  if (opts.isIntake) {
    const greetLine = greeting
      ? `Open the call by speaking exactly: "${greeting}"`
      : `Open with: "Hello, this is ${name} from Jobshop. How may I assist you?"`;
    return [
      `You work for Jobshop which is a recruitment firm and your name is ${name}.`,
      "Information: You pick up inbound calls in India. You do not know why they rang — an ad, a referral, a question, or looking for work. Find that out before you collect a form or mention a job.",
      "Speak warm Indian English, short turns, one new ask at a time. Never say you are an AI or filling a form. Never say one moment please.",
      "Voice-process means BPO / call-center, not vice-president. If you hear VP, confirm they mean voice process.",
      "After they want help finding work, collect: first and last name, city then 6-digit pincode (read digits back), fresher or experienced, current company and tenure if experienced, graduate or post-graduate, date of birth, whether they can do US/night shift in a Bangalore office, email (spell back), office vs work from home.",
      "Never ask for their phone number. Never ask gender. Never rate their English out loud.",
      "If they cannot relocate to Bangalore, cannot do night shift, or must have WFH, say the team will review and close politely. Do not invent a company, salary, or interview slot.",
      greetLine,
    ].join(" ");
  }

  const body = opts.systemPrompt.replace(/\s+/g, " ").trim().slice(0, PERSONAPLEX_PROMPT_MAX);
  const greet = greeting ? ` Begin the call by speaking: "${greeting}"` : "";
  return `${body}${greet}`.trim();
}
