/**
 * Pure Voice-a-thon lifecycle / scoring helpers (no DB).
 */

import type {
  VoiceathonEvent,
  VoiceathonEventStatus,
  VoiceathonRubricCriterion,
  VoiceathonCriterionScore,
} from "@workspace/db";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizeIndianPhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  const national = digits.startsWith("91") && digits.length === 12
    ? digits.slice(2)
    : digits;
  if (!/^[6-9]\d{9}$/.test(national)) return null;
  return `+91${national}`;
}

export function slugify(raw: string): string {
  return (
    raw
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "event"
  );
}

export function mintReferenceCode(): string {
  return `VA-${randomBytes(4).toString("hex").toUpperCase()}`;
}

export function mintJudgeToken(): string {
  return `vj_${randomBytes(24).toString("hex")}`;
}

export function hashJudgeToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function hashVoiceathonSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function matchesVoiceathonSecret(secret: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashVoiceathonSecret(secret), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function mintOtpCode(): string {
  return String(randomInt(100000, 1000000));
}

export function mintOtpVerificationToken(): string {
  return `votp_${randomBytes(24).toString("hex")}`;
}

export function mintTicketCode(): string {
  return `VA-${randomBytes(5).toString("hex").toUpperCase()}`;
}

export function mintVerificationCode(): string {
  return `VC-${randomBytes(12).toString("hex").toUpperCase()}`;
}

export function mintCertificateCode(): string {
  return mintVerificationCode();
}

function inWindow(now: Date, opens: Date | null, closes: Date | null): boolean {
  if (opens && now < opens) return false;
  if (closes && now > closes) return false;
  return true;
}

export function isRegistrationOpen(ev: VoiceathonEvent, now = new Date()): boolean {
  if (ev.status !== "published") return false;
  return inWindow(now, ev.registrationOpensAt, ev.registrationClosesAt);
}

export function isSubmissionOpen(ev: VoiceathonEvent, now = new Date()): boolean {
  if (["draft", "archived", "completed", "submission_closed"].includes(ev.status)) return false;
  if (!["published", "judging", "registration_closed"].includes(ev.status)) return false;
  if (ev.submissionOpensAt || ev.submissionClosesAt) {
    return inWindow(now, ev.submissionOpensAt, ev.submissionClosesAt);
  }
  return ["published", "registration_closed"].includes(ev.status);
}

export function isJudgingOpen(ev: VoiceathonEvent, now = new Date()): boolean {
  if (["draft", "archived", "completed"].includes(ev.status)) return false;
  if (ev.judgingOpensAt || ev.judgingClosesAt) {
    return inWindow(now, ev.judgingOpensAt, ev.judgingClosesAt);
  }
  return ev.status === "judging" || ev.status === "submission_closed";
}

export const ALLOWED_STATUS_TRANSITIONS: Record<VoiceathonEventStatus, VoiceathonEventStatus[]> = {
  draft: ["published", "archived"],
  published: ["registration_closed", "submission_closed", "judging", "completed", "archived"],
  registration_closed: ["published", "submission_closed", "judging", "completed", "archived"],
  submission_closed: ["judging", "completed", "archived"],
  judging: ["completed", "submission_closed", "archived"],
  completed: ["archived", "judging"],
  archived: ["draft"],
};

export function canTransitionStatus(
  from: VoiceathonEventStatus,
  to: VoiceathonEventStatus,
): boolean {
  return ALLOWED_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

export function computeWeightedTotal(
  rubric: VoiceathonRubricCriterion[],
  scores: VoiceathonCriterionScore[],
): number {
  if (!rubric.length) return 0;
  const byId = new Map(scores.map((s) => [s.criterionId, s.score]));
  let weighted = 0;
  let weightSum = 0;
  for (const c of rubric) {
    const raw = byId.get(c.id);
    if (raw == null || !Number.isFinite(raw)) continue;
    const clamped = Math.max(0, Math.min(c.maxScore, raw));
    const w = c.weight > 0 ? c.weight : 1;
    weighted += (clamped / Math.max(1, c.maxScore)) * 100 * w;
    weightSum += w;
  }
  if (weightSum <= 0) return 0;
  return Math.round(weighted / weightSum);
}

export function publicEventPayload(ev: VoiceathonEvent) {
  return {
    slug: ev.slug,
    title: ev.title,
    tagline: ev.tagline,
    description: ev.description,
    bannerUrl: ev.bannerUrl,
    mode: ev.mode,
    venue: ev.venue,
    timezone: ev.timezone,
    status: ev.status,
    registrationOpensAt: ev.registrationOpensAt?.toISOString() ?? null,
    registrationClosesAt: ev.registrationClosesAt?.toISOString() ?? null,
    eventStartsAt: ev.eventStartsAt?.toISOString() ?? null,
    eventEndsAt: ev.eventEndsAt?.toISOString() ?? null,
    submissionOpensAt: ev.submissionOpensAt?.toISOString() ?? null,
    submissionClosesAt: ev.submissionClosesAt?.toISOString() ?? null,
    minTeamSize: ev.minTeamSize,
    maxTeamSize: ev.maxTeamSize,
    rules: ev.rules,
    eligibility: ev.eligibility,
    prizes: ev.prizes ?? [],
    faq: ev.faq ?? [],
    registrationOpen: isRegistrationOpen(ev),
    submissionOpen: isSubmissionOpen(ev),
    leaderboardPublished: ev.leaderboardPublished,
  };
}

export function serializeEvent(ev: VoiceathonEvent, extras?: Record<string, unknown>) {
  return {
    id: ev.id,
    userId: ev.userId,
    slug: ev.slug,
    title: ev.title,
    tagline: ev.tagline,
    description: ev.description,
    bannerUrl: ev.bannerUrl,
    mode: ev.mode,
    venue: ev.venue,
    timezone: ev.timezone,
    status: ev.status,
    registrationOpensAt: ev.registrationOpensAt?.toISOString() ?? null,
    registrationClosesAt: ev.registrationClosesAt?.toISOString() ?? null,
    eventStartsAt: ev.eventStartsAt?.toISOString() ?? null,
    eventEndsAt: ev.eventEndsAt?.toISOString() ?? null,
    submissionOpensAt: ev.submissionOpensAt?.toISOString() ?? null,
    submissionClosesAt: ev.submissionClosesAt?.toISOString() ?? null,
    judgingOpensAt: ev.judgingOpensAt?.toISOString() ?? null,
    judgingClosesAt: ev.judgingClosesAt?.toISOString() ?? null,
    minTeamSize: ev.minTeamSize,
    maxTeamSize: ev.maxTeamSize,
    maxTeams: ev.maxTeams,
    rules: ev.rules,
    eligibility: ev.eligibility,
    prizes: ev.prizes ?? [],
    faq: ev.faq ?? [],
    rubric: ev.rubric ?? [],
    leaderboardPublished: ev.leaderboardPublished,
    shareUrl: `/events/${ev.slug}`,
    registrationOpen: isRegistrationOpen(ev),
    submissionOpen: isSubmissionOpen(ev),
    judgingOpen: isJudgingOpen(ev),
    createdAt: ev.createdAt.toISOString(),
    updatedAt: ev.updatedAt.toISOString(),
    ...extras,
  };
}
