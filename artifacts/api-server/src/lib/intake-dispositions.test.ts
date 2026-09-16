import { describe, it, expect } from "vitest";
import {
  INTAKE_DISPOSITIONS,
  applyDispositionPatch,
  getIntakeDisposition,
  missingDispositionFields,
  parseIntakeExtra,
} from "./intake-dispositions.js";

describe("intake dispositions", () => {
  it("loads every client disposition", () => {
    expect(INTAKE_DISPOSITIONS.map((d) => d.id)).toEqual([
      "poor_communication",
      "non_hiring_zone",
      "not_interested",
      "high_salary",
      "age_limit",
      "career_gap",
      "no_company",
      "voice_mail",
      "other_domain_experience",
      "busy_call_me_back",
      "work_from_home",
      "out_station_candidate",
      "shift_issues",
      "non_hiring_university",
      "no_education_documents",
      "call_disconnected",
      "cooling_period",
      "need_weekend_off",
      "other_recruiter",
    ]);
  });

  it("keeps the cooling-period supervisor warning", () => {
    expect(getIntakeDisposition("cooling_period")?.warning).toMatch(/Supervisor/);
  });

  it("treats Voice Mail as a disposition with no extra fields", () => {
    const extra = applyDispositionPatch({ dispositionId: null, answers: {} }, { disposition: "Voice Mail" });
    expect(extra.extra.dispositionId).toBe("voice_mail");
    expect(missingDispositionFields(extra.extra)).toEqual([]);
  });
});

describe("applyDispositionPatch", () => {
  it("maps a spoken disposition name and option onto stored values", () => {
    const first = applyDispositionPatch(
      { dispositionId: null, answers: {} },
      { disposition: "poor communication" },
    );
    expect(first.extra.dispositionId).toBe("poor_communication");
    const next = applyDispositionPatch(first.extra, { communication_issue: "language barrier" });
    expect(next.extra.answers.communication_issue).toBe("Language Barrier");
    expect(next.errors).toEqual([]);
  });

  it("clears answers when the disposition changes", () => {
    const extra = applyDispositionPatch(
      { dispositionId: "high_salary", answers: { expected_salary: 50000 } },
      { disposition: "not_interested" },
    );
    expect(extra.extra).toEqual({ dispositionId: "not_interested", answers: {} });
  });

  it("rejects a field that does not belong to the selected disposition", () => {
    const extra = applyDispositionPatch(
      { dispositionId: "voice_mail", answers: {} },
      { expected_salary: 40000 },
    );
    expect(extra.written).toEqual([]);
    expect(extra.errors[0]).toMatchObject({ field: "expected_salary" });
  });

  it("reuses the company list on university and cooling-period fields", () => {
    const uni = applyDispositionPatch(
      { dispositionId: null, answers: {} },
      { disposition: "non_hiring_university", company: "teleperformance" },
    );
    expect(uni.extra.answers.company).toBe("Teleperformance");
    const cooling = applyDispositionPatch(
      { dispositionId: "cooling_period", answers: {} },
      { rejected_company: "24 7 ai" },
    );
    expect(cooling.extra.answers.rejected_company).toBe("[24]7.AI");
  });

  it("lets a select with no options accept free text", () => {
    const picked = applyDispositionPatch(
      { dispositionId: null, answers: {} },
      { disposition: "non_hiring_zone", select_process: "International Voice" },
    );
    expect(picked.extra.answers.select_process).toBe("International Voice");
    expect(picked.errors).toEqual([]);
  });

  it("stores salary as a number and Yes/No radios as the option labels", () => {
    const extra = applyDispositionPatch(
      { dispositionId: "high_salary", answers: {} },
      { expected_salary: "45,000", salary_negotiable: "yes" },
    );
    expect(extra.extra.answers.expected_salary).toBe(45000);
    expect(extra.extra.answers.salary_negotiable).toBe("Yes");
  });

  it("parses callback time in 12-hour speech", () => {
    const extra = applyDispositionPatch(
      { dispositionId: "busy_call_me_back", answers: {} },
      { callback_time: "3:30 pm" },
    );
    expect(extra.extra.answers.callback_time).toBe("15:30");
  });
});

describe("missingDispositionFields", () => {
  it("lists required extra fields once a disposition is picked", () => {
    expect(missingDispositionFields({ dispositionId: "age_limit", answers: {} })).toEqual(["date_of_birth"]);
    expect(missingDispositionFields({
      dispositionId: "age_limit",
      answers: { date_of_birth: "2000-07-20" },
    })).toEqual([]);
  });
});

describe("parseIntakeExtra", () => {
  it("ignores junk left in extra from earlier form sections", () => {
    expect(parseIntakeExtra({ foo: 1 })).toEqual({ dispositionId: null, answers: {} });
    expect(parseIntakeExtra({
      dispositionId: "not_interested",
      answers: { reason: "Already Placed" },
    })).toEqual({
      dispositionId: "not_interested",
      answers: { reason: "Already Placed" },
    });
  });
});
