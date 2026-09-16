import { describe, it, expect } from "vitest";
import type { CandidateIntake } from "@workspace/db";
import { INTAKE_JOBS } from "./intake-jobs.js";
import { matchIntakeJobs } from "./intake-job-match.js";
import { INTAKE_COMPANIES } from "./intake-dispositions.js";

function candidate(over: Partial<CandidateIntake> = {}): CandidateIntake {
  return {
    id: 1,
    publicToken: "x",
    userId: "u",
    agentId: null,
    callId: null,
    status: "in_progress",
    firstName: "Arbaz",
    lastName: "Khan",
    phone: "9113962868",
    email: "a@b.com",
    gender: "MALE",
    dateOfBirth: "1998-07-20",
    workStatus: "EXPERIENCED",
    totalCompanies: 2,
    city: "BENGALURU",
    jobCity: "BENGALURU",
    skillRole: "EXECUTIVE_SR_EXECUTIVE",
    skill: "INTERNATIONAL_VOICE_PROCESS",
    industry: "BPO_CALL_CENTER",
    qualification: "GRADUATE",
    shiftBase: "US",
    dnd: "DEACTIVATE",
    englishCommunication: "GOOD",
    extra: {},
    revision: 1,
    lastFieldKey: null,
    lastWriteSource: "agent",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  };
}

describe("INTAKE_JOBS", () => {
  it("covers every campaign company, Bangalore only", () => {
    const companies = new Set(INTAKE_JOBS.map((j) => j.company));
    for (const name of INTAKE_COMPANIES) {
      expect(companies.has(name)).toBe(true);
    }
    expect(INTAKE_JOBS.every((j) => j.city === "BENGALURU")).toBe(true);
    expect(INTAKE_JOBS.every((j) => j.skill === "INTERNATIONAL_VOICE_PROCESS")).toBe(true);
  });
});

describe("matchIntakeJobs", () => {
  it("pitches a US experienced Bangalore voice job", () => {
    const match = matchIntakeJobs(candidate(), { dispositionId: null, answers: {} });
    expect(match.blocked).toBe(false);
    expect(match.proposed?.city).toBe("BENGALURU");
    expect(match.proposed?.shiftBase).toBe("US");
    expect(match.speakScript).toBeTruthy();
  });

  it("does not pitch when the candidate is not interested", () => {
    const match = matchIntakeJobs(candidate(), { dispositionId: "not_interested", answers: {} });
    expect(match.proposed).toBeNull();
    expect(match.blocked).toBe(true);
  });

  it("excludes a cooling-period company", () => {
    const match = matchIntakeJobs(candidate(), {
      dispositionId: "cooling_period",
      answers: { rejected_company: "Concentrix" },
    });
    expect(match.proposed?.company).not.toBe("Concentrix");
  });

  it("keeps only weekend-off jobs for Need WeekEnd Off", () => {
    const match = matchIntakeJobs(candidate({ shiftBase: "DAY_ONLY", englishCommunication: "VERY_GOOD" }), {
      dispositionId: "need_weekend_off",
      answers: {},
    });
    expect(match.proposed?.weekendOff).toBe(true);
  });

  it("keeps WFH when the candidate will not come to office", () => {
    const match = matchIntakeJobs(candidate(), {
      dispositionId: "work_from_home",
      answers: { willing_to_work_from_office: "No" },
    });
    expect(match.proposed?.workFromHome).toBe(true);
  });

  it("refuses a non-Bangalore job city", () => {
    const match = matchIntakeJobs(candidate({ jobCity: "PUNE" }), { dispositionId: null, answers: {} });
    expect(match.proposed).toBeNull();
    expect(match.note).toMatch(/Bangalore only/);
  });
});
