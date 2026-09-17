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
import { isBangalorePlace, livesInBangalore } from "./intake-screen.js";

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
  pincode: string | null;
  workStatus: string | null;
  totalCompanies: number | null;
  lastCompany: string | null;
  tenure: string | null;
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

const NIGHT_LIKE = new Set(["US", "NIGHT_ONLY"]);

function shiftFits(candidate: string | null, job: IntakeJob): boolean {
  if (!candidate || candidate === "ANY" || job.shiftBase === "ANY") return true;
  if (candidate === job.shiftBase) return true;
  // This campaign is US / night / evening voice — night and US are the same pool.
  if (NIGHT_LIKE.has(candidate) && NIGHT_LIKE.has(job.shiftBase)) return true;
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
  return isBangalorePlace(jobCity);
}

function englishForMatch(row: CandidateIntake, extra: IntakeExtra): IntakeJobEnglish {
  const live = extra.english;
  if (live && live.samples >= 2) {
    const key = live.rating.toLowerCase().replace(/[^a-z]/g, "");
    const mapped: Record<string, IntakeJobEnglish> = {
      excellent: "EXCELLENT",
      verygood: "VERY_GOOD",
      good: "GOOD",
      average: "AVERAGE",
      poor: "POOR",
    };
    if (mapped[key]) return mapped[key]!;
  }
  if (row.englishCommunication) return row.englishCommunication as IntakeJobEnglish;
  // Incomplete live scoring must not default to AVERAGE and wipe every GOOD JD.
  return "GOOD";
}

function shiftForMatch(row: CandidateIntake, extra: IntakeExtra): string | null {
  if (has(extra, "shift_issues") && ans(extra, "shift_issues", "willing_for_alternate_shift") === "Yes") {
    return "US";
  }
  return row.shiftBase;
}

export const INTAKE_NO_MATCH_MARKER = "NO_JOB_MATCH";

export const SCREEN_KILL_REASON_SPEECH: Record<string, string> = {
  not_interested: "you are not interested in this process",
  poor_communication: "the English on this call is below voice-process level",
  will_not_relocate: "you will not relocate to Bangalore",
  job_city_not_bangalore: "you want to work outside Bangalore and our openings are Bangalore",
  wfh_only: "you need work from home and these openings are office-based",
  cannot_do_shift: "you cannot do the night or evening shift these processes run",
  not_interested_in_bpo: "you are not looking for a BPO voice-process job",
  age_limit: "your age is outside the range these openings hire for",
  DND: "you asked not to be contacted again",
};

/** Candidate-facing close when nothing in the catalog fits. Never say "JD" or "survived". */
export function closeLineForNoJob(reason: string): string {
  const why = reason.replace(/[.]+$/, "");
  return `Right now there are no jobs for your profile that are matched. That is because ${why}. Thank you for your time — we will reach out if something comes up.`;
}

export function noMatchCloseFromSubmitResult(result: string): string | null {
  if (!result.includes(INTAKE_NO_MATCH_MARKER)) return null;
  const say = result.match(/^Say:\s*(.+)$/m);
  return say?.[1]?.trim() || closeLineForNoJob("nothing in the current lineup fits this profile");
}

function emptyMatch(note: string, blocked: boolean): IntakeJobMatch {
  return {
    proposed: null,
    alternatives: [],
    speakScript: closeLineForNoJob(note),
    talkingPoints: [],
    note,
    blocked,
  };
}

const DROP_LABELS: Record<string, string> = {
  company: "we cannot line you up with those companies on this campaign",
  experience: "the seats we have are for a different fresher or experienced mix than yours",
  qualification: "the seats we have need a different qualification than yours",
  shift: "the seats we have are night and evening US processes, and that did not match the shift we captured",
  english: "these voice processes need a stronger English level than we heard on this call",
  age: "your age is outside the range these openings hire for",
  careerGap: "the career gap is longer than these openings allow",
  weekend: "you need Saturday-Sunday off and we do not have a weekend-off seat that also fits",
  wfh: "you need work from home and these openings are office-based",
  salary: "the salary you asked for is above what these openings can do",
};

function topDropReason(drops: Record<string, number>): string {
  let best = "nothing in the current Bangalore voice lineup fits this profile";
  let n = 0;
  for (const [key, count] of Object.entries(drops)) {
    if (count > n) {
      n = count;
      best = DROP_LABELS[key] ?? best;
    }
  }
  return best;
}

export function matchIntakeJobs(row: CandidateIntake, extra: IntakeExtra): IntakeJobMatch {
  if (row.dnd === "ACTIVATE") {
    return emptyMatch("you asked not to be contacted again", true);
  }
  const blocking = extra.dispositionIds.filter((id) => BLOCKING_DISPOSITIONS.has(id));
  if (blocking.length > 0) {
    const why =
      blocking.includes("not_interested") ? "you are not interested in this process"
        : blocking.includes("poor_communication") ? "the English on this call is below voice-process level"
          : blocking.includes("no_company") ? "we do not have a company for the city you want to work in"
            : blocking.includes("other_recruiter") ? "you are already working with another recruiter"
              : blocking.includes("voice_mail") ? "this reached voicemail"
                : "this outcome does not go to a job lineup";
    return emptyMatch(why, true);
  }
  if (has(extra, "call_disconnected") && ans(extra, "call_disconnected", "communication_judgement") === "No") {
    return emptyMatch("the call dropped before we could finish screening", true);
  }
  const english = englishForMatch(row, extra);
  if (english === "POOR") {
    return emptyMatch("the English on this call is below voice-process level", true);
  }
  const relocateYes = has(extra, "out_station_candidate")
    && ans(extra, "out_station_candidate", "will_relocate") === "Yes";
  if (!relocateYes && !jobCityIsBangalore(row.jobCity)) {
    return emptyMatch("our openings right now are Bangalore office-based voice processes", true);
  }

  const age = ageYears(row.dateOfBirth);
  const englishRank = ENGLISH_RANK[english] ?? 1;
  const excluded = excludedCompanies(extra);
  const needWeekend = has(extra, "need_weekend_off");
  const wfhOnly = has(extra, "work_from_home")
    && ans(extra, "work_from_home", "willing_to_work_from_office") === "No";
  const relocateNo = (has(extra, "out_station_candidate")
      && ans(extra, "out_station_candidate", "will_relocate") === "No")
    || (has(extra, "non_hiring_zone")
      && ans(extra, "non_hiring_zone", "will_relocate") === "No");
  const inBangalore = livesInBangalore(row.city, extra);
  const shift = shiftForMatch(row, extra);
  const rawExpected = ans(extra, "high_salary", "expected_salary");
  const expectedSalary = typeof rawExpected === "number" ? rawExpected : null;
  const willTakeLower = ans(extra, "high_salary", "willing_lower_salary") === "Yes"
    || ans(extra, "high_salary", "salary_negotiable") === "Yes";
  const rawGap = ans(extra, "career_gap", "career_gap_duration");
  const gapMonths = typeof rawGap === "number" ? rawGap : 0;
  const domainNotBpo = has(extra, "other_domain_experience")
    && ans(extra, "other_domain_experience", "interested_in_bpo") === "No";
  if (domainNotBpo) {
    return emptyMatch("you are not looking for a BPO voice-process job", true);
  }
  if (relocateNo && !inBangalore) {
    return emptyMatch("you are not in Bangalore and you will not relocate", true);
  }

  const drops: Record<string, number> = {
    company: 0, experience: 0, qualification: 0, shift: 0, english: 0,
    age: 0, careerGap: 0, weekend: 0, wfh: 0, salary: 0,
  };
  const scored: Array<{ job: IntakeJob; score: number }> = [];
  for (const job of INTAKE_JOBS) {
    if (excluded.has(job.company)) { drops.company += 1; continue; }
    if (row.workStatus && job.workStatus !== "ANY" && job.workStatus !== row.workStatus) {
      drops.experience += 1; continue;
    }
    if (row.qualification === "GRADUATE" && job.qualification === "POST_GRADUATE") {
      drops.qualification += 1; continue;
    }
    if (!shiftFits(shift, job)) { drops.shift += 1; continue; }
    if (englishRank < ENGLISH_RANK[job.minEnglish]) { drops.english += 1; continue; }
    if (age != null && (age < job.minAge || age > job.maxAge)) { drops.age += 1; continue; }
    if (gapMonths > job.maxCareerGapMonths) { drops.careerGap += 1; continue; }
    if (needWeekend && !job.weekendOff) { drops.weekend += 1; continue; }
    if (wfhOnly && !job.workFromHome) { drops.wfh += 1; continue; }
    if (expectedSalary != null && expectedSalary > job.salaryMax && !willTakeLower) {
      drops.salary += 1; continue;
    }

    let score = 10;
    if (shift && (job.shiftBase === shift || job.shiftBase === "ANY" || (NIGHT_LIKE.has(shift) && NIGHT_LIKE.has(job.shiftBase)))) score += 4;
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
    return emptyMatch(topDropReason(drops), false);
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

function firstPitchSentence(pitch: string): string {
  const trimmed = pitch.trim();
  const match = trimmed.match(/^[^.!?]+[.!?]/);
  return (match?.[0] ?? trimmed).trim();
}

/**
 * Recruiter facts, not labeled form rows. The first item is the opening hook
 * so the agent cannot get away with saying only the company name.
 */
function talkingPointsFor(job: IntakeJob): string[] {
  const weekend = job.weekendOff ? "Saturday and Sunday off" : "rotational week-offs";
  const site = job.workFromHome
    ? `${job.area}, Bengaluru — work from home is available`
    : `${job.area}, Bengaluru — this is work from office, not WFH`;
  const who =
    job.workStatus === "FRESHER"
      ? "freshers"
      : job.workStatus === "EXPERIENCED"
        ? "experienced voice agents"
        : "freshers and experienced agents";
  const points = [
    `Opening hook (first spoken turn — company AND the work in one breath, never the company name alone): ${firstPitchSentence(job.pitch)}`,
    `What they actually do: ${job.description}`,
    `Site: ${site}`,
    `Shift: ${SHIFT_WORDS[job.shiftBase]}, ${weekend}`,
    `Take-home: ₹${inr(job.salaryMin)}–${inr(job.salaryMax)} a month`,
    `Who they take: ${job.qualification === "POST_GRADUATE" ? "post graduates" : "graduates"}, ${who}`,
  ];
  if (job.openings > 0) points.push(`Openings: ${job.openings}`);
  for (const req of job.requirements.slice(0, 3)) points.push(`Requirement: ${req}`);
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
    pincode: extra.screen?.pincode
      ?? (typeof extra.answers["non_hiring_zone"]?.["candidate_pincode"] === "string"
        ? extra.answers["non_hiring_zone"]["candidate_pincode"]
        : null),
    workStatus: row.workStatus,
    totalCompanies: row.totalCompanies,
    lastCompany: extra.screen?.lastCompany ?? null,
    tenure: extra.screen?.tenure ?? null,
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
