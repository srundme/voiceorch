import { describe, expect, it } from "vitest";
import { validateStageChange, type SalesRole, type Stage, type StageFacts } from "./stages.js";

const NOW = new Date("2026-10-05T06:00:00Z");

function facts(overrides: Partial<StageFacts> = {}): StageFacts {
  return {
    qualification: {},
    decisionMakerContactValid: false,
    demoBuyerContactId: null,
    demoBuyerContactValid: false,
    demoAt: null,
    hasCompletedDemo: false,
    pilotReadiness: {},
    hasActivePilot: false,
    review: {},
    hasProposal: false,
    hasAcceptedTerms: false,
    hasVerifiedFirstMonthPayment: false,
    liveAt: null,
    onboardingChecksComplete: false,
    laterReason: null,
    laterActionAt: null,
    lostReason: null,
    stageBeforeLater: null,
    ...overrides,
  };
}

const complete = facts({
  qualification: { need: "Lead qualification", callingVolume: 3000, budgetFit: "yes", decisionMaker: "Owner" },
  demoBuyerContactId: 1,
  demoBuyerContactValid: true,
  demoAt: new Date("2026-10-06T06:00:00Z"),
  hasCompletedDemo: true,
  pilotReadiness: { dataReady: true, scriptReady: true, callingReadinessConfirmed: true, reviewAt: "2026-10-09T06:00:00Z" },
  hasActivePilot: true,
  review: { buyerFeedback: "Liked it", acceptedOutcomes: "12 appointments", nextDecision: "Go" },
  hasProposal: true,
  hasAcceptedTerms: true,
  hasVerifiedFirstMonthPayment: true,
  liveAt: new Date("2026-10-04T06:00:00Z"),
  onboardingChecksComplete: true,
});

function run(from: Stage, to: Stage, f: StageFacts, opts: { role?: SalesRole; note?: string; bypassReason?: string } = {}) {
  return validateStageChange({ from, to, role: opts.role ?? "founder", note: opts.note, bypassReason: opts.bypassReason, now: NOW, facts: f });
}

describe("validateStageChange — single forward steps", () => {
  it.each<[Stage, Stage, Partial<StageFacts>, string]>([
    ["Identified", "Qualified", { qualification: { callingVolume: 1000, budgetFit: "yes", decisionMaker: "X" } }, "need"],
    ["Identified", "Qualified", { qualification: { need: "x", budgetFit: "yes", decisionMaker: "X" } }, "calling volume"],
    ["Identified", "Qualified", { qualification: { need: "x", callingVolume: 10, budgetFit: "unknown", decisionMaker: "X" } }, "budget fit"],
    ["Identified", "Qualified", { qualification: { need: "x", callingVolume: 10, budgetFit: "no" } }, "decision maker"],
    ["Qualified", "Demo booked", { demoAt: NOW }, "buyer contact"],
    ["Qualified", "Demo booked", { demoBuyerContactId: 1, demoBuyerContactValid: true }, "appointment time"],
    ["Demo booked", "Demo completed", {}, "completed demo activity"],
    ["Demo completed", "Pilot ready", { pilotReadiness: { dataReady: true, scriptReady: true, reviewAt: "2026-10-09T06:00:00Z" } }, "calling-readiness"],
    ["Demo completed", "Pilot ready", { pilotReadiness: { dataReady: true, scriptReady: true, callingReadinessConfirmed: true } }, "review time"],
    ["Pilot ready", "Pilot running", {}, "Setup, Calling or Review due"],
    ["Pilot running", "Results reviewed", { review: { buyerFeedback: "ok", acceptedOutcomes: "ok" } }, "next decision"],
    ["Results reviewed", "Proposal", {}, "requires a proposal"],
    ["Proposal", "Paid", { hasVerifiedFirstMonthPayment: true }, "accepted terms"],
    ["Proposal", "Paid", { hasAcceptedTerms: true }, "verified first-month payment"],
    ["Paid", "Live", { onboardingChecksComplete: true }, "production start date"],
    ["Paid", "Live", { liveAt: new Date("2026-10-04T00:00:00Z") }, "onboarding checks"],
    ["Paid", "Live", { liveAt: new Date("2026-10-07T00:00:00Z"), onboardingChecksComplete: true }, "cannot be in the future"],
  ])("%s → %s fails without its evidence (%s)", (from, to, partial, message) => {
    const result = run(from, to, facts(partial));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain(message);
  });

  it.each<[Stage, Stage]>([
    ["Identified", "Qualified"],
    ["Qualified", "Demo booked"],
    ["Demo booked", "Demo completed"],
    ["Demo completed", "Pilot ready"],
    ["Pilot ready", "Pilot running"],
    ["Pilot running", "Results reviewed"],
    ["Results reviewed", "Proposal"],
    ["Proposal", "Paid"],
    ["Paid", "Live"],
  ])("%s → %s passes with complete evidence", (from, to) => {
    expect(run(from, to, complete, { role: "teammate" })).toEqual({ ok: true, bypass: false, skipped: [] });
  });

  it("accepts a decision-maker contact instead of a name only when it belongs to the company", () => {
    const q = { need: "x", callingVolume: 10, budgetFit: "yes", decisionMakerContactId: 7 };
    expect(run("Identified", "Qualified", facts({ qualification: q, decisionMakerContactValid: false })).ok).toBe(false);
    expect(run("Identified", "Qualified", facts({ qualification: q, decisionMakerContactValid: true })).ok).toBe(true);
  });
});

describe("validateStageChange — skipping and bypass", () => {
  it("refuses to skip forward without a bypass", () => {
    const result = run("Identified", "Demo booked", complete);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain("Cannot skip");
  });

  it("only founders may bypass", () => {
    const result = run("Qualified", "Proposal", complete, { role: "teammate", bypassReason: "Buyer wants pricing now" });
    expect(result).toMatchObject({ ok: false, status: 403 });
  });

  it("founder bypass can skip demo/pilot stages to reach Proposal", () => {
    expect(run("Qualified", "Proposal", complete, { bypassReason: "Referral, already convinced" })).toEqual({
      ok: true,
      bypass: true,
      skipped: ["Demo booked", "Demo completed", "Pilot ready", "Pilot running", "Results reviewed"],
    });
  });

  it("bypass still requires the target stage's own evidence", () => {
    const result = run("Qualified", "Proposal", { ...complete, hasProposal: false }, { bypassReason: "skip" });
    expect(result.ok).toBe(false);
  });

  it("bypass cannot skip Qualified", () => {
    const result = run("Identified", "Demo booked", complete, { bypassReason: "skip" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain("Qualified");
  });

  it("Paid is never bypassable — not by skipping to it", () => {
    const result = run("Qualified", "Paid", complete, { bypassReason: "Founder says so" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toContain("Proposal at most");
  });

  it("Paid is never bypassable — payment evidence is enforced even with a bypass reason", () => {
    const result = run("Proposal", "Paid", { ...complete, hasVerifiedFirstMonthPayment: false }, { bypassReason: "Paid in cash" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(" ")).toContain("verified first-month payment");
  });
});

describe("validateStageChange — backwards, Later, Lost", () => {
  it("moving backwards requires a note", () => {
    expect(run("Proposal", "Results reviewed", facts()).ok).toBe(false);
    expect(run("Proposal", "Results reviewed", facts(), { note: "Buyer wants another review" }).ok).toBe(true);
  });

  it("Later needs a reason and a future action date", () => {
    expect(run("Qualified", "Later", facts({ laterReason: "Budget next quarter" })).ok).toBe(false);
    expect(run("Qualified", "Later", facts({ laterReason: "Budget", laterActionAt: new Date("2026-10-01T00:00:00Z") })).ok).toBe(false);
    expect(run("Qualified", "Later", facts({ laterReason: "Budget", laterActionAt: new Date("2026-11-01T00:00:00Z") })).ok).toBe(true);
  });

  it("Lost needs a reason", () => {
    expect(run("Demo booked", "Lost", facts()).ok).toBe(false);
    expect(run("Demo booked", "Lost", facts({ lostReason: "Chose competitor" })).ok).toBe(true);
  });

  it("reopens from Later back to the previous stage or the next one with evidence", () => {
    expect(run("Later", "Demo booked", facts({ stageBeforeLater: "Demo booked" })).ok).toBe(true);
    expect(run("Later", "Demo completed", facts({ stageBeforeLater: "Demo booked" })).ok).toBe(false);
    expect(run("Later", "Demo completed", facts({ stageBeforeLater: "Demo booked", hasCompletedDemo: true })).ok).toBe(true);
    expect(run("Later", "Proposal", facts({ stageBeforeLater: "Demo booked" })).ok).toBe(false);
  });

  it("closed stages cannot change", () => {
    expect(run("Lost", "Qualified", complete, { note: "reopen" }).ok).toBe(false);
    expect(run("Live", "Paid", complete, { note: "undo" }).ok).toBe(false);
  });

  it("rejects a no-op change", () => {
    expect(run("Qualified", "Qualified", complete).ok).toBe(false);
  });
});
