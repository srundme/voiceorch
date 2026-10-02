export const ORDERED_STAGES = [
  "Identified",
  "Qualified",
  "Demo booked",
  "Demo completed",
  "Pilot ready",
  "Pilot running",
  "Results reviewed",
  "Proposal",
  "Paid",
  "Live",
] as const;

export const SIDE_STAGES = ["Later", "Lost"] as const;
export const ALL_STAGES = [...ORDERED_STAGES, ...SIDE_STAGES] as const;
export const CLOSED_STAGES = ["Lost", "Live"] as const;

export type OrderedStage = (typeof ORDERED_STAGES)[number];
export type Stage = (typeof ALL_STAGES)[number];
export type SalesRole = "founder" | "teammate";

const BYPASSABLE_STAGES: ReadonlySet<Stage> = new Set([
  "Demo booked",
  "Demo completed",
  "Pilot ready",
  "Pilot running",
  "Results reviewed",
]);

export function isStage(value: string): value is Stage {
  return (ALL_STAGES as readonly string[]).includes(value);
}

export function stageIndex(stage: Stage): number {
  return (ORDERED_STAGES as readonly string[]).indexOf(stage);
}

export function isOpenStage(stage: Stage): boolean {
  return !(CLOSED_STAGES as readonly string[]).includes(stage);
}

export interface Qualification {
  need?: string | null;
  callingVolume?: number | null;
  budgetFit?: string | null;
  decisionMakerContactId?: number | null;
  decisionMaker?: string | null;
}

export interface PilotReadiness {
  dataReady?: boolean;
  scriptReady?: boolean;
  callingReadinessConfirmed?: boolean;
  reviewAt?: string | null;
}

export interface Review {
  buyerFeedback?: string | null;
  acceptedOutcomes?: string | null;
  nextDecision?: string | null;
}

export interface StageFacts {
  qualification: Qualification;
  decisionMakerContactValid: boolean;
  demoBuyerContactId: number | null;
  demoBuyerContactValid: boolean;
  demoAt: Date | null;
  hasCompletedDemo: boolean;
  pilotReadiness: PilotReadiness;
  hasActivePilot: boolean;
  review: Review;
  hasProposal: boolean;
  hasAcceptedTerms: boolean;
  hasVerifiedFirstMonthPayment: boolean;
  liveAt: Date | null;
  onboardingChecksComplete: boolean;
  laterReason: string | null;
  laterActionAt: Date | null;
  lostReason: string | null;
  stageBeforeLater: Stage | null;
}

export interface StageChangeInput {
  from: Stage;
  to: Stage;
  role: SalesRole;
  note?: string | null;
  bypassReason?: string | null;
  now: Date;
  facts: StageFacts;
}

export type StageChangeResult =
  | { ok: true; bypass: boolean; skipped: Stage[] }
  | { ok: false; status: 400 | 403; errors: string[] };

const filled = (s: string | null | undefined): boolean => typeof s === "string" && s.trim().length > 0;

export function stageRequirementErrors(to: Stage, facts: StageFacts, now: Date): string[] {
  const errors: string[] = [];
  switch (to) {
    case "Identified":
      break;
    case "Qualified": {
      const q = facts.qualification;
      if (!filled(q.need)) errors.push("Qualified requires the buyer's need");
      if (typeof q.callingVolume !== "number" || !(q.callingVolume > 0)) errors.push("Qualified requires a monthly calling volume");
      if (q.budgetFit !== "yes" && q.budgetFit !== "no") errors.push("Qualified requires a budget fit answer (yes/no)");
      const hasDm = (q.decisionMakerContactId != null && facts.decisionMakerContactValid) || filled(q.decisionMaker);
      if (!hasDm) errors.push("Qualified requires a decision maker");
      break;
    }
    case "Demo booked":
      if (facts.demoBuyerContactId == null || !facts.demoBuyerContactValid) errors.push("Demo booked requires a buyer contact at this company");
      if (!facts.demoAt) errors.push("Demo booked requires the demo appointment time");
      break;
    case "Demo completed":
      if (!facts.hasCompletedDemo) errors.push("Demo completed requires a completed demo activity");
      break;
    case "Pilot ready": {
      const r = facts.pilotReadiness;
      if (!r.dataReady || !r.scriptReady) errors.push("Pilot ready requires data and script readiness");
      if (!r.callingReadinessConfirmed) errors.push("Pilot ready requires calling-readiness confirmation");
      if (!r.reviewAt || Number.isNaN(new Date(r.reviewAt).getTime())) errors.push("Pilot ready requires a booked review time");
      break;
    }
    case "Pilot running":
      if (!facts.hasActivePilot) errors.push("Pilot running requires a pilot in Setup, Calling or Review due");
      break;
    case "Results reviewed": {
      const r = facts.review;
      if (!filled(r.buyerFeedback)) errors.push("Results reviewed requires buyer feedback");
      if (!filled(r.acceptedOutcomes)) errors.push("Results reviewed requires accepted outcomes");
      if (!filled(r.nextDecision)) errors.push("Results reviewed requires the next decision");
      break;
    }
    case "Proposal":
      if (!facts.hasProposal) errors.push("Proposal requires a proposal");
      break;
    case "Paid":
      if (!facts.hasAcceptedTerms) errors.push("Paid requires accepted terms");
      if (!facts.hasVerifiedFirstMonthPayment) errors.push("Paid requires a verified first-month payment");
      break;
    case "Live":
      if (!facts.liveAt) errors.push("Live requires the actual production start date");
      else if (facts.liveAt.getTime() > now.getTime()) errors.push("Live production start date cannot be in the future");
      if (!facts.onboardingChecksComplete) errors.push("Live requires completed onboarding checks");
      break;
    case "Later":
      if (!filled(facts.laterReason)) errors.push("Later requires a reason");
      if (!facts.laterActionAt || facts.laterActionAt.getTime() <= now.getTime()) errors.push("Later requires a future action date");
      break;
    case "Lost":
      if (!filled(facts.lostReason)) errors.push("Lost requires a reason");
      break;
  }
  return errors;
}

export function validateStageChange(input: StageChangeInput): StageChangeResult {
  const { from, to, role, facts, now } = input;
  const bypassReason = input.bypassReason?.trim() || null;
  const fail = (errors: string[], status: 400 | 403 = 400): StageChangeResult => ({ ok: false, status, errors });

  if (from === to) return fail([`Opportunity is already in ${to}`]);
  if (!isOpenStage(from)) return fail([`${from} is a closed stage and cannot be changed`]);
  if (bypassReason && role !== "founder") return fail(["Only a founder can bypass stages"], 403);

  if (to === "Later" || to === "Lost") {
    if (from === "Later" && to === "Later") return fail(["Opportunity is already in Later"]);
    const errors = stageRequirementErrors(to, facts, now);
    return errors.length ? fail(errors) : { ok: true, bypass: false, skipped: [] };
  }

  const base: Stage | null = from === "Later" ? facts.stageBeforeLater : from;
  const fromIdx = base ? stageIndex(base) : 0;
  const toIdx = stageIndex(to);

  if (toIdx <= fromIdx) {
    if (from === "Later") return { ok: true, bypass: false, skipped: [] };
    if (!filled(input.note)) return fail(["Moving an opportunity backwards requires a note"]);
    return { ok: true, bypass: false, skipped: [] };
  }

  const skipped = ORDERED_STAGES.slice(fromIdx + 1, toIdx) as Stage[];
  const errors = stageRequirementErrors(to, facts, now);

  if (skipped.length === 0) {
    return errors.length ? fail(errors) : { ok: true, bypass: false, skipped };
  }

  if (!bypassReason) {
    return fail([`Cannot skip from ${base ?? "Identified"} to ${to}; move one stage at a time (skipped: ${skipped.join(", ")})`]);
  }
  if (toIdx > stageIndex("Proposal")) {
    return fail([`Bypass can reach Proposal at most; ${to} must follow its own requirements`]);
  }
  const notBypassable = skipped.filter((s) => !BYPASSABLE_STAGES.has(s));
  if (notBypassable.length) {
    return fail([`Bypass may only skip demo and pilot stages (cannot skip: ${notBypassable.join(", ")})`]);
  }
  return errors.length ? fail(errors) : { ok: true, bypass: true, skipped };
}
