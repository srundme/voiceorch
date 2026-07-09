import male1 from "@/assets/avatars/male-1.png";
import male2 from "@/assets/avatars/male-2.png";
import male3 from "@/assets/avatars/male-3.png";
import male4 from "@/assets/avatars/male-4.png";
import male5 from "@/assets/avatars/male-5.png";
import male6 from "@/assets/avatars/male-6.png";
import male7 from "@/assets/avatars/male-7.png";
import male8 from "@/assets/avatars/male-8.png";
import female1 from "@/assets/avatars/female-1.png";
import female2 from "@/assets/avatars/female-2.png";
import female3 from "@/assets/avatars/female-3.png";
import female4 from "@/assets/avatars/female-4.png";
import female5 from "@/assets/avatars/female-5.png";
import female6 from "@/assets/avatars/female-6.png";
import female7 from "@/assets/avatars/female-7.png";
import female8 from "@/assets/avatars/female-8.png";

const MALE_AVATARS = [male1, male2, male3, male4, male5, male6, male7, male8];
const FEMALE_AVATARS = [female1, female2, female3, female4, female5, female6, female7, female8];

function hashString(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

/**
 * Fallback-only gender bucket, derived purely from a voice's stable id.
 * Used ONLY when neither the description text nor the curated gender field
 * yields an unambiguous signal. Still deterministic per voice id.
 */
export function inferVoiceGender(voiceId: string): "male" | "female" {
  return hashString(voiceId) % 2 === 0 ? "male" : "female";
}

type AgeBucket = "young" | "middle" | "senior";

/** Word-boundary regexes for gender cues actually seen in the catalog's
 * description text, e.g. "Young Female — Gentle...", "Middle Aged Male -
 * Bold...", "...female for professional...", "...male great for...". */
const FEMALE_DESC_RE = /\b(female|woman|women|she\/her|actress)\b/i;
const MALE_DESC_RE = /\b(male|man|men|he\/him|actor)\b/i;

const YOUNG_DESC_RE = /\b(young|youthful|teen|youth)\b/i;
const SENIOR_DESC_RE = /\b(senior|older|elder|elderly|mature|aged(?!\s+male|\s+female))\b|\bmiddle[\s-]?aged\b|\bold\b/i;
// Note: "middle aged" is treated as its own senior-leaning-but-distinct bucket below.
const MIDDLE_DESC_RE = /\bmiddle[\s-]?aged\b|\bmiddle[\s-]?age\b/i;

/**
 * Infers gender from a voice's free-text description, which reliably
 * encodes real gender (and often age) even though the curated `gender`
 * column is mostly "Neutral" in the catalog. Falls back to the curated
 * `gender` field only if it is literally "male"/"female", and finally to
 * the hash-based fallback. Never regresses voices that already resolve
 * correctly via the curated field.
 */
export function inferVoiceGenderAndAge(
  voiceId: string,
  gender?: string | null,
  description?: string | null,
): { gender: "male" | "female"; age: AgeBucket | null } {
  const desc = description ?? "";
  const hasFemale = FEMALE_DESC_RE.test(desc);
  const hasMale = MALE_DESC_RE.test(desc);

  let resolvedGender: "male" | "female" | null = null;
  if (hasFemale && !hasMale) resolvedGender = "female";
  else if (hasMale && !hasFemale) resolvedGender = "male";

  if (!resolvedGender) {
    const curated = gender?.toLowerCase().trim();
    if (curated === "male" || curated === "female") resolvedGender = curated;
  }

  if (!resolvedGender) resolvedGender = inferVoiceGender(voiceId);

  let age: AgeBucket | null = null;
  if (MIDDLE_DESC_RE.test(desc)) age = "middle";
  else if (SENIOR_DESC_RE.test(desc)) age = "senior";
  else if (YOUNG_DESC_RE.test(desc)) age = "young";

  return { gender: resolvedGender, age };
}

/** Splits an 8-image pool into young/middle/senior thirds (3/3/2 split). */
function ageSlice(pool: string[], age: AgeBucket): string[] {
  const young = pool.slice(0, 3);
  const middle = pool.slice(3, 6);
  const senior = pool.slice(6, 8);
  if (age === "young") return young.length ? young : pool;
  if (age === "middle") return middle.length ? middle : pool;
  return senior.length ? senior : pool;
}

/**
 * Deterministically maps a voice to one of a fixed set of bundled headshot
 * avatars. Gender is resolved primarily from the voice's description text
 * (reliable in this catalog), falling back to the curated `gender` field
 * only when it's an unambiguous "male"/"female", and finally to an
 * id-derived hash. When an age bucket is determinable from the description,
 * the avatar is picked from an age-appropriate slice of that gender's pool;
 * otherwise the full pool is used. Same voice id always resolves to the
 * exact same image, regardless of list order, reloads, or which page
 * renders it.
 */
export function getVoiceAvatar(voiceId: string, gender?: string | null, description?: string | null): string {
  const { gender: resolvedGender, age } = inferVoiceGenderAndAge(voiceId, gender, description);
  const fullPool = resolvedGender === "female" ? FEMALE_AVATARS : MALE_AVATARS;
  const pool = age ? ageSlice(fullPool, age) : fullPool;
  return pool[hashString(voiceId) % pool.length]!;
}

/** Same gender resolution used by `getVoiceAvatar`, exposed for UI labels
 * (e.g. the "Female"/"Male" pill on the Voices page) so the label and the
 * avatar never disagree. */
export function resolveVoiceGenderLabel(
  voiceId: string,
  gender?: string | null,
  description?: string | null,
): "Female" | "Male" {
  return inferVoiceGenderAndAge(voiceId, gender, description).gender === "female" ? "Female" : "Male";
}
