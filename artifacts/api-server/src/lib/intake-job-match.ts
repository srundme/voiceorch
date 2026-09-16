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
  dispositionId: string | null;
  dispositionAnswers: Record<string, string | number | null>;
  proposedJobId: string | null;
  proposedJobTitle: string | null;
  proposedCompany: string | null;
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

function excludedCompanies(extra: IntakeExtra): Set<string> {
  const out = new Set<string>();
  const company = extra.answers["company"];
  const rejected = extra.answers["rejected_company"];
  if (extra.dispositionId === "non_hiring_zone" && typeof company === "string") out.add(company);
  if (extra.dispositionId === "non_hiring_university" && typeof company === "string") out.add(company);
  if (extra.dispositionId === "cooling_period" && typeof rejected === "string") out.add(rejected);
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
      note: "DND is active — no job is pitched.",
      blocked: true,
    };
  }
  if (extra.dispositionId && BLOCKING_DISPOSITIONS.has(extra.dispositionId)) {
    return {
      proposed: null,
      alternatives: [],
      speakScript: null,
      note: "Disposition does not go to a job lineup.",
      blocked: true,
    };
  }
  if (extra.dispositionId === "call_disconnected" && extra.answers["communication_judgement"] === "No") {
    return {
      proposed: null,
      alternatives: [],
      speakScript: null,
      note: "Call dropped before communication could be judged.",
      blocked: true,
    };
  }
  if (!jobCityIsBangalore(row.jobCity)) {
    return {
      proposed: null,
      alternatives: [],
      speakScript: null,
      note: `Demo JDs are Bangalore only. Job city is ${row.jobCity}.`,
      blocked: true,
    };
  }

  const age = ageYears(row.dateOfBirth);
  const english = (row.englishCommunication ?? "GOOD") as IntakeJobEnglish;
  const englishRank = ENGLISH_RANK[english] ?? 2;
  const excluded = excludedCompanies(extra);
  const needWeekend = extra.dispositionId === "need_weekend_off";
  const wfhOnly = extra.dispositionId === "work_from_home" && extra.answers["willing_to_work_from_office"] === "No";
  const relocateNo = extra.dispositionId === "out_station_candidate" && extra.answers["will_relocate"] === "No";
  const candidateCity = (row.city ?? "").toUpperCase().replace(/[^A-Z]/g, "");
  const inBangalore = candidateCity === "BENGALURU" || candidateCity === "BANGALORE" || candidateCity === "BLR";
  const expectedSalary = extra.dispositionId === "high_salary" && typeof extra.answers["expected_salary"] === "number"
    ? extra.answers["expected_salary"]
    : null;
  const willTakeLower = extra.answers["willing_lower_salary"] === "Yes" || extra.answers["salary_negotiable"] === "Yes";
  const gapMonths = extra.dispositionId === "career_gap" && typeof extra.answers["career_gap_duration"] === "number"
    ? extra.answers["career_gap_duration"]
    : 0;
  const domainNotBpo = extra.dispositionId === "other_domain_experience" && extra.answers["interested_in_bpo"] === "No";
  if (domainNotBpo) {
    return {
      proposed: null,
      alternatives: [],
      speakScript: null,
      note: "Candidate is not interested in a BPO job.",
      blocked: true,
    };
  }
  if (relocateNo && !inBangalore) {
    return {
      proposed: null,
      alternatives: [],
      speakScript: null,
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
      note: "No JD survived the filters.",
      blocked: false,
    };
  }

  return {
    proposed,
    alternatives,
    speakScript: proposed.pitch,
    note: null,
    blocked: false,
  };
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
    dispositionId: extra.dispositionId,
    dispositionAnswers: extra.answers,
    proposedJobId: match.proposed?.id ?? null,
    proposedJobTitle: match.proposed?.title ?? null,
    proposedCompany: match.proposed?.company ?? null,
  };
}
