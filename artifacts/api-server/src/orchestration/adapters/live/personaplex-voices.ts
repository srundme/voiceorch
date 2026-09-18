/**
 * NVIDIA PersonaPlex (Moshi) — self-hosted full-duplex speech-to-speech.
 *
 * Voices are .pt embeddings shipped in nvidia/personaplex-7b-v1 voices.tgz.
 * Live calls talk 8 kHz PCM to a GPU pcm_bridge; the bridge speaks Opus 24 kHz
 * to `python -m moshi.server` on /api/chat.
 */

/**
 * NVIDIA: voice .pt = timbre/accent; text prompt = role + facts + vibe.
 * NAT* = natural US-leaning conversational. VAR* = more varied accent/pitch.
 * None of the 18 stock embeddings are labeled Indian — audition male VARM/NATM.
 */
export const PERSONAPLEX_VOICES = [
  "NATF0", "NATF1", "NATF2", "NATF3",
  "NATM0", "NATM1", "NATM2", "NATM3",
  "VARF0", "VARF1", "VARF2", "VARF3", "VARF4",
  "VARM0", "VARM1", "VARM2", "VARM3", "VARM4",
] as const;

export type PersonaplexVoice = (typeof PERSONAPLEX_VOICES)[number];

/** Natural male 3 — live JobShop Irfan. Accent is this .pt; stock pack is not Indian. */
export const DEFAULT_PERSONAPLEX_VOICE: PersonaplexVoice = "NATM3";

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

/** NVIDIA: Fisher opener = laugh/human; then CS "You work for X, your name is Y. Information:". Keep under 900 chars. */
export const IRFAN_PERSONA =
  "You enjoy having a good conversation. You find people funny and you laugh out loud like a real person — haha, hehe — when something is light. " +
  "Talk like a human on a live phone, not a script: pause, react, backchannel. " +
  "You work for JobShop, India's largest BPO hiring company, and your name is Irfan, a jolly Bangalore recruiter. " +
  "Indian English from Bangalore, friendly, never flat or robotic. " +
  "Information: You only screen BPO jobs. Interviews are face to face in Bangalore. " +
  "No work from home. No virtual interviews. " +
  "Never invent company names, openings, cities, kilometres, or salaries. " +
  "Never ask for their phone number or email. Never say you are an AI. " +
  "Do not greet first — the phone already played Hello this is Irfan from JobShop. " +
  "Start by asking what job they want. If not BPO, thank them politely and end. " +
  "Do not re-ask facts the candidate already gave.";

/**
 * Moshi bakes this before handshake. Intake on this GPU is a short Irfan
 * persona only — not the 20k tool script and not the recruiter playbook.
 */
export function buildPersonaplexTextPrompt(opts: {
  agentName?: string | null;
  systemPrompt: string;
  greeting?: string | null;
  isIntake?: boolean;
  knownFacts?: string | null;
}): string {
  if (opts.isIntake) {
    const known = (opts.knownFacts ?? "").trim();
    return known ? `${IRFAN_PERSONA} Known facts (do not re-ask): ${known}` : IRFAN_PERSONA;
  }
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
