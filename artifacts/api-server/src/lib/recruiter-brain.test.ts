import { describe, expect, it } from "vitest";
import {
  compactKnownFacts,
  decideNext,
  emptyRecruiterProfile,
  extractFacts,
  rankJobs,
  sanitizeIntakeWrite,
} from "./recruiter-brain.js";

describe("RecruiterBrain", () => {
  it("asks one question and skips a known job preference", () => {
    const first = decideNext(emptyRecruiterProfile());
    expect(first.state).toBe("JOB_PREFERENCE");
    expect(first.question).toMatch(/job/i);
    expect(first.outcome).toBe("CONTINUE");

    const afterJob = decideNext(
      { ...emptyRecruiterProfile(), ...first.profile_patch, current_state: first.state },
      "I am looking for a BPO voice process",
    );
    expect(afterJob.profile_patch.wants_bpo).toBe(true);
    expect(afterJob.state).not.toBe("JOB_PREFERENCE");
    expect(afterJob.reason).toMatch(/skip re-ask|city unknown|advance/i);
    expect(afterJob.question).toBeTruthy();
    expect(afterJob.question).not.toMatch(/what kind of job/i);
  });

  it("disqualifies non-BPO", () => {
    const d = decideNext(emptyRecruiterProfile(), "I want a Java developer work from home job");
    expect(d.outcome).toBe("DISQUALIFIED");
    expect(d.profile_patch.disqualify_reason).toBe("not_bpo");
    expect(d.question).toMatch(/only hire BPO/i);
  });

  it("disqualifies Bangalore-or-relocate no", () => {
    const city = decideNext(
      { ...emptyRecruiterProfile(), wants_bpo: true, job_preference: "BPO", current_state: "CITY" },
      "I am in Hyderabad",
    );
    expect(city.state).toBe("RELOCATION");
    const no = decideNext(
      {
        ...emptyRecruiterProfile(),
        wants_bpo: true,
        job_preference: "BPO",
        city: "Hyderabad",
        in_bangalore: false,
        current_state: "RELOCATION",
      },
      "No I cannot relocate",
    );
    expect(no.outcome).toBe("DISQUALIFIED");
    expect(no.profile_patch.disqualify_reason).toBe("no_relocate");
  });

  it("does not invent a salary Moshi mentioned", () => {
    const profile = emptyRecruiterProfile();
    const facts = extractFacts("I live in Bangalore and want BPO", profile);
    expect(facts.expected_salary).toBeUndefined();
    expect(facts.last_ctc).toBeUndefined();
    const cleaned = sanitizeIntakeWrite(
      { firstName: "Ravi", expectedSalary: "8 LPA", ctc: "8 LPA", city: "BANGALORE" },
      { ...profile, ...facts },
    );
    expect(cleaned["expectedSalary"]).toBeUndefined();
    expect(cleaned["ctc"]).toBeUndefined();
    expect(cleaned["firstName"]).toBe("Ravi");
  });

  it("persists salary only when the candidate said it", () => {
    const facts = extractFacts("My last CTC was 3 LPA", emptyRecruiterProfile());
    expect(facts.last_ctc).toMatch(/3/i);
    const d = decideNext(
      { ...emptyRecruiterProfile(), wants_bpo: true, in_bangalore: true, current_state: "SALARY" },
      "My last CTC was 3 LPA and I expect 4 LPA",
    );
    expect(d.profile_patch.last_ctc || d.profile_patch.expected_salary).toBeTruthy();
  });

  it("JobEngine rank is unused by Moshi this slice", () => {
    const ranked = rankJobs(emptyRecruiterProfile());
    expect(ranked.jobs).toEqual([]);
    expect(ranked.speakScript).toBeNull();
  });

  it("compact known facts stay short for session start", () => {
    const line = compactKnownFacts({
      current_state: "CITY",
      wants_bpo: true,
      job_preference: "international voice",
      city: "Bangalore",
      in_bangalore: true,
    });
    expect(line).toContain("bpo=yes");
    expect(line).toContain("Bangalore");
    expect(line.length).toBeLessThan(400);
  });
});
