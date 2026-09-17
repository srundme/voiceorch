import { describe, it, expect } from "vitest";
import type { CandidateIntake } from "@workspace/db";
import { INTAKE_JOBS } from "./intake-jobs.js";
import { closeLineForNoJob, matchIntakeJobs, noMatchCloseFromSubmitResult } from "./intake-job-match.js";
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
    const match = matchIntakeJobs(candidate(), { dispositionIds: [], answers: {} });
    expect(match.blocked).toBe(false);
    expect(match.proposed?.city).toBe("BENGALURU");
    expect(match.proposed?.shiftBase).toBe("US");
    expect(match.speakScript).toBeTruthy();
    expect(match.talkingPoints[0]).toMatch(/Opening hook/);
    expect(match.talkingPoints[0]).not.toMatch(/^company:/);
    expect(match.talkingPoints[0]).toMatch(/Concentrix|Startek|Teleperformance|customer|voice|US/i);
  });

  it("does not pitch when the candidate is not interested", () => {
    const match = matchIntakeJobs(candidate(), { dispositionIds: ["not_interested"], answers: {} });
    expect(match.proposed).toBeNull();
    expect(match.blocked).toBe(true);
  });

  it("excludes a cooling-period company", () => {
    const match = matchIntakeJobs(candidate(), {
      dispositionIds: ["cooling_period"],
      answers: { cooling_period: { rejected_company: "Concentrix" } },
    });
    expect(match.proposed?.company).not.toBe("Concentrix");
  });

  it("keeps only weekend-off jobs for Need WeekEnd Off", () => {
    const match = matchIntakeJobs(candidate({ shiftBase: "DAY_ONLY", englishCommunication: "VERY_GOOD" }), {
      dispositionIds: ["need_weekend_off"],
      answers: {},
    });
    expect(match.proposed?.weekendOff).toBe(true);
  });

  it("keeps WFH when the candidate will not come to office", () => {
    const match = matchIntakeJobs(candidate(), {
      dispositionIds: ["work_from_home"],
      answers: { work_from_home: { willing_to_work_from_office: "No" } },
    });
    expect(match.proposed?.workFromHome).toBe(true);
  });

  it("refuses a non-Bangalore job city", () => {
    const match = matchIntakeJobs(candidate({ jobCity: "PUNE" }), { dispositionIds: [], answers: {} });
    expect(match.proposed).toBeNull();
    expect(match.note).toMatch(/Bangalore/i);
    expect(match.speakScript).toMatch(/no jobs for your profile/i);
    expect(match.speakScript).not.toMatch(/JD|survived/i);
    expect(match.note).not.toMatch(/JD|survived/i);
  });

  it("honours several outcomes at once", () => {
    // Serving notice is a hold, not a block, so a weekend-off + WFH candidate
    // still gets an opening that satisfies both preferences.
    const match = matchIntakeJobs(candidate({ englishCommunication: "VERY_GOOD" }), {
      dispositionIds: ["need_weekend_off", "work_from_home", "serving_notice"],
      answers: {
        work_from_home: { willing_to_work_from_office: "No" },
        serving_notice: { notice_period: "30 Days" },
      },
    });
    if (match.proposed) {
      expect(match.proposed.weekendOff).toBe(true);
      expect(match.proposed.workFromHome).toBe(true);
    } else {
      expect(match.blocked).toBe(false);
    }
  });

  it("blocks as soon as any one outcome rules out a lineup", () => {
    const match = matchIntakeJobs(candidate(), {
      dispositionIds: ["need_weekend_off", "not_interested"],
      answers: {},
    });
    expect(match.blocked).toBe(true);
    expect(match.proposed).toBeNull();
  });

  it("blocks a live Poor English read even if the form rating is still Good", () => {
    const match = matchIntakeJobs(candidate(), {
      dispositionIds: [],
      answers: {},
      english: { rating: "Poor", confidence: 0.6, evidence: ["short answers"], samples: 3 },
    });
    expect(match.proposed).toBeNull();
    expect(match.blocked).toBe(true);
  });

  it("still matches an outstation candidate who will relocate", () => {
    const match = matchIntakeJobs(candidate({ city: "CHENNAI", jobCity: "BANGALORE" }), {
      dispositionIds: ["out_station_candidate"],
      answers: { out_station_candidate: { will_relocate: "Yes", candidate_location: "CHENNAI" } },
    });
    expect(match.blocked).toBe(false);
    expect(match.proposed).toBeTruthy();
  });

  it("treats night shift as the same pool as US voice jobs", () => {
    const match = matchIntakeJobs(candidate({ shiftBase: "NIGHT_ONLY" }), { dispositionIds: [], answers: {} });
    expect(match.proposed).toBeTruthy();
    expect(match.blocked).toBe(false);
  });
});

describe("closeLineForNoJob", () => {
  it("tells the candidate no jobs matched and why, without JD jargon", () => {
    const line = closeLineForNoJob("you need work from home and these openings are office-based");
    expect(line).toMatch(/no jobs for your profile/i);
    expect(line).toMatch(/work from home/i);
    expect(line).not.toMatch(/JD|survived|filter/i);
    expect(noMatchCloseFromSubmitResult(
      "NO_JOB_MATCH\nReason: shift\nSay: Right now there are no jobs for your profile that are matched. That is because of shift.\nThen call end_call.",
    )).toMatch(/no jobs for your profile/i);
  });
});
