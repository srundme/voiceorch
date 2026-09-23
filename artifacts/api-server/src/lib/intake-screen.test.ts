import { describe, it, expect } from "vitest";
import type { IntakeExtra } from "./intake-dispositions.js";
import { evaluateIntakeScreen, isBangalorePlace, isBangalorePincode, nonHiringAreaForPincode, parseLastCompany, parsePincode, parseScreenFlag, parseScreenYesNo, parseTenure } from "./intake-screen.js";

const emptyExtra = (): IntakeExtra => ({ dispositionIds: [], answers: {} });

const screened = {
  firstName: "Gopi",
  lastName: "Kumar",
  phone: "9876543210",
  email: "gopi@test.com",
  gender: "MALE" as const,
  dateOfBirth: "1998-07-20",
  workStatus: "FRESHER" as const,
  totalCompanies: 0,
  city: "BANGALORE",
  jobCity: "BANGALORE",
  qualification: "GRADUATE" as const,
  shiftBase: "US" as const,
  dnd: "DEACTIVATE" as const,
};

const flagsNo: IntakeExtra = {
  dispositionIds: [],
  answers: {},
  screen: {
    servingNotice: "no",
    wantsWfh: "no",
    needsWeekendOff: "no",
    hasCareerGap: "no",
    otherDomain: "no",
    missingEduDocs: "no",
    missingExpDocs: "no",
    pincode: "560001",
  },
};

describe("isBangalorePlace", () => {
  it("treats local areas as Bangalore", () => {
    expect(isBangalorePlace("Whitefield")).toBe(true);
    expect(isBangalorePlace("HSR Layout")).toBe(true);
    expect(isBangalorePlace("Bengaluru")).toBe(true);
    expect(isBangalorePlace("Chennai")).toBe(false);
  });
});

describe("parsePincode", () => {
  it("reads digits and spoken digits", () => {
    expect(parsePincode("560001")).toBe("560001");
    expect(parsePincode("pin code 560 001")).toBe("560001");
    expect(parsePincode("five six zero zero zero one")).toBe("560001");
    expect(parsePincode("five six zero double zero five")).toBe("560005");
    expect(parsePincode("See, my PIN code is 560005.")).toBe("560005");
    expect(parsePincode("not a pin")).toBeNull();
  });

  it("does not slice a 7-digit STT run into the wrong PIN (call 25244)", () => {
    expect(parsePincode("5600005")).toBeNull();
    expect(parsePincode("No, 5656005")).toBeNull();
    expect(parsePincode("600")).toBeNull();
    expect(parsePincode("600 zero one")).toBeNull();
  });
});

describe("parseLastCompany", () => {
  it("keeps the company name and strips I-work-at padding", () => {
    expect(parseLastCompany("Infosys")).toBe("Infosys");
    expect(parseLastCompany("I work at Infosys")).toBe("Infosys");
    expect(parseLastCompany("[24]7.AI")).toBe("[24]7.AI");
    expect(parseLastCompany("yes")).toBeNull();
    expect(parseLastCompany("a")).toBeNull();
  });
});

describe("parseTenure", () => {
  it("reads years, months, and number words", () => {
    expect(parseTenure("2 years")).toBe("2 years");
    expect(parseTenure("two years")).toBe("2 years");
    expect(parseTenure("18 months")).toBe("1 year 6 months");
    expect(parseTenure("2.5 years")).toBe("2 years 6 months");
    expect(parseTenure("6 months")).toBe("6 months");
    expect(parseTenure("2")).toBe("2 years");
    expect(parseTenure("not a tenure")).toBeNull();
  });
});

describe("Bangalore vs non-hiring pincodes", () => {
  it("treats 560 and 562 as Bangalore", () => {
    expect(isBangalorePincode("560001")).toBe(true);
    expect(isBangalorePincode("562114")).toBe(true);
    expect(isBangalorePincode("600001")).toBe(false);
    expect(isBangalorePincode("577201")).toBe(false);
  });

  it("maps Shimoga pins onto the form areas", () => {
    expect(nonHiringAreaForPincode("577201")).toBe("Gopala Extension, Shimoga - Karnataka");
    expect(nonHiringAreaForPincode("577211")).toBe("Purudal, Shimoga - Karnataka");
    expect(nonHiringAreaForPincode("577220")).toBe("Others");
    expect(nonHiringAreaForPincode("560001")).toBeNull();
  });
});

describe("parseScreenYesNo", () => {
  it("reads recruiter yes/no phrasing", () => {
    expect(parseScreenYesNo("yeah")).toBe("yes");
    expect(parseScreenYesNo("nope")).toBe("no");
    expect(parseScreenYesNo("work from office")).toBe("no");
    expect(parseScreenYesNo("I need WFH")).toBe("yes");
  });

  it("reads a spoken answer for that question only", () => {
    expect(parseScreenFlag("wantsWfh", "I can come to the office")).toBe("no");
    expect(parseScreenFlag("wantsWfh", "I need work from home")).toBe("yes");
    expect(parseScreenFlag("servingNotice", "I am not serving notice")).toBe("no");
    expect(parseScreenFlag("servingNotice", "I can come to the office")).toBeNull();
    expect(parseScreenFlag("needsWeekendOff", "rotational week offs are fine")).toBe("no");
    expect(parseScreenFlag("missingEduDocs", "I can share my certificates")).toBe("no");
    expect(parseScreenFlag("otherDomain", "I have voice process experience")).toBe("no");
  });
});

describe("evaluateIntakeScreen", () => {
  it("starts with the name", () => {
    const cue = evaluateIntakeScreen({
      ...screened,
      firstName: null,
      lastName: null,
      email: null,
      dateOfBirth: null,
      workStatus: null,
      totalCompanies: null,
      city: null,
      jobCity: null,
      qualification: null,
      shiftBase: null,
    }, emptyExtra());
    expect(cue.canFinish).toBe(false);
    expect(cue.pitchAllowed).toBe(false);
    expect(cue.instruction).toMatch(/name/i);
    expect(cue.instruction).toMatch(/why they called/i);
    expect(cue.instruction).toMatch(/skip the name if they already gave it/i);
  });

  it("asks pincode after city, before treating them as outstation", () => {
    const cue = evaluateIntakeScreen({
      ...screened,
      city: "CHENNAI",
      jobCity: null,
      email: null,
    }, emptyExtra());
    expect(cue.waitingOn).toContain("pincode");
    expect(cue.instruction).toMatch(/pincode/i);
  });

  it("opens relocate when the pincode is not Bangalore", () => {
    const cue = evaluateIntakeScreen({
      ...screened,
      city: "CHENNAI",
      jobCity: null,
      email: null,
    }, { dispositionIds: [], answers: {}, screen: { pincode: "600001" } });
    expect(cue.waitingOn).toContain("out_station_candidate");
    expect(cue.instruction).toMatch(/relocate|pincode is not Bangalore/i);
  });

  it("opens non_hiring_zone for a Shimoga pincode", () => {
    const cue = evaluateIntakeScreen({
      ...screened,
      city: "SHIMOGA",
      jobCity: null,
    }, { dispositionIds: [], answers: {}, screen: { pincode: "577201" } });
    expect(cue.waitingOn).toContain("non_hiring_zone");
  });

  it("blocks pitch when they will not relocate", () => {
    const cue = evaluateIntakeScreen({
      ...screened,
      city: "CHENNAI",
      jobCity: "BANGALORE",
    }, {
      ...flagsNo,
      screen: { ...flagsNo.screen, pincode: "600001" },
      dispositionIds: ["out_station_candidate"],
      answers: { out_station_candidate: { candidate_location: "CHENNAI", will_relocate: "No" } },
    });
    expect(cue.killReason).toBe("will_not_relocate");
    expect(cue.pitchAllowed).toBe(false);
  });

  it("skips notice and experience letters for a fresher", () => {
    const cue = evaluateIntakeScreen({
      ...screened,
      email: null,
    }, { dispositionIds: [], answers: {}, screen: { pincode: "560001" } });
    expect(cue.waitingOn.join(" ")).not.toMatch(/servingNotice|missingExpDocs|hasCareerGap/);
    expect(cue.instruction).toMatch(/graduate|education|shift|email|office|weekend|document/i);
  });

  it("unlocks serving notice for experienced candidates", () => {
    const cue = evaluateIntakeScreen({
      ...screened,
      workStatus: "EXPERIENCED",
      totalCompanies: 2,
    }, { dispositionIds: [], answers: {}, screen: { pincode: "560001" } });
    expect(cue.waitingOn).toContain("servingNotice");
  });

  it("asks company and tenure after they say they are experienced", () => {
    const cue = evaluateIntakeScreen({
      ...screened,
      workStatus: "EXPERIENCED",
      totalCompanies: 2,
    }, { dispositionIds: [], answers: {}, screen: { pincode: "560001" } });
    expect(cue.waitingOn).toContain("lastCompany");
    expect(cue.waitingOn).toContain("tenure");
    expect(cue.instruction).toMatch(/company|tenure|working/i);
    expect(cue.canFinish).toBe(false);
  });

  it("lets an experienced Bangalore candidate finish once company and tenure are in", () => {
    const cue = evaluateIntakeScreen({
      ...screened,
      workStatus: "EXPERIENCED",
      totalCompanies: 2,
    }, {
      dispositionIds: [],
      answers: {},
      screen: { ...flagsNo.screen, lastCompany: "Infosys", tenure: "2 years" },
    });
    expect(cue.waitingOn).not.toContain("lastCompany");
    expect(cue.waitingOn).not.toContain("tenure");
    expect(cue.canFinish).toBe(true);
    expect(cue.pitchAllowed).toBe(true);
  });

  it("lets a fully screened Bangalore fresher finish and pitch", () => {
    const cue = evaluateIntakeScreen(screened, flagsNo);
    expect(cue.waitingOn).toEqual([]);
    expect(cue.canFinish).toBe(true);
    expect(cue.pitchAllowed).toBe(true);
  });

  it("refuses finish_intake until the tree is done", () => {
    const cue = evaluateIntakeScreen(screened, {
      dispositionIds: [],
      answers: {},
      screen: {
        pincode: "560001",
        wantsWfh: undefined,
        needsWeekendOff: "no",
        missingEduDocs: "no",
      },
    });
    expect(cue.canFinish).toBe(false);
    expect(cue.waitingOn).toContain("wantsWfh");
  });
});
