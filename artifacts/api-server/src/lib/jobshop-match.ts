/**
 * Saves the answers collected on the call and scores them against the dummy jobs.
 * The spoken pitch may use only the jobs this returns.
 */
import { JOBSHOP_VOICE_JOBS, type VoiceProcessJob } from "./jobshop-dummy-jobs.js";

export interface JobshopProfile {
  firstName?: string;
  gender?: string;
  birthYear?: number;
  tenthYear?: number;
  twelfthYear?: number;
  diplomaYear?: number;
  degreeYear?: number;
  pgYear?: number;
  city?: string;
  qualification?: string;
  experienceYears?: number;
  skills: string[];
  skillRole?: string;
  shift?: string;
  expectedMonthlySalary?: number;
  english?: string;
}

export interface JobshopMatch {
  jobId: string;
  title: string;
  company: string;
  area: string;
  score: number;
  salaryMin: number;
  salaryMax: number;
  city: string;
  workMode: string;
  shift: string;
  qualification: string;
}

export const MATCH_JOBS_TOOL_NAME = "match_jobs";

export const MATCH_JOBS_PARAMETERS = {
  type: "object" as const,
  properties: {
    first_name: { type: "string", description: "First name. Gender is decided from this name and is not asked." },
    gender: { type: "string", description: "Male or Female, only if the first name says so. Omit when it does not." },
    city: { type: "string", description: "Current city" },
    birth_year: { type: "number", description: "Year of birth, four digits" },
    tenth_year: { type: "number", description: "Year they finished 10th" },
    twelfth_year: { type: "number", description: "Year they finished 12th" },
    diploma_year: { type: "number", description: "Year they finished a diploma" },
    degree_year: { type: "number", description: "Year they finished the degree" },
    pg_year: { type: "number", description: "Year they finished a postgraduate degree" },
    qualification: { type: "string", description: "10th, 12th, Diploma, Graduate, or Post Graduate" },
    experience_years: { type: "number", description: "Total years of work. 0 for a fresher." },
    skills: { type: "string", description: "What they want: international voice, domestic voice, or non-voice. Add customer care or technical support if they named it." },
    skill_role: { type: "string", description: "The role they do or want" },
    shift: { type: "string", description: "Day, night, UK, US, rotational, or any" },
    expected_monthly_salary: { type: "number", description: "Expected monthly salary in rupees" },
    english: { type: "string", description: "Excellent, Very good, Good, Average, or Poor, judged from how they spoke. Do not ask them." },
  },
  required: ["city", "qualification", "experience_years", "skills", "shift", "expected_monthly_salary"],
};

const PITCH_FLOOR = 60;

export function emptyJobshopProfile(): JobshopProfile {
  return { skills: [] };
}

function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function skillsOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  const raw = text(value);
  if (!raw) return [];
  return raw.split(/[,/]| and /i).map((s) => s.trim()).filter(Boolean);
}

export function mergeJobshopProfile(prev: JobshopProfile, patch: Record<string, unknown>): JobshopProfile {
  const next: JobshopProfile = { ...prev, skills: [...prev.skills] };
  const firstName = text(patch["first_name"]);
  const city = text(patch["city"]);
  const qualification = text(patch["qualification"]);
  const skillRole = text(patch["skill_role"]);
  const shift = text(patch["shift"]);
  const english = text(patch["english"]);
  const gender = text(patch["gender"]);
  const skills = skillsOf(patch["skills"]);
  if (firstName) next.firstName = firstName;
  if (city) next.city = city;
  if (qualification) next.qualification = qualification;
  if (skillRole) next.skillRole = skillRole;
  if (shift) next.shift = shift;
  if (english) next.english = english;
  if (gender) next.gender = gender;
  if (skills.length > 0) next.skills = skills;
  const birthYear = num(patch["birth_year"]);
  const tenthYear = num(patch["tenth_year"]);
  const twelfthYear = num(patch["twelfth_year"]);
  const diplomaYear = num(patch["diploma_year"]);
  const degreeYear = num(patch["degree_year"]);
  const pgYear = num(patch["pg_year"]);
  const experienceYears = num(patch["experience_years"]);
  const expected = num(patch["expected_monthly_salary"]);
  if (birthYear !== undefined) next.birthYear = birthYear;
  if (tenthYear !== undefined) next.tenthYear = tenthYear;
  if (twelfthYear !== undefined) next.twelfthYear = twelfthYear;
  if (diplomaYear !== undefined) next.diplomaYear = diplomaYear;
  if (degreeYear !== undefined) next.degreeYear = degreeYear;
  if (pgYear !== undefined) next.pgYear = pgYear;
  if (experienceYears !== undefined) next.experienceYears = experienceYears;
  if (expected !== undefined) next.expectedMonthlySalary = expected;
  return next;
}

function missingForMatch(profile: JobshopProfile): string[] {
  const missing: string[] = [];
  if (!profile.city) missing.push("city");
  if (!profile.qualification) missing.push("qualification");
  if (profile.experienceYears === undefined) missing.push("experience_years");
  if (profile.skills.length === 0) missing.push("skills");
  if (!profile.shift) missing.push("shift");
  if (profile.expectedMonthlySalary === undefined) missing.push("expected_monthly_salary");
  return missing;
}

function normCity(value: string): string {
  const compact = value.toLowerCase().replace(/[^a-z]/g, "");
  if (compact === "bangalore" || compact === "bengaluru") return "bengaluru";
  return compact;
}

function eduLevel(value: string | undefined): number {
  const q = (value ?? "").toLowerCase();
  if (q.includes("post") || q.includes("pg")) return 4;
  if (q.includes("graduat") || q.includes("degree") || q.includes("ug") || q.includes("b.tech") || q.includes("btech")) return 3;
  if (q.includes("12") || q.includes("diploma")) return 2;
  if (q.includes("10")) return 1;
  return 1;
}

function englishRank(value: string | undefined): number | undefined {
  const text = (value ?? "").toLowerCase();
  if (!text) return undefined;
  if (text.includes("excellent")) return 5;
  if (text.includes("very")) return 4;
  if (text.includes("good")) return 3;
  if (text.includes("average")) return 2;
  if (text.includes("poor")) return 1;
  return undefined;
}

const ENGLISH_FLOOR: Record<VoiceProcessJob["minEnglish"], number> = {
  EXCELLENT: 5,
  VERY_GOOD: 4,
  GOOD: 3,
  AVERAGE: 2,
  POOR: 1,
};

function wantsVoice(skills: string[]): "international" | "domestic" | "non-voice" | "none" {
  const blob = skills.join(" ").toLowerCase();
  if (/non[ -]?voice/.test(blob)) return "non-voice";
  if (/domestic/.test(blob)) return "domestic";
  if (/international|voice|bpo|customer|call/.test(blob)) return "international";
  return "none";
}

function shiftFits(candidateShift: string, job: VoiceProcessJob): boolean {
  const shift = candidateShift.toLowerCase();
  if (!shift || shift.includes("any") || shift.includes("rotat")) return true;
  if (job.shiftBase === "ANY" || job.shiftBase === "ROTATIONAL") return true;
  if (job.shiftBase === "US") return shift.includes("us") || shift.includes("night");
  if (job.shiftBase === "UK") return shift.includes("uk") || (shift.includes("day") && !shift.includes("night"));
  if (job.shiftBase === "DAY_ONLY") return shift.includes("day") || shift.includes("uk");
  if (job.shiftBase === "NIGHT_ONLY") return shift.includes("night") || shift.includes("us");
  if (job.shiftBase === "DOMESTIC") return shift.includes("domestic") || shift.includes("day");
  if (job.shiftBase === "AUS") return shift.includes("aus") || shift.includes("australia");
  return true;
}

function ageNow(birthYear: number): number {
  return new Date().getFullYear() - birthYear;
}

function passesHardFilter(profile: JobshopProfile, job: VoiceProcessJob): boolean {
  const candidateCity = profile.city ? normCity(profile.city) : "";
  if (candidateCity && candidateCity !== "bengaluru") return false;
  if (job.workStatus === "EXPERIENCED" && (profile.experienceYears ?? 0) < 0.5) return false;
  if (profile.shift && !shiftFits(profile.shift, job)) return false;
  const spoken = englishRank(profile.english);
  if (spoken !== undefined && spoken < ENGLISH_FLOOR[job.minEnglish]) return false;
  if (profile.birthYear !== undefined) {
    const age = ageNow(profile.birthYear);
    if (age < job.minAge || age > job.maxAge) return false;
  }
  if (eduLevel(profile.qualification) < 3) return false;
  if (wantsVoice(profile.skills) === "non-voice" || wantsVoice(profile.skills) === "none") return false;
  return true;
}

function scoreJob(profile: JobshopProfile, job: VoiceProcessJob): number {
  const voice = wantsVoice(profile.skills);
  const skillsScore = voice === "international" ? 100 : voice === "domestic" ? 75 : 30;
  const years = profile.experienceYears ?? 0;
  let expScore = 100;
  if (job.workStatus === "FRESHER") expScore = years <= 1 ? 100 : 80;
  else if (job.workStatus === "EXPERIENCED") expScore = years >= 0.5 ? 100 : 30;
  else expScore = 100;
  const respScore = voice === "international" ? 90 : 70;
  const eduScore = eduLevel(profile.qualification) >= 3 ? 100 : 40;
  const locScore = profile.city && normCity(profile.city) === "bengaluru" ? 100 : 40;
  const shiftScore = profile.shift && shiftFits(profile.shift, job) ? 100 : 50;
  const spoken = englishRank(profile.english);
  const needed = ENGLISH_FLOOR[job.minEnglish];
  const commScore = spoken === undefined || spoken >= needed ? 100 : spoken === needed - 1 ? 70 : 40;
  const expected = profile.expectedMonthlySalary;
  let salaryScore = 90;
  if (expected) {
    if (expected <= job.salaryMax) salaryScore = 100;
    else if (expected <= job.salaryMax * 1.3) salaryScore = 60;
    else salaryScore = 35;
  }
  const overall = (
    skillsScore * 35
    + expScore * 25
    + respScore * 15
    + eduScore * 10
    + locScore * 5
    + shiftScore * 5
    + commScore * 2.5
    + salaryScore * 2.5
  ) / 100;
  return Math.round(overall * 10) / 10;
}

function gapBetween(later: number, earlier: number, allowed: number, label: string): string | null {
  const gap = later - earlier - allowed;
  if (gap > 0) return `${label}: ${gap} year${gap === 1 ? "" : "s"} longer than the normal ${allowed}.`;
  return null;
}

export function educationGapNotes(profile: JobshopProfile): string[] {
  const notes: string[] = [];
  const { birthYear, tenthYear, twelfthYear, diplomaYear, degreeYear, pgYear } = profile;
  if (tenthYear && twelfthYear) {
    const note = gapBetween(twelfthYear, tenthYear, 2, "12th after 10th");
    if (note) notes.push(note);
  }
  if (diplomaYear && twelfthYear) {
    const note = gapBetween(diplomaYear, twelfthYear, 2, "Diploma after 12th");
    if (note) notes.push(note);
  } else if (diplomaYear && tenthYear) {
    const note = gapBetween(diplomaYear, tenthYear, 3, "Diploma after 10th");
    if (note) notes.push(note);
  }
  if (degreeYear && twelfthYear) {
    const note = gapBetween(degreeYear, twelfthYear, 3, "Degree after 12th");
    if (note) notes.push(note);
  }
  if (pgYear && degreeYear) {
    const note = gapBetween(pgYear, degreeYear, 2, "Postgraduate after the degree");
    if (note) notes.push(note);
  }
  if (birthYear && tenthYear && tenthYear - birthYear > 17) {
    notes.push(`10th at age ${tenthYear - birthYear}. Normal is 15, 16, or 17.`);
  }
  if (birthYear && twelfthYear && twelfthYear - birthYear > 19) {
    notes.push(`12th at age ${twelfthYear - birthYear}. Normal is 17, 18, or 19.`);
  }
  if (birthYear && degreeYear && degreeYear - birthYear > 22) {
    notes.push(`Degree at age ${degreeYear - birthYear}. Normal is 20, 21, or 22.`);
  }
  return notes;
}

function rupees(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`;
}

function pitchLine(match: JobshopMatch, index: number): string {
  return `${index}. ${match.title} at ${match.company}, ${match.area} (${match.jobId}), match ${match.score}. ${match.city}, ${match.workMode}, ${match.shift}, ${rupees(match.salaryMin)} to ${rupees(match.salaryMax)} a month, ${match.qualification}.`;
}

export function matchJobshopProfile(prev: JobshopProfile, patch: Record<string, unknown>): {
  profile: JobshopProfile;
  matches: JobshopMatch[];
  speech: string;
} {
  const profile = mergeJobshopProfile(prev, patch);
  const gaps = educationGapNotes(profile);
  const gapLine = gaps.length > 0
    ? `GAPS: ${gaps.join(" ")} Ask what they did in the gap if you have not already.`
    : "GAPS: none.";
  const missing = missingForMatch(profile);
  if (missing.length > 0) {
    return {
      profile,
      matches: [],
      speech: `PROFILE_SAVED. Still needed before a match: ${missing.join(", ")}. Ask the next one only. Do not name a job. ${gapLine}`,
    };
  }

  const matches = JOBSHOP_VOICE_JOBS
    .filter((job) => passesHardFilter(profile, job))
    .map((job) => ({
      jobId: job.jobId,
      title: job.title,
      company: job.company,
      area: job.area,
      score: scoreJob(profile, job),
      salaryMin: job.salaryMin,
      salaryMax: job.salaryMax,
      city: job.city,
      workMode: job.workMode,
      shift: job.shiftLabel,
      qualification: job.qualification,
    }))
    .filter((match) => match.score >= PITCH_FLOOR)
    .sort((a, b) => b.score - a.score || (b.salaryMax ?? 0) - (a.salaryMax ?? 0))
    .slice(0, 3);

  if (matches.length === 0) {
    return {
      profile,
      matches,
      speech: `PROFILE_SAVED. NO_OPENING. Tell them you do not have an opening that fits, and the team will call if one comes. Do not name a company or a salary. ${gapLine}`,
    };
  }

  const lines = matches.map((match, index) => pitchLine(match, index + 1));
  return {
    profile,
    matches,
    speech: `PROFILE_SAVED. Speak only these jobs, strongest first, in your own short sentences. Do not add a company, a city, or a salary that is not written here.\n${lines.join("\n")}\n${gapLine}`,
  };
}
