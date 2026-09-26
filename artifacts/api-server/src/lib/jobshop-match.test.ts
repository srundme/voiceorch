import { describe, expect, it } from "vitest";
import { emptyJobshopProfile, matchJobshopProfile } from "./jobshop-match.js";

const voiceCandidate = {
  first_name: "Shiva",
  city: "Bangalore",
  birth_year: 2000,
  tenth_year: 2015,
  twelfth_year: 2017,
  degree_year: 2021,
  qualification: "Graduate",
  experience_years: 2,
  skills: "international voice, customer care",
  shift: "US shift",
  expected_monthly_salary: 30000,
  english: "Good",
};

describe("jobshop match", () => {
  it("saves a partial profile and does not name a job yet", () => {
    const first = matchJobshopProfile(emptyJobshopProfile(), { city: "Bengaluru", first_name: "Shiva" });
    expect(first.speech).toContain("PROFILE_SAVED");
    expect(first.speech).toContain("Do not name a job");
    expect(first.matches).toEqual([]);
    expect(first.profile.city).toBe("Bengaluru");
    expect(first.profile.firstName).toBe("Shiva");
  });

  it("pitches Bangalore voice-process jobs and skips a UK-only seat", () => {
    const result = matchJobshopProfile(emptyJobshopProfile(), voiceCandidate);
    const ids = result.matches.map((match) => match.jobId);
    expect(ids).toContain("cnx-us-care-manyata");
    expect(ids).not.toContain("startek-uk-bellandur");
    expect(ids).not.toContain("cnx-fresher-whitefield");
    expect(result.speech).toContain("Concentrix");
    expect(result.speech).toContain("US shift");
    expect(result.speech).toContain("₹28,000 to ₹38,000");
    expect(result.speech).not.toContain("Java Spring");
    expect(result.speech).toContain("Speak only these jobs");
  });

  it("keeps earlier answers when the next call fills the rest", () => {
    const first = matchJobshopProfile(emptyJobshopProfile(), { city: "Chennai", birth_year: 2000 });
    const second = matchJobshopProfile(first.profile, voiceCandidate);
    expect(second.profile.birthYear).toBe(2000);
    expect(second.profile.city).toBe("Bangalore");
    expect(second.matches.length).toBeGreaterThan(0);
  });

  it("flags a 10th year that is late for the birth year", () => {
    const result = matchJobshopProfile(emptyJobshopProfile(), {
      ...voiceCandidate,
      tenth_year: 2018,
    });
    expect(result.speech).toContain("10th at age 18");
  });

  it("flags a 12th that is more than two years after 10th", () => {
    const result = matchJobshopProfile(emptyJobshopProfile(), {
      ...voiceCandidate,
      tenth_year: 2015,
      twelfth_year: 2019,
    });
    expect(result.speech).toContain("12th after 10th: 2 years longer");
  });

  it("says there is no opening outside Bangalore", () => {
    const result = matchJobshopProfile(emptyJobshopProfile(), {
      ...voiceCandidate,
      city: "Delhi",
    });
    expect(result.matches).toEqual([]);
    expect(result.speech).toContain("NO_OPENING");
  });
});
