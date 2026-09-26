/**
 * Voice-process openings the call may pitch.
 * Taken from the existing Bangalore international-voice lineup. Not a new company list.
 */
import { INTAKE_JOBS, type IntakeJob, type IntakeJobEnglish, type IntakeJobShift } from "./intake-jobs.js";

export interface VoiceProcessJob {
  jobId: string;
  title: string;
  company: string;
  area: string;
  process: string;
  city: "Bengaluru";
  workMode: "Office" | "Work from home";
  shiftBase: IntakeJobShift;
  shiftLabel: string;
  workStatus: IntakeJob["workStatus"];
  minEnglish: IntakeJobEnglish;
  qualification: string;
  salaryMin: number;
  salaryMax: number;
  minAge: number;
  maxAge: number;
}

const SHIFT_LABEL: Record<IntakeJobShift, string> = {
  ANY: "any shift",
  DAY_ONLY: "day shift",
  NIGHT_ONLY: "night shift",
  UK: "UK shift",
  US: "US shift",
  AUS: "Australia shift",
  DOMESTIC: "domestic shift",
  ROTATIONAL: "rotational shift",
};

export const JOBSHOP_VOICE_JOBS: readonly VoiceProcessJob[] = INTAKE_JOBS.map((job) => ({
  jobId: job.id,
  title: job.title,
  company: job.company,
  area: job.area,
  process: job.process,
  city: "Bengaluru",
  workMode: job.workFromHome ? "Work from home" : "Office",
  shiftBase: job.shiftBase,
  shiftLabel: SHIFT_LABEL[job.shiftBase],
  workStatus: job.workStatus,
  minEnglish: job.minEnglish,
  qualification: job.qualification === "POST_GRADUATE" ? "Post Graduate" : "Graduate",
  salaryMin: job.salaryMin,
  salaryMax: job.salaryMax,
  minAge: job.minAge,
  maxAge: job.maxAge,
}));
