import { describe, it, expect } from "vitest";
import {
  normalizeEmail,
  slugify,
  canTransitionStatus,
  computeWeightedTotal,
  isRegistrationOpen,
  isSubmissionOpen,
  isJudgingOpen,
  hashJudgeToken,
  mintJudgeToken,
  mintReferenceCode,
  mintCertificateCode,
} from "./voiceathon-rules.js";
import type { VoiceathonEvent } from "@workspace/db";

function event(partial: Partial<VoiceathonEvent> = {}): VoiceathonEvent {
  const now = new Date();
  return {
    id: 1,
    userId: "user_1",
    slug: "demo",
    title: "Demo Voice-a-thon",
    tagline: null,
    description: null,
    bannerUrl: null,
    mode: "online",
    venue: null,
    timezone: "Asia/Kolkata",
    status: "published",
    registrationOpensAt: null,
    registrationClosesAt: null,
    eventStartsAt: null,
    eventEndsAt: null,
    submissionOpensAt: null,
    submissionClosesAt: null,
    judgingOpensAt: null,
    judgingClosesAt: null,
    minTeamSize: 1,
    maxTeamSize: 4,
    maxTeams: null,
    rules: null,
    eligibility: null,
    prizes: [],
    faq: [],
    rubric: [],
    leaderboardPublished: false,
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Leader@Example.COM ")).toBe("leader@example.com");
  });
});

describe("slugify", () => {
  it("slugifies titles", () => {
    expect(slugify("Campus Voice-a-thon 2026!")).toBe("campus-voice-a-thon-2026");
  });

  it("falls back for empty input", () => {
    expect(slugify("!!!")).toBe("event");
  });
});

describe("status transitions", () => {
  it("allows draft → published", () => {
    expect(canTransitionStatus("draft", "published")).toBe(true);
  });

  it("blocks archived → judging", () => {
    expect(canTransitionStatus("archived", "judging")).toBe(false);
  });
});

describe("lifecycle windows", () => {
  const mid = new Date("2026-06-15T12:00:00Z");

  it("registration requires published + window", () => {
    expect(isRegistrationOpen(event({ status: "draft" }), mid)).toBe(false);
    expect(isRegistrationOpen(event({ status: "published" }), mid)).toBe(true);
    expect(
      isRegistrationOpen(
        event({
          status: "published",
          registrationClosesAt: new Date("2026-06-01T00:00:00Z"),
        }),
        mid,
      ),
    ).toBe(false);
  });

  it("submission respects explicit closes", () => {
    expect(isSubmissionOpen(event({ status: "published" }), mid)).toBe(true);
    expect(
      isSubmissionOpen(
        event({
          status: "published",
          submissionClosesAt: new Date("2026-06-01T00:00:00Z"),
        }),
        mid,
      ),
    ).toBe(false);
    expect(isSubmissionOpen(event({ status: "completed" }), mid)).toBe(false);
  });

  it("judging opens on judging status when no window", () => {
    expect(isJudgingOpen(event({ status: "published" }), mid)).toBe(false);
    expect(isJudgingOpen(event({ status: "judging" }), mid)).toBe(true);
    expect(isJudgingOpen(event({ status: "submission_closed" }), mid)).toBe(true);
  });
});

describe("computeWeightedTotal", () => {
  const rubric = [
    { id: "a", label: "A", maxScore: 10, weight: 1 },
    { id: "b", label: "B", maxScore: 10, weight: 3 },
  ];

  it("computes weighted percentage average", () => {
    // a: 10/10 → 100, b: 5/10 → 50; weighted = (100*1 + 50*3) / 4 = 62.5 → 63
    expect(
      computeWeightedTotal(rubric, [
        { criterionId: "a", score: 10 },
        { criterionId: "b", score: 5 },
      ]),
    ).toBe(63);
  });

  it("clamps scores to maxScore", () => {
    expect(
      computeWeightedTotal(rubric, [
        { criterionId: "a", score: 99 },
        { criterionId: "b", score: -5 },
      ]),
    ).toBe(25); // (100*1 + 0*3) / 4
  });

  it("returns 0 for empty rubric", () => {
    expect(computeWeightedTotal([], [{ criterionId: "a", score: 10 }])).toBe(0);
  });
});

describe("tokens", () => {
  it("mints opaque judge tokens and hashes them", () => {
    const token = mintJudgeToken();
    expect(token.startsWith("vj_")).toBe(true);
    expect(hashJudgeToken(token)).toHaveLength(64);
    expect(hashJudgeToken(token)).toBe(hashJudgeToken(token));
    expect(hashJudgeToken(token)).not.toBe(hashJudgeToken(mintJudgeToken()));
  });

  it("mints reference and certificate codes", () => {
    expect(mintReferenceCode()).toMatch(/^VA-[A-F0-9]+$/);
    expect(mintCertificateCode()).toMatch(/^VC-[A-F0-9]+$/);
  });
});
