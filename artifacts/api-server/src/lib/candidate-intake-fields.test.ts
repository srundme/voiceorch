import { describe, it, expect } from "vitest";
import {
  missingIntakeFields,
  normalizeIntakeField,
  normalizeIntakePatch,
} from "./candidate-intake-fields.js";

describe("normalizeIntakeField", () => {
  it("keeps a spoken name but rejects digits", () => {
    expect(normalizeIntakeField("firstName", "  Mohd   Arbaz ")).toEqual({ ok: true, value: "Mohd Arbaz" });
    expect(normalizeIntakeField("lastName", "Khan 2")).toMatchObject({ ok: false });
  });

  it("strips phone punctuation and holds the country prefix", () => {
    expect(normalizeIntakeField("phone", "+91 91139-62868")).toEqual({ ok: true, value: "+919113962868" });
    expect(normalizeIntakeField("phone", "9113962868")).toEqual({ ok: true, value: "9113962868" });
    expect(normalizeIntakeField("phone", "12345")).toMatchObject({ ok: false });
  });

  it("rebuilds an email that was spelled out loud", () => {
    expect(normalizeIntakeField("email", "marbaazkhan at jobshop dot ai")).toEqual({
      ok: true,
      value: "marbaazkhan@jobshop.ai",
    });
    expect(normalizeIntakeField("email", "MArbaazKhan@JobShop.ai")).toEqual({
      ok: true,
      value: "marbaazkhan@jobshop.ai",
    });
    expect(normalizeIntakeField("email", "not an email")).toMatchObject({ ok: false });
  });

  it("maps spoken gender words onto the enum", () => {
    expect(normalizeIntakeField("gender", "Male")).toEqual({ ok: true, value: "MALE" });
    expect(normalizeIntakeField("gender", "she is a woman")).toMatchObject({ ok: false });
    expect(normalizeIntakeField("gender", "female")).toEqual({ ok: true, value: "FEMALE" });
    expect(normalizeIntakeField("gender", "yes")).toMatchObject({ ok: false });
  });

  it("reads dates day-first and rejects impossible ones", () => {
    expect(normalizeIntakeField("dateOfBirth", "20/07/2000")).toEqual({ ok: true, value: "2000-07-20" });
    expect(normalizeIntakeField("dateOfBirth", "2000-07-20")).toEqual({ ok: true, value: "2000-07-20" });
    expect(normalizeIntakeField("dateOfBirth", "20 July 2000")).toEqual({ ok: true, value: "2000-07-20" });
    expect(normalizeIntakeField("dateOfBirth", "20th Jul 2000")).toEqual({ ok: true, value: "2000-07-20" });
    expect(normalizeIntakeField("dateOfBirth", "July 20, 2000")).toEqual({ ok: true, value: "2000-07-20" });
    expect(normalizeIntakeField("dateOfBirth", "31/02/2000")).toMatchObject({ ok: false });
    expect(normalizeIntakeField("dateOfBirth", "20/07/2099")).toMatchObject({ ok: false });
  });

  it("accepts either work status spelling", () => {
    expect(normalizeIntakeField("workStatus", "fresher")).toEqual({ ok: true, value: "FRESHER" });
    expect(normalizeIntakeField("workStatus", "Experienced")).toEqual({ ok: true, value: "EXPERIENCED" });
    expect(normalizeIntakeField("workStatus", "maybe")).toMatchObject({ ok: false });
  });

  it("counts companies from digits or number words", () => {
    expect(normalizeIntakeField("totalCompanies", "0")).toEqual({ ok: true, value: 0 });
    expect(normalizeIntakeField("totalCompanies", "zero")).toEqual({ ok: true, value: 0 });
    expect(normalizeIntakeField("totalCompanies", "three")).toEqual({ ok: true, value: 3 });
    expect(normalizeIntakeField("totalCompanies", "2.5")).toMatchObject({ ok: false });
    expect(normalizeIntakeField("totalCompanies", "-1")).toMatchObject({ ok: false });
  });

  it("upper-cases city names the way the client's form shows them", () => {
    expect(normalizeIntakeField("city", "bengaluru")).toEqual({ ok: true, value: "BENGALURU" });
    expect(normalizeIntakeField("jobCity", " Hyderabad ")).toEqual({ ok: true, value: "HYDERABAD" });
  });

  it("maps the English communication scale", () => {
    expect(normalizeIntakeField("englishCommunication", "Very good")).toEqual({ ok: true, value: "VERY_GOOD" });
    expect(normalizeIntakeField("englishCommunication", "very_good")).toEqual({ ok: true, value: "VERY_GOOD" });
    expect(normalizeIntakeField("englishCommunication", "terrible")).toMatchObject({ ok: false });
  });

  it("treats blank as clearing the field so a wrong answer can be withdrawn", () => {
    expect(normalizeIntakeField("city", "")).toEqual({ ok: true, value: null });
    expect(normalizeIntakeField("totalCompanies", null)).toEqual({ ok: true, value: null });
  });

  it("keeps skill role, skill and industry locked to this campaign", () => {
    expect(normalizeIntakeField("skillRole", "")).toEqual({ ok: true, value: "EXECUTIVE_SR_EXECUTIVE" });
    expect(normalizeIntakeField("skill", "International Voice Process")).toEqual({
      ok: true,
      value: "INTERNATIONAL_VOICE_PROCESS",
    });
    expect(normalizeIntakeField("industry", "BPO")).toEqual({ ok: true, value: "BPO_CALL_CENTER" });
    expect(normalizeIntakeField("skillRole", "manager")).toMatchObject({ ok: false });
  });

  it("maps qualification and spoken shift names", () => {
    expect(normalizeIntakeField("qualification", "graduate")).toEqual({ ok: true, value: "GRADUATE" });
    expect(normalizeIntakeField("qualification", "post graduation")).toEqual({
      ok: true,
      value: "POST_GRADUATE",
    });
    expect(normalizeIntakeField("qualification", "pg")).toEqual({ ok: true, value: "POST_GRADUATE" });
    expect(normalizeIntakeField("shiftBase", "US Shift")).toEqual({ ok: true, value: "US" });
    expect(normalizeIntakeField("shiftBase", "any shift")).toEqual({ ok: true, value: "ANY" });
    expect(normalizeIntakeField("shiftBase", "night shift only")).toEqual({ ok: true, value: "NIGHT_ONLY" });
    expect(normalizeIntakeField("shiftBase", "rotational")).toEqual({ ok: true, value: "ROTATIONAL" });
    expect(normalizeIntakeField("shiftBase", "evening")).toMatchObject({ ok: false });
  });

  it("marks DND Activate when the candidate is no longer interested", () => {
    expect(normalizeIntakeField("dnd", "Activate")).toEqual({ ok: true, value: "ACTIVATE" });
    expect(normalizeIntakeField("dnd", "not interested")).toEqual({ ok: true, value: "ACTIVATE" });
    expect(normalizeIntakeField("dnd", "Deactivate")).toEqual({ ok: true, value: "DEACTIVATE" });
  });
});

describe("normalizeIntakePatch", () => {
  it("keeps the good fields when one value is misheard", () => {
    const result = normalizeIntakePatch({
      firstName: "Arbaz",
      gender: "banana",
      city: "pune",
    });
    expect(result.values).toEqual({ firstName: "Arbaz", city: "PUNE" });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.field).toBe("gender");
  });

  it("reports an unknown field instead of writing it", () => {
    const result = normalizeIntakePatch({ salary: "50000" });
    expect(result.values).toEqual({});
    expect(result.errors).toEqual([{ field: "salary", message: "Unknown field" }]);
  });
});

describe("missingIntakeFields", () => {
  it("lists what the agent still has to ask and ignores English", () => {
    expect(
      missingIntakeFields({
        firstName: "Arbaz",
        lastName: "Khan",
        phone: "9113962868",
        email: "a@b.ai",
        gender: "MALE",
        dateOfBirth: "2000-07-20",
        workStatus: "FRESHER",
        totalCompanies: 0,
        city: "BENGALURU",
        jobCity: "BENGALURU",
        qualification: "GRADUATE",
        shiftBase: "US",
      }),
    ).toEqual([]);

    expect(missingIntakeFields({ firstName: "Arbaz", city: "   " })).toContain("city");
    expect(missingIntakeFields({})).not.toContain("englishCommunication");
    expect(missingIntakeFields({})).not.toContain("dnd");
    expect(missingIntakeFields({})).not.toContain("skillRole");
    expect(missingIntakeFields({})).toContain("qualification");
    expect(missingIntakeFields({})).toContain("shiftBase");
  });

  it("does not treat zero companies as unanswered", () => {
    expect(missingIntakeFields({ totalCompanies: 0 })).not.toContain("totalCompanies");
  });
});
