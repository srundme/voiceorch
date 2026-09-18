import { describe, it, expect } from "vitest";
import {
  DISPOSITION_MEANINGS,
  INTAKE_DISPOSITIONS,
  applyDispositionPatch,
  expandDispositionToolArgs,
  getIntakeDisposition,
  missingDispositionFields,
  parseIntakeExtra,
  primaryDispositionId,
  type IntakeExtra,
} from "./intake-dispositions.js";

const empty = (): IntakeExtra => ({ dispositionIds: [], answers: {} });

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
      "no_experience_documents",
      "serving_notice",
      "line_up_scheduled",
    ]);
  });

  it("explains when every outcome applies", () => {
    for (const d of INTAKE_DISPOSITIONS) {
      expect(DISPOSITION_MEANINGS[d.id], `missing meaning for ${d.id}`).toBeTruthy();
    }
  });

  it("keeps the cooling-period supervisor warning", () => {
    expect(getIntakeDisposition("cooling_period")?.warning).toMatch(/Supervisor/);
  });

  it("asks for a last working day when the candidate is serving notice", () => {
    expect(getIntakeDisposition("serving_notice")?.fields.map((f) => f.id)).toEqual([
      "notice_period",
      "last_working_day",
      "notice_remarks",
    ]);
  });

  it("treats Voice Mail as a disposition with no extra fields", () => {
    const extra = applyDispositionPatch(empty(), { disposition: "Voice Mail" });
    expect(extra.extra.dispositionIds).toEqual(["voice_mail"]);
    expect(missingDispositionFields(extra.extra)).toEqual([]);
  });
});

describe("applyDispositionPatch", () => {
  it("maps a spoken disposition name and option onto stored values", () => {
    const first = applyDispositionPatch(empty(), { disposition: "poor communication" });
    expect(first.extra.dispositionIds).toEqual(["poor_communication"]);
    const next = applyDispositionPatch(first.extra, { communication_issue: "language barrier" });
    expect(next.extra.answers["poor_communication"]?.communication_issue).toBe("Language Barrier");
    expect(next.errors).toEqual([]);
  });

  it("keeps earlier outcomes when another one is added", () => {
    const wfh = applyDispositionPatch(empty(), { disposition: "work_from_home" });
    const both = applyDispositionPatch(wfh.extra, { disposition: "serving_notice", notice_period: "30 Days" });
    expect(both.extra.dispositionIds).toEqual(["work_from_home", "serving_notice"]);
    expect(both.extra.answers["serving_notice"]?.notice_period).toBe("30 Days");
    expect(both.written).toContain("serving_notice.notice_period");
  });

  it("keeps same-named answers apart across outcomes", () => {
    let extra = applyDispositionPatch(empty(), {
      disposition: "not_interested",
      reason: "Already Placed",
    }).extra;
    extra = applyDispositionPatch(extra, {
      disposition: "work_from_home",
      reason: "Travel Issues",
    }).extra;
    expect(extra.answers["not_interested"]?.reason).toBe("Already Placed");
    expect(extra.answers["work_from_home"]?.reason).toBe("Travel Issues");
  });

  it("routes a dotted key to the outcome it names, whichever is targeted", () => {
    let extra = applyDispositionPatch(empty(), { disposition: ["age_limit", "career_gap"] }).extra;
    extra = applyDispositionPatch(extra, {
      "age_limit.date_of_birth": "20 July 2000",
      "career_gap.date_of_birth": "1999-01-05",
    }).extra;
    expect(extra.answers["age_limit"]?.date_of_birth).toBe("2000-07-20");
    expect(extra.answers["career_gap"]?.date_of_birth).toBe("1999-01-05");
  });

  it("refuses a bare shared key when several outcomes could own it", () => {
    const extra = applyDispositionPatch(empty(), { disposition: ["not_interested", "no_company"] }).extra;
    const result = applyDispositionPatch(extra, { reason: "Other" });
    expect(result.written).toEqual([]);
    expect(result.errors[0]).toMatchObject({ field: "reason" });
  });

  it("replaces the list, and drops answers for outcomes removed from it", () => {
    const extra = applyDispositionPatch(empty(), { disposition: "high_salary", expected_salary: 50000 }).extra;
    const cleared = applyDispositionPatch(extra, { disposition: ["not_interested"] });
    expect(cleared.extra.dispositionIds).toEqual(["not_interested"]);
    expect(cleared.extra.answers["high_salary"]).toBeUndefined();
  });

  it("clears everything when the outcome is unset", () => {
    const extra = applyDispositionPatch(empty(), { disposition: "high_salary", expected_salary: 50000 }).extra;
    const cleared = applyDispositionPatch(extra, { disposition: null });
    expect(cleared.extra.dispositionIds).toEqual([]);
    expect(cleared.extra.answers).toEqual({});
  });

  it("rejects a field that does not belong to the selected disposition", () => {
    const extra = applyDispositionPatch(
      { dispositionIds: ["voice_mail"], answers: {} },
      { expected_salary: 40000 },
    );
    expect(extra.written).toEqual([]);
    expect(extra.errors[0]).toMatchObject({ field: "expected_salary" });
  });

  it("reuses the company list on university and cooling-period fields", () => {
    const uni = applyDispositionPatch(empty(), {
      disposition: "non_hiring_university",
      company: "teleperformance",
    });
    expect(uni.extra.answers["non_hiring_university"]?.company).toBe("Teleperformance");
    const cooling = applyDispositionPatch(
      { dispositionIds: ["cooling_period"], answers: {} },
      { rejected_company: "24 7 ai" },
    );
    expect(cooling.extra.answers["cooling_period"]?.rejected_company).toBe("[24]7.AI");
  });

  it("lets a select with no options accept free text", () => {
    const picked = applyDispositionPatch(empty(), {
      disposition: "non_hiring_zone",
      select_process: "International Voice",
    });
    expect(picked.extra.answers["non_hiring_zone"]?.select_process).toBe("International Voice");
    expect(picked.errors).toEqual([]);
  });

  it("stores salary as a number and Yes/No radios as the option labels", () => {
    const extra = applyDispositionPatch(
      { dispositionIds: ["high_salary"], answers: {} },
      { expected_salary: "45,000", salary_negotiable: "yes" },
    );
    expect(extra.extra.answers["high_salary"]?.expected_salary).toBe(45000);
    expect(extra.extra.answers["high_salary"]?.salary_negotiable).toBe("Yes");
  });

  it("parses callback time in 12-hour speech", () => {
    const extra = applyDispositionPatch(
      { dispositionIds: ["busy_call_me_back"], answers: {} },
      { callback_time: "3:30 pm" },
    );
    expect(extra.extra.answers["busy_call_me_back"]?.callback_time).toBe("15:30");
  });

  it("parses a line-up schedule", () => {
    const extra = applyDispositionPatch(empty(), {
      disposition: "line_up_scheduled",
      scheduled_date: "2 October 2026",
      scheduled_time: "10 am",
      scheduled_round: "hr round",
    });
    expect(extra.extra.answers["line_up_scheduled"]).toEqual({
      scheduled_date: "2026-10-02",
      scheduled_time: "10:00",
      scheduled_round: "HR Round",
    });
  });

  it("flattens a nested object keyed by the outcome id (call 25221)", () => {
    const result = applyDispositionPatch(empty(), {
      work_from_home: {
        reason: "Personal Reasons",
        willing_to_work_from_office: "Yes",
      },
    });
    expect(result.errors).toEqual([]);
    expect(result.extra.dispositionIds).toEqual(["work_from_home"]);
    expect(result.extra.answers["work_from_home"]).toEqual({
      reason: "Personal Reasons",
      willing_to_work_from_office: "Yes",
    });
    expect(missingDispositionFields(result.extra)).toEqual([]);
  });

  it("flattens a JSON string keyed by the outcome id after the outcome is already recorded", () => {
    const recorded = applyDispositionPatch(empty(), { disposition: "work_from_home" }).extra;
    const result = applyDispositionPatch(recorded, {
      work_from_home: '{"reason": "Personal Reasons", "willing_to_work_from_office": "Yes"}',
    });
    expect(result.errors).toEqual([]);
    expect(result.extra.dispositionIds).toEqual(["work_from_home"]);
    expect(result.extra.answers["work_from_home"]).toEqual({
      reason: "Personal Reasons",
      willing_to_work_from_office: "Yes",
    });
  });

  it("flattens nested JSON even when disposition is already in the same payload", () => {
    const result = applyDispositionPatch(empty(), {
      disposition: "work_from_home",
      work_from_home: '{"reason": "Personal Reasons", "willing_to_work_from_office": "No"}',
    });
    expect(result.errors).toEqual([]);
    expect(result.extra.answers["work_from_home"]).toEqual({
      reason: "Personal Reasons",
      willing_to_work_from_office: "No",
    });
  });
});

describe("expandDispositionToolArgs", () => {
  it("implies disposition from a nested outcome-id key", () => {
    expect(expandDispositionToolArgs({
      work_from_home: { reason: "Travel Issues" },
    })).toEqual({
      disposition: "work_from_home",
      "work_from_home.reason": "Travel Issues",
    });
  });
});

describe("missingDispositionFields", () => {
  it("lists required extra fields once a disposition is picked", () => {
    expect(missingDispositionFields({ dispositionIds: ["age_limit"], answers: {} }))
      .toEqual(["age_limit.date_of_birth"]);
    expect(missingDispositionFields({
      dispositionIds: ["age_limit"],
      answers: { age_limit: { date_of_birth: "2000-07-20" } },
    })).toEqual([]);
  });

  it("spans every recorded outcome", () => {
    expect(missingDispositionFields({
      dispositionIds: ["age_limit", "no_experience_documents"],
      answers: {},
    })).toEqual(["age_limit.date_of_birth", "no_experience_documents.document_type"]);
  });
});

describe("parseIntakeExtra", () => {
  it("ignores junk left in extra from earlier form sections", () => {
    expect(parseIntakeExtra({ foo: 1 })).toMatchObject({ dispositionIds: [], answers: {} });
  });

  it("lifts a pre-multi row into the list shape", () => {
    const extra = parseIntakeExtra({
      dispositionId: "not_interested",
      answers: { reason: "Already Placed" },
    });
    expect(extra.dispositionIds).toEqual(["not_interested"]);
    expect(extra.answers).toEqual({ not_interested: { reason: "Already Placed" } });
    expect(primaryDispositionId(extra)).toBe("not_interested");
  });

  it("round-trips the nested shape", () => {
    const extra = parseIntakeExtra({
      dispositionIds: ["work_from_home", "serving_notice"],
      answers: {
        work_from_home: { reason: "Travel Issues" },
        serving_notice: { notice_period: "30 Days" },
      },
    });
    expect(extra.dispositionIds).toEqual(["work_from_home", "serving_notice"]);
    expect(extra.answers["serving_notice"]?.notice_period).toBe("30 Days");
  });

  it("keeps a stored English read", () => {
    const extra = parseIntakeExtra({
      dispositionIds: [],
      english: { rating: "Very good", confidence: 0.8, evidence: ["full sentences"], samples: 4 },
    });
    expect(extra.english).toEqual({
      rating: "Very good",
      confidence: 0.8,
      evidence: ["full sentences"],
      samples: 4,
    });
  });

  it("drops an unrecognised English rating rather than trusting it", () => {
    expect(parseIntakeExtra({ english: { rating: "Amazing" } }).english).toBeNull();
  });

  it("keeps last company and tenure on the recruiter screen", () => {
    const extra = parseIntakeExtra({
      dispositionIds: [],
      screen: { pincode: "560001", lastCompany: "Infosys", tenure: "2 years" },
    });
    expect(extra.screen).toMatchObject({
      pincode: "560001",
      lastCompany: "Infosys",
      tenure: "2 years",
    });
  });

  it("keeps RecruiterBrain facts under extra.recruiter", () => {
    const extra = parseIntakeExtra({
      dispositionIds: [],
      recruiter: { current_state: "CITY", wants_bpo: true, city: "Bangalore" },
    });
    expect(extra.recruiter).toMatchObject({
      current_state: "CITY",
      wants_bpo: true,
      city: "Bangalore",
    });
  });
});
