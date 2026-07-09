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
 * Used ONLY when no real gender label is available for a voice (e.g. an
 * older `platform_listed_voices` row saved before gender was curated).
 * Both `voices.tsx` and `vibe/index.tsx` source their real gender label
 * from the same `platform_listed_voices.gender` column, so this fallback
 * is rarely hit — but when it is, it's still deterministic per voice id.
 */
export function inferVoiceGender(voiceId: string): "male" | "female" {
  return hashString(voiceId) % 2 === 0 ? "male" : "female";
}

function normalizeGender(gender: string | null | undefined, voiceId: string): "male" | "female" {
  const g = gender?.toLowerCase();
  if (g === "male" || g === "female") return g;
  return inferVoiceGender(voiceId);
}

/**
 * Deterministically maps a voice to one of a fixed set of bundled headshot
 * avatars: the real `gender` label picks the male/female pool (falling
 * back to an id-derived bucket only when no real label is present), and a
 * hash of the voice id picks the specific image within that pool. Same
 * voice id + gender always resolves to the exact same image, regardless of
 * list order, reloads, or which page renders it.
 */
export function getVoiceAvatar(voiceId: string, gender?: string | null): string {
  const pool = normalizeGender(gender, voiceId) === "female" ? FEMALE_AVATARS : MALE_AVATARS;
  return pool[hashString(voiceId) % pool.length]!;
}
