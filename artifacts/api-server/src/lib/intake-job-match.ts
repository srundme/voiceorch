/**
 * Pick a Bangalore JD after intake is filled.
 *
 * Core filters: job city Bengaluru, campaign skill/role, shift, English,
 * experience, age, career gap. Dispositions then exclude companies or force
 * weekend-off / WFH / salary constraints. Blocking outcomes (not interested,
 * poor communication, voicemail, DND) return no pitch.
 */
import type { CandidateIntake } from "@workspace/db";
import type { IntakeExtra } from "./intake-dispositions.js";
import {
  INTAKE_JOBS,
  type IntakeJob,
  type IntakeJobEnglish,
  type IntakeJobShift,
} from "./intake-jobs.js";

const ENGLISH_RANK: Record<IntakeJobEnglish, number> = {
  POOR: 0,
  AVERAGE: 1,
  GOOD: 2,
  VERY_GOOD: 3,
  EXCELLENT: 4,
};

const BLOCKING_DISPOSITIONS = new Set([
  "poor_communication",
  "not_interested",
  "voice_mail",
  "no_company",
  "other_recruiter",
]);

export interface IntakeJobMatch {
  proposed: IntakeJob | null;
  alternatives: IntakeJob[];
  speakScript: string | null;
  /**
   * The same opening broken into single facts. The agent pitches from these
   * rather than the `speakScript` paragraph — a recruiter talks the role
   * through a couple of points at a time, they do not read out a block.
   */
  talkingPoints: string[];
  note: string | null;
  blocked: boolean;
}

export interface IntakeCandidateProfile {
  createdAt: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  gender: string | null;
  dateOfBirth: string | null;
  city: string | null;
  jobCity: string | null;
  workStatus: string | null;
  totalCompanies: number | null;
  qualification: string | null;
  shiftBase: string | null;
  englishCommunication: string | null;
  skillRole: string | null;
  skill: string | null;
  industry: string | null;
  dnd: string | null;
  dispositionIds: string[];
  dispositionAnswers: Record<string, Record<string, string | number | null>>;
  proposedJobId: string | null;
  proposedJobTitle: string | null;
  proposedCompany: string | null;
  /** Live English read from the call, with the reasons behind it. */
  englishEvidence: string[];
  /** Populated after the call by the post-call writeback. */
  recordingUrl: string | null;
  transcript: string | null;
  callId: number | null;
  callDurationSeconds: number | null;
}

function ageYears(iso: string | null | undefined): number | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const born = new Date(`${iso}T00:00:00Z`);
  const now = new Date();
  let age = now.getUTCFullYear() - born.getUTCFullYear();
  const md = now.getUTCMonth() - born.getUTCMonth();
  if (md < 0 || (md === 0 && now.getUTCDate() < born.getUTCDate())) age -= 1;
  return age;
}

function shiftFits(candidate: string | null, job: IntakeJob): boolean {
  if (!candidate || candidate === "ANY" || job.shiftBase === "ANY") return true;
  if (candidate === job.shiftBase) return true;
  if (candidate === "ROTATIONAL" && (job.shiftBase === "US" || job.shiftBase === "UK" || job.shiftBase === "NIGHT_ONLY")) {
    return true;
  }
  return false;
}

/** True when this outcome was recorded on the call. */
function has(extra: IntakeExtra, dispositionId: string): boolean {
  return extra.dispositionIds.includes(dispositionId);
}

/** One answer, scoped to the outcome it belongs to. */
function ans(extra: IntakeExtra, dispositionId: string, fieldId: string): string | number | null {
  return extra.answers[dispositionId]?.[fieldId] ?? null;
}

function excludedCompanies(extra: IntakeExtra): Set<string> {
  const out = new Set<string>();
  const zone = ans(extra, "non_hiring_zone", "company");
  const university = ans(extra, "non_hiring_university", "company");
  const rejected = ans(extra, "cooling_period", "rejected_company");
  if (typeof zone === "string") out.add(zone);
  if (typeof university === "string") out.add(university);
  if (typeof rejected === "string") out.add(rejected);
  return out;
}

function jobCityIsBangalore(jobCity: string | null): boolean {
  if (!jobCity) return true;
  const key = jobCity.toUpperCase().replace(/[^A-Z]/g, "");
  return key === "BENGALURU" || key === "BANGALORE" || key === "BLR";
}

export function matchIntakeJobs(row: CandidateIntake, extra: IntakeExtra): IntakeJobMatch {
  if (row.dnd === "ACTIVATE") {
    return {
      proposed: null,
      alternatives: [],
      speakScript: null,
      talkingPoints: [],
      note: "DND is active — no job is pitched.",
      blocked: true,
    };
  }
  const blocking = extra.dispositionIds.filter((id) => BLOCKING_DISPOSITIONS.has(id));
  if (blocking.length > 0) {
    return {
      proposed: null,
      alternatives: [],
      speakScript: null,
      talkingPoints: [],
      note: `Outcome does not go to a job lineup (${blocking.join(", ")}).`,
      blocked: true,
    };
  }
  if (has(extra, "call_disconnected") && ans(extra, "call_disconnected", "communication_judgement") === "No") {
    return {
      proposed: null,
      alternatives: [],
      speakScript: null,
      talkingPoints: [],
      note: "Call dropped before communication could be judged.",
      blocked: true,
    };
  }
  if (!jobCityIsBangalore(row.jobCity)) {
    return {
      proposed: null,
      alternatives: [],
      speakScript: null,
      talkingPoints: [],
      note: `Demo JDs are Bangalore only. Job city is ${row.jobCity}.`,
      blocked: true,
    };
  }

  const age = ageYears(row.dateOfBirth);
  const english = (row.englishCommunication ?? "GOOD") as IntakeJobEnglish;
  const englishRank = ENGLISH_RANK[english] ?? 2;
  const excluded = excludedCompanies(extra);
  const needWeekend = has(extra, "need_weekend_off");
  const wfhOnly = has(extra, "work_from_home")
    && ans(extra, "work_from_home", "willing_to_work_from_office") === "No";
  const relocateNo = has(extra, "out_station_candidate")
    && ans(extra, "out_station_candidate", "will_relocate") === "No";
  const candidateCity = (row.city ?? "").toUpperCase().replace(/[^A-Z]/g, "");
  const inBangalore = candidateCity === "BENGALURU" || candidateCity === "BANGALORE" || candidateCity === "BLR";
  const rawExpected = ans(extra, "high_salary", "expected_salary");
  const expectedSalary = typeof rawExpected === "number" ? rawExpected : null;
  const willTakeLower = ans(extra, "high_salary", "willing_lower_salary") === "Yes"
    || ans(extra, "high_salary", "salary_negotiable") === "Yes";
  const rawGap = ans(extra, "career_gap", "career_gap_duration");
  const gapMonths = typeof rawGap === "number" ? rawGap : 0;
  const domainNotBpo = has(extra, "other_domain_experience")
    && ans(extra, "other_domain_experience", "interested_in_bpo") === "No";
  if (domainNotBpo) {
    return {
      proposed: null,
      alternatives: [],
      speakScript: null,
      talkingPoints: [],
      note: "Candidate is not interested in a BPO job.",
      blocked: true,
    };
  }
  if (relocateNo && !inBangalore) {
    return {
      proposed: null,
      alternatives: [],
      speakScript: null,
      talkingPoints: [],
      note: "Outstation candidate will not relocate to Bangalore.",
      blocked: true,
    };
  }

  const scored: Array<{ job: IntakeJob; score: number }> = [];
  for (const job of INTAKE_JOBS) {
    if (excluded.has(job.company)) continue;
    if (row.workStatus && job.workStatus !== "ANY" && job.workStatus !== row.workStatus) continue;
    if (row.qualification === "GRADUATE" && job.qualification === "POST_GRADUATE") continue;
    if (!shiftFits(row.shiftBase, job)) continue;
    if (englishRank < ENGLISH_RANK[job.minEnglish]) continue;
    if (age != null && (age < job.minAge || age > job.maxAge)) continue;
    if (gapMonths > job.maxCareerGapMonths) continue;
    if (needWeekend && !job.weekendOff) continue;
    if (wfhOnly && !job.workFromHome) continue;
    if (expectedSalary != null && expectedSalary > job.salaryMax && !willTakeLower) continue;

    let score = 10;
    if (row.shiftBase && (job.shiftBase === row.shiftBase || job.shiftBase === "ANY")) score += 4;
    if (job.workStatus === row.workStatus) score += 3;
    if (needWeekend && job.weekendOff) score += 5;
    if (wfhOnly && job.workFromHome) score += 5;
    if (expectedSalary != null && expectedSalary <= job.salaryMax && expectedSalary >= job.salaryMin) score += 4;
    if (englishRank >= ENGLISH_RANK[job.minEnglish] + 1) score += 1;
    scored.push({ job, score });
  }

  scored.sort((a, b) => b.score - a.score || b.job.salaryMax - a.job.salaryMax);
  const proposed = scored[0]?.job ?? null;
  const alternatives = scored.slice(1, 4).map((s) => s.job);

  if (!proposed) {
    return {
      proposed: null,
      alternatives: [],
      speakScript: "I do not have a Bangalore international-voice opening that matches what we captured. I will check with my supervisor and call you back if something opens.",
      talkingPoints: [],
      note: "No JD survived the filters.",
      blocked: false,
    };
  }

  return {
    proposed,
    alternatives,
    speakScript: proposed.pitch,
    talkingPoints: talkingPointsFor(proposed),
    note: null,
    blocked: false,
  };
}

const SHIFT_WORDS: Record<IntakeJobShift, string> = {
  ANY: "flexible shifts",
  DAY_ONLY: "day shift",
  NIGHT_ONLY: "night shift",
  UK: "UK shift",
  US: "US shift",
  AUS: "Australia shift",
  DOMESTIC: "domestic shift",
  ROTATIONAL: "rotational shifts",
};

const inr = (n: number) => `${Math.round(n / 1000)}k`;

/**
 * Facts, not sentences. The agent decides the wording and the order, which is
 * what stops the pitch sounding like a page being read out.
 */
function talkingPointsFor(job: IntakeJob): string[] {
  const points = [
    `company: ${job.company}`,
    `role: ${job.title} (${job.process})`,
    `location: ${job.area}, Bengaluru${job.workFromHome ? " — work from home available" : " — work from office"}`,
    `shift: ${SHIFT_WORDS[job.shiftBase]}${job.weekendOff ? ", fixed weekend off" : ", rotational week-off"}`,
    `take-home: ₹${inr(job.salaryMin)}–${inr(job.salaryMax)} a month`,
    `eligibility: ${job.qualification === "POST_GRADUATE" ? "post graduate" : "graduate"}, ${
      job.workStatus === "ANY" ? "freshers and experienced" : job.workStatus === "FRESHER" ? "freshers" : "experienced"
    }`,
  ];
  if (job.openings > 0) points.push(`openings: ${job.openings}`);
  for (const req of job.requirements.slice(0, 3)) points.push(`requirement: ${req}`);
  return points;
}

export function buildIntakeProfile(
  row: CandidateIntake,
  extra: IntakeExtra,
  match: IntakeJobMatch,
): IntakeCandidateProfile {
  return {
    createdAt: new Date().toISOString(),
    firstName: row.firstName,
    lastName: row.lastName,
    phone: row.phone,
    email: row.email,
    gender: row.gender,
    dateOfBirth: row.dateOfBirth,
    city: row.city,
    jobCity: row.jobCity,
    workStatus: row.workStatus,
    totalCompanies: row.totalCompanies,
    qualification: row.qualification,
    shiftBase: row.shiftBase,
    englishCommunication: row.englishCommunication,
    skillRole: row.skillRole,
    skill: row.skill,
    industry: row.industry,
    dnd: row.dnd,
    dispositionIds: extra.dispositionIds,
    dispositionAnswers: extra.answers,
    proposedJobId: match.proposed?.id ?? null,
    proposedJobTitle: match.proposed?.title ?? null,
    proposedCompany: match.proposed?.company ?? null,
    englishEvidence: extra.english?.evidence ?? [],
    // Recording and transcript only exist once the leg is torn down, so the
    // post-call writeback fills these in on the stored profile.
    recordingUrl: null,
    transcript: null,
    callId: row.callId ?? null,
    callDurationSeconds: null,
  };
}
