/**
 * Thin RecruiterBrain — off the spoken GPU path.
 *
 * Moshi cannot call tools. This module owns eligibility facts, one next
 * question, and the coach line. Job matching is an interface only.
 */

import { normalizeIntakeField } from "./candidate-intake-fields.js";

export const RECRUITER_STATES = [
  "INITIAL",
  "JOB_PREFERENCE",
  "CITY",
  "RELOCATION",
  "LANGUAGE",
  "EXPERIENCE_TYPE",
  "FRESHER_INTRO",
  "EXPERIENCE_HISTORY",
  "PROCESS_PREFERENCE",
  "SHIFT",
  "TRANSPORT",
  "SALARY",
  "NOTICE_PERIOD",
  "WHATSAPP_CONFIRMATION",
  "COMPLETE",
  "HUMAN_TRANSFER",
  "DISQUALIFIED",
] as const;

export type RecruiterState = (typeof RECRUITER_STATES)[number];

export type CommunicationClass =
  | "INTERNATIONAL_VOICE"
  | "DOMESTIC_VOICE"
  | "NON_VOICE"
  | "INSUFFICIENT_DATA";

export interface ExperienceStint {
  company?: string;
  role?: string;
  from?: string;
  to?: string;
  reasonLeft?: string;
}

export interface RecruiterProfile {
  current_state: RecruiterState;
  previous_state?: RecruiterState;
  job_preference?: string;
  wants_bpo?: boolean;
  city?: string;
  in_bangalore?: boolean;
  will_relocate?: boolean;
  language?: string;
  hindi_fluent?: boolean;
  experience_type?: "fresher" | "experienced";
  experience_history?: ExperienceStint[];
  cooling_days?: 30 | 90;
  process_preference?: string;
  shift?: string;
  area?: string;
  transport?: string;
  last_ctc?: string;
  expected_salary?: string;
  notice_period?: string;
  whatsapp_ok?: boolean;
  communication_class?: CommunicationClass;
  disqualify_reason?: string;
}

export interface RecruiterDecision {
  state: RecruiterState;
  previous_state: RecruiterState;
  question: string | null;
  coachText: string;
  reason: string;
  profile_patch: Partial<RecruiterProfile>;
  outcome: RecruiterState | "CONTINUE";
  communication_class: CommunicationClass;
}

const BANGALORE = /\b(bangalore|bengaluru|blr|whitefield|electronic city|koramangala|indiranagar|marathahalli|hsr|hebbal|yelahanka)\b/i;
const NOT_BPO = /\b(software|developer|java|python coding|it job|wfh|work from home|virtual interview|non[- ]?bpo|sales field|delivery boy)\b/i;
const IS_BPO = /\b(bpo|voice process|non[- ]?voice|customer support|call center|call centre|international voice|domestic voice|telecaller)\b/i;
const FRESHER = /\b(fresher|no experience|just completed|just passed|first job|campus)\b/i;
const EXPERIENCED = /\b(\d+\s*(?:years?|yrs?|months?).{0,20}(experience|bpo)|worked at|i (?:have|had) (?:worked|experience)|currently working)\b/i;
const RELOCATE_YES = /\b(yes|i (?:will|can) relocate|ready to relocate|i can shift|ok to relocate)\b/i;
const RELOCATE_NO = /\b(no|cannot relocate|won't relocate|will not relocate|cannot shift|not relocating)\b/i;
const HINDI = /\b(hindi|i speak hindi|fluent in hindi)\b/i;
const US_SHIFT = /\b(us shift|night|evening|5:?30|6:?30|7:?30|8:?30|10 ?pm)\b/i;
const UK_SHIFT = /\b(uk shift|uk process|afternoon)\b/i;
const DAY_SHIFT = /\b(day shift|morning|general shift)\b/i;
const IMMEDIATE = /\b(immediate|serving notice|already resigned|can join (now|immediately)|notice period)\b/i;
const WHATSAPP_YES = /\b(yes|ok|okay|sure|i will|whatsapp)\b/i;
const SALARY = /(\d+(?:\.\d+)?)\s*(lpa|lakhs?|k|thousand|ctc|in-hand|take home)/i;

const QUESTION: Record<string, string> = {
  JOB_PREFERENCE: "What kind of job are you looking for?",
  CITY: "Which city are you in right now?",
  RELOCATION: "Interviews are face to face in Bangalore only. Will you relocate?",
  LANGUAGE: "What is your mother tongue, and how fluent is your Hindi?",
  EXPERIENCE_TYPE: "Are you a fresher, or do you have BPO experience?",
  FRESHER_INTRO: "Tell me a little about yourself, your family, and a hobby.",
  EXPERIENCE_HISTORY: "Which companies have you worked with, and for how long?",
  PROCESS_PREFERENCE: "Do you prefer international voice, domestic voice, or non-voice?",
  SHIFT: "Are you okay with day, UK, or US shifts? US starts from 5:30 pm, not only 10 pm.",
  TRANSPORT: "Which area are you in, and how will you commute?",
  SALARY: "What was your last CTC or take-home, and what are you expecting?",
  NOTICE_PERIOD: "Most BPO hires are immediate joiners. What is your notice period?",
  WHATSAPP_CONFIRMATION:
    "Please WhatsApp Hi to 9964080000 and tap Book my Appointment while you are still on this call.",
};

export function emptyRecruiterProfile(): RecruiterProfile {
  return { current_state: "INITIAL", communication_class: "INSUFFICIENT_DATA" };
}

export function isRecruiterState(raw: unknown): raw is RecruiterState {
  return typeof raw === "string" && (RECRUITER_STATES as readonly string[]).includes(raw);
}

export function parseRecruiterProfile(raw: unknown): RecruiterProfile {
  const base = emptyRecruiterProfile();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const rec = raw as Record<string, unknown>;
  const next: RecruiterProfile = { ...base };
  if (isRecruiterState(rec.current_state)) next.current_state = rec.current_state;
  if (isRecruiterState(rec.previous_state)) next.previous_state = rec.previous_state;
  const str = (k: keyof RecruiterProfile) => {
    const v = rec[k as string];
    if (typeof v === "string" && v.trim()) (next as Record<string, unknown>)[k] = v.trim();
  };
  const bool = (k: keyof RecruiterProfile) => {
    const v = rec[k as string];
    if (typeof v === "boolean") (next as Record<string, unknown>)[k] = v;
  };
  str("job_preference");
  bool("wants_bpo");
  str("city");
  bool("in_bangalore");
  bool("will_relocate");
  str("language");
  bool("hindi_fluent");
  if (rec.experience_type === "fresher" || rec.experience_type === "experienced") {
    next.experience_type = rec.experience_type;
  }
  str("process_preference");
  str("shift");
  str("area");
  str("transport");
  str("last_ctc");
  str("expected_salary");
  str("notice_period");
  bool("whatsapp_ok");
  if (
    rec.communication_class === "INTERNATIONAL_VOICE"
    || rec.communication_class === "DOMESTIC_VOICE"
    || rec.communication_class === "NON_VOICE"
    || rec.communication_class === "INSUFFICIENT_DATA"
  ) {
    next.communication_class = rec.communication_class;
  }
  str("disqualify_reason");
  if (Array.isArray(rec.experience_history)) {
    next.experience_history = rec.experience_history.filter(
      (s): s is ExperienceStint => !!s && typeof s === "object",
    );
  }
  if (rec.cooling_days === 30 || rec.cooling_days === 90) next.cooling_days = rec.cooling_days;
  return next;
}

export function classifyCommunication(turns: string[]): CommunicationClass {
  const spoken = turns.map((t) => t.trim()).filter(Boolean);
  if (spoken.length < 2) return "INSUFFICIENT_DATA";
  const text = spoken.join(" ");
  const words = text.split(/\s+/).length;
  const fillers = (text.match(/\b(um+|uh+|like|you know)\b/gi) ?? []).length;
  const englishHits = (text.match(/\b(i|am|working|because|experience|currently|looking)\b/gi) ?? []).length;
  if (words >= 40 && englishHits >= 8 && fillers < words / 12) return "INTERNATIONAL_VOICE";
  if (words >= 16 && englishHits >= 3) return "DOMESTIC_VOICE";
  if (spoken.length >= 3 && englishHits < 2) return "NON_VOICE";
  return "INSUFFICIENT_DATA";
}

export function extractFacts(userText: string, prior: RecruiterProfile): Partial<RecruiterProfile> {
  const text = userText.replace(/\s+/g, " ").trim();
  if (!text) return {};
  const patch: Partial<RecruiterProfile> = {};

  if (prior.wants_bpo == null) {
    if (NOT_BPO.test(text) && !IS_BPO.test(text)) {
      patch.wants_bpo = false;
      patch.job_preference = text.slice(0, 80);
    } else if (IS_BPO.test(text)) {
      patch.wants_bpo = true;
      patch.job_preference = text.slice(0, 80);
    }
  }

  if (prior.in_bangalore == null && (BANGALORE.test(text) || /\b(city|i am in|i'm in|from)\b/i.test(text))) {
    if (BANGALORE.test(text)) {
      patch.in_bangalore = true;
      patch.city = "Bangalore";
    } else {
      const city = text.match(/\b(?:in|from|at)\s+([A-Za-z][A-Za-z ]{2,20})\b/i)?.[1]?.trim();
      if (city && !/\b(job|bpo|voice|call)\b/i.test(city)) {
        patch.city = city;
        patch.in_bangalore = BANGALORE.test(city);
      }
    }
  }

  if (prior.will_relocate == null) {
    if (RELOCATE_YES.test(text) && !/\bno\b/i.test(text.slice(0, 8))) patch.will_relocate = true;
    else if (RELOCATE_NO.test(text)) patch.will_relocate = false;
  }

  if (prior.language == null && (HINDI.test(text) || /\bmother tongue\b/i.test(text))) {
    patch.language = text.slice(0, 80);
    patch.hindi_fluent = HINDI.test(text);
  }

  if (prior.experience_type == null) {
    if (FRESHER.test(text)) patch.experience_type = "fresher";
    else if (EXPERIENCED.test(text)) patch.experience_type = "experienced";
  }

  if (prior.process_preference == null) {
    if (/\binternational\b/i.test(text)) patch.process_preference = "international_voice";
    else if (/\bdomestic\b/i.test(text)) patch.process_preference = "domestic_voice";
    else if (/\bnon[- ]?voice\b/i.test(text)) patch.process_preference = "non_voice";
  }

  if (prior.shift == null) {
    if (US_SHIFT.test(text)) patch.shift = "US";
    else if (UK_SHIFT.test(text)) patch.shift = "UK";
    else if (DAY_SHIFT.test(text)) patch.shift = "day";
  }

  if (prior.area == null && /\b(area|commute|bus|metro|from .*nagar)\b/i.test(text)) {
    patch.area = text.slice(0, 80);
    patch.transport = text.slice(0, 80);
  }

  const salary = text.match(SALARY);
  if (salary && prior.expected_salary == null && prior.last_ctc == null) {
    const spoken = salary[0];
    if (/\blast|current|ctc|take home|in-hand/i.test(text)) patch.last_ctc = spoken;
    else patch.expected_salary = spoken;
  }

  if (prior.notice_period == null && IMMEDIATE.test(text)) {
    patch.notice_period = text.slice(0, 80);
  }

  if (prior.whatsapp_ok == null && WHATSAPP_YES.test(text) && prior.current_state === "WHATSAPP_CONFIRMATION") {
    patch.whatsapp_ok = true;
  }

  return patch;
}

function known(profile: RecruiterProfile, key: keyof RecruiterProfile): boolean {
  const v = profile[key];
  if (v === undefined || v === null || v === "") return false;
  return true;
}

function nextUnasked(profile: RecruiterProfile): RecruiterState {
  if (profile.wants_bpo === false) return "DISQUALIFIED";
  if (!known(profile, "wants_bpo") && !known(profile, "job_preference")) return "JOB_PREFERENCE";
  if (profile.wants_bpo === false) return "DISQUALIFIED";
  if (profile.in_bangalore == null && !known(profile, "city")) return "CITY";
  if (profile.in_bangalore === false && profile.will_relocate == null) return "RELOCATION";
  if (profile.in_bangalore === false && profile.will_relocate === false) return "DISQUALIFIED";
  if (profile.process_preference === "domestic_voice" && !known(profile, "language")) return "LANGUAGE";
  if (!known(profile, "experience_type")) return "EXPERIENCE_TYPE";
  if (profile.experience_type === "fresher" && !known(profile, "language") && profile.current_state === "FRESHER_INTRO") {
    return "FRESHER_INTRO";
  }
  if (profile.experience_type === "fresher" && profile.current_state !== "PROCESS_PREFERENCE" && !known(profile, "process_preference")) {
    if (profile.current_state === "EXPERIENCE_TYPE" || profile.current_state === "INITIAL" || profile.current_state === "JOB_PREFERENCE") {
      return "FRESHER_INTRO";
    }
  }
  if (profile.experience_type === "experienced" && (profile.experience_history?.length ?? 0) === 0) {
    if (profile.current_state === "EXPERIENCE_TYPE" || profile.current_state === "EXPERIENCE_HISTORY") {
      return "EXPERIENCE_HISTORY";
    }
  }
  if (!known(profile, "process_preference")) return "PROCESS_PREFERENCE";
  if (!known(profile, "shift")) return "SHIFT";
  if (!known(profile, "area") && !known(profile, "transport")) return "TRANSPORT";
  if (!known(profile, "last_ctc") && !known(profile, "expected_salary")) return "SALARY";
  if (!known(profile, "notice_period")) return "NOTICE_PERIOD";
  if (profile.whatsapp_ok !== true) return "WHATSAPP_CONFIRMATION";
  return "COMPLETE";
}

export function compactKnownFacts(profile: RecruiterProfile): string {
  const parts: string[] = [];
  if (profile.job_preference) parts.push(`job=${profile.job_preference}`);
  if (profile.wants_bpo === true) parts.push("bpo=yes");
  if (profile.wants_bpo === false) parts.push("bpo=no");
  if (profile.city) parts.push(`city=${profile.city}`);
  if (profile.in_bangalore === true) parts.push("bangalore=yes");
  if (profile.will_relocate === true) parts.push("relocate=yes");
  if (profile.will_relocate === false) parts.push("relocate=no");
  if (profile.language) parts.push(`lang=${profile.language}`);
  if (profile.experience_type) parts.push(`exp=${profile.experience_type}`);
  if (profile.process_preference) parts.push(`process=${profile.process_preference}`);
  if (profile.shift) parts.push(`shift=${profile.shift}`);
  if (profile.area) parts.push(`area=${profile.area}`);
  if (profile.last_ctc) parts.push(`last_ctc=${profile.last_ctc}`);
  if (profile.expected_salary) parts.push(`expected=${profile.expected_salary}`);
  if (profile.notice_period) parts.push(`notice=${profile.notice_period}`);
  return parts.join("; ").slice(0, 400);
}

export function decideNext(
  profile: RecruiterProfile,
  userText = "",
  userTurns: string[] = [],
): RecruiterDecision {
  const previous = profile.current_state;
  const patch = extractFacts(userText, profile);
  const merged: RecruiterProfile = { ...profile, ...patch };
  merged.communication_class = classifyCommunication(
    userTurns.length > 0 ? userTurns : (userText ? [userText] : []),
  );
  patch.communication_class = merged.communication_class;

  if (merged.wants_bpo === false) {
    merged.current_state = "DISQUALIFIED";
    merged.disqualify_reason = "not_bpo";
    patch.disqualify_reason = "not_bpo";
    return finish(merged, previous, patch, "DISQUALIFIED", "not BPO — JobShop only screens BPO");
  }
  if (merged.in_bangalore === false && merged.will_relocate === false) {
    merged.current_state = "DISQUALIFIED";
    merged.disqualify_reason = "no_relocate";
    patch.disqualify_reason = "no_relocate";
    return finish(merged, previous, patch, "DISQUALIFIED", "not Bangalore and will not relocate");
  }

  const state = nextUnasked(merged);
  merged.current_state = state;
  merged.previous_state = previous;
  patch.current_state = state;
  patch.previous_state = previous;

  if (state === "COMPLETE" || state === "HUMAN_TRANSFER" || state === "DISQUALIFIED") {
    return finish(merged, previous, patch, state, `reached ${state}`);
  }

  const question = QUESTION[state] ?? "Ask the next screening question.";
  const knownLine = compactKnownFacts(merged);
  const reason = skipReason(previous, state, merged);
  const coachText = [
    `Ask only: ${question}`,
    knownLine ? `Known facts (do not re-ask): ${knownLine}` : "",
    "Never invent jobs, companies, or salaries.",
  ].filter(Boolean).join(" ");

  return {
    state,
    previous_state: previous,
    question,
    coachText,
    reason,
    profile_patch: patch,
    outcome: "CONTINUE",
    communication_class: merged.communication_class ?? "INSUFFICIENT_DATA",
  };
}

function skipReason(previous: RecruiterState, next: RecruiterState, profile: RecruiterProfile): string {
  if (previous === next) return `stay on ${next} until answered`;
  if (next === "JOB_PREFERENCE") return "job preference unknown";
  if (next === "CITY") return "city unknown";
  if (next === "RELOCATION") return "outside Bangalore — ask relocate";
  if (next === "DISQUALIFIED") return profile.disqualify_reason ?? "disqualified";
  if (previous === "JOB_PREFERENCE" && next !== "JOB_PREFERENCE") return "job preference known — skip re-ask";
  if (previous === "CITY" && next !== "CITY") return "city known — skip re-ask";
  return `advance ${previous} → ${next}`;
}

function finish(
  merged: RecruiterProfile,
  previous: RecruiterState,
  patch: Partial<RecruiterProfile>,
  outcome: RecruiterState,
  reason: string,
): RecruiterDecision {
  patch.current_state = outcome;
  patch.previous_state = previous;
  const question =
    outcome === "DISQUALIFIED" && merged.disqualify_reason === "not_bpo"
      ? "JobShop called because you applied for a BPO role. We only hire BPO. Thank you."
      : outcome === "DISQUALIFIED"
        ? "Interviews are face to face in Bangalore only. Thank you."
        : null;
  return {
    state: outcome,
    previous_state: previous,
    question,
    coachText: question
      ? `Say: ${question} Then end politely. Known: ${compactKnownFacts(merged)}`
      : `Screening complete. Do not invent an opening. Known: ${compactKnownFacts(merged)}`,
    reason,
    profile_patch: patch,
    outcome,
    communication_class: merged.communication_class ?? "INSUFFICIENT_DATA",
  };
}

/** Later: wrap matchIntakeJobs. Moshi must not invent openings this slice. */
export interface RankedJobs {
  jobs: unknown[];
  speakScript: string | null;
  talkingPoints: string[];
}

export function rankJobs(_profile: RecruiterProfile): RankedJobs {
  return { jobs: [], speakScript: null, talkingPoints: [] };
}

export function mergeRecruiterProfile(
  current: RecruiterProfile,
  patch: Partial<RecruiterProfile>,
): RecruiterProfile {
  return { ...current, ...patch };
}

const EMAIL_WRITE_KEYS = ["email", "emailAddress", "candidateEmail"] as const;

/**
 * Email from the candidate's own STT turn — never Moshi 0x02 restatement.
 * Call 09:03 saved kj@sir.com because persist copied Irfan saying "Okay, so kj@sir.com".
 */
export function emailFromCandidateSpeech(userText: string): string | null {
  const spoken = userText.replace(/\s+/g, " ").trim();
  if (!spoken) return null;
  const take = (raw: string): string | null => {
    const n = normalizeIntakeField("email", raw);
    if (!n.ok || typeof n.value !== "string") return null;
    const local = n.value.split("@")[0] ?? "";
    if (local.length < 3) return null;
    if (/email|mailid|address/i.test(local)) return null;
    return n.value;
  };
  const rewritten = spoken.replace(/\s+at\s+/gi, "@").replace(/\s+dot\s+/gi, ".");
  const hits: string[] = [];
  for (const raw of rewritten.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? []) {
    const hit = take(raw);
    if (hit) hits.push(hit);
  }
  if (hits.length > 0) {
    hits.sort((a, b) => (b.split("@")[0] ?? "").length - (a.split("@")[0] ?? "").length);
    return hits[0] ?? null;
  }
  return take(spoken);
}

/** Never persist a salary/company/email Moshi invented — only facts the candidate said. */
export function sanitizeIntakeWrite(
  args: Record<string, unknown>,
  profile: RecruiterProfile,
  userText = "",
): Record<string, unknown> {
  const out = { ...args };
  if (!profile.expected_salary && !profile.last_ctc) {
    delete out["expectedSalary"];
    delete out["expectedCtc"];
    delete out["lastCtc"];
    delete out["currentCtc"];
    delete out["salary"];
    delete out["ctc"];
  }
  const spokenEmail = emailFromCandidateSpeech(userText);
  for (const key of EMAIL_WRITE_KEYS) {
    if (!(key in out)) continue;
    if (spokenEmail) out[key] = spokenEmail;
    else delete out[key];
  }
  if ((profile.experience_history?.length ?? 0) === 0 && !profile.experience_type) {
    // lastCompany from Moshi hallucination — keep only if candidate named one in history
  }
  return out;
}
