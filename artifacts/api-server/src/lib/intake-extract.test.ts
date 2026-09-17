import { describe, expect, it } from "vitest";
import { extractIntakePatchFromTurn } from "./intake-extract.js";

describe("extractIntakePatchFromTurn", () => {
  it("does not treat discovery speech as a name", () => {
    expect(extractIntakePatchFromTurn({
      transcript: "I saw your ad and I am looking for a job",
      waitingOn: ["first name", "city they live in"],
      lastAgentText: "Hello this is Irfan from the Jobshop, how may I assist you?",
    })).toEqual({});
  });

  it("saves a volunteered Bangalore place during discovery", () => {
    expect(extractIntakePatchFromTurn({
      transcript: "I live in Bengalore",
      waitingOn: ["first name", "city they live in"],
      lastAgentText: "How may I assist you?",
    }).city).toBe("BANGALORE");
  });

  it("saves the name only after the agent asks for it", () => {
    const patch = extractIntakePatchFromTurn({
      transcript: "Karthikeyan Sru",
      waitingOn: ["first name", "last name", "city they live in"],
      lastAgentText: "Okay so I need a few details to match the right opening. Shall I start with your name?",
    });
    expect(patch.firstName).toBe("Karthikeyan");
    expect(patch.lastName).toBe("Sru");
  });

  it("saves my name is without waiting on an ask", () => {
    const patch = extractIntakePatchFromTurn({
      transcript: "My name is Gopi Kumar",
      waitingOn: ["first name"],
      lastAgentText: "How may I assist you?",
    });
    expect(patch.firstName).toBe("Gopi");
    expect(patch.lastName).toBe("Kumar");
  });

  it("treats HSR Layout as a Bangalore area city", () => {
    expect(extractIntakePatchFromTurn({
      transcript: "HSR Layout",
      waitingOn: ["city they live in"],
      lastAgentText: "Which city or area do you live in?",
    }).city).toBe("HSR LAYOUT");
  });

  it("saves tenure and company from one turn", () => {
    const patch = extractIntakePatchFromTurn({
      transcript: "I have been at Infosys for two years",
      waitingOn: ["lastCompany", "tenure"],
      lastAgentText: "Where do you work now and how long have you been there?",
    });
    expect(patch.lastCompany).toBe("Infosys");
    expect(patch.tenure).toBe("2 years");
  });

  it("maps spoken notice onto the dropdown and servingNotice", () => {
    const patch = extractIntakePatchFromTurn({
      transcript: "Yes I am serving 30 days notice",
      waitingOn: ["servingNotice"],
      lastAgentText: "Are you currently serving notice?",
    });
    expect(patch.servingNotice).toBe("yes");
    expect(patch.noticePeriod).toBe("30 Days");
  });

  it("saves relocate as Yes on the outstation outcome", () => {
    const patch = extractIntakePatchFromTurn({
      transcript: "yes",
      waitingOn: ["out_station_candidate.will_relocate"],
      lastAgentText: "Will you relocate to Bangalore?",
    });
    expect(patch["out_station_candidate.will_relocate"]).toBe("Yes");
    expect(patch.disposition).toBe("out_station_candidate");
  });

  it("saves a spelled email whenever it is present", () => {
    expect(extractIntakePatchFromTurn({
      transcript: "g o p i at gmail.com",
      waitingOn: ["email"],
      lastAgentText: "What is your email?",
    }).email).toBe("gopi@gmail.com");
  });

  it("saves fresher work status", () => {
    expect(extractIntakePatchFromTurn({
      transcript: "I am a fresher",
      waitingOn: ["fresher or experienced"],
      lastAgentText: "Are you a fresher or already working?",
    }).workStatus).toBe("FRESHER");
  });

  it("confirms Bangalore job city with yes", () => {
    expect(extractIntakePatchFromTurn({
      transcript: "yes",
      waitingOn: ["job city"],
      lastAgentText: "You live in Bangalore — you want to work there?",
    }).jobCity).toBe("BANGALORE");
  });

  it("does not treat a surname as a city while last name is the question", () => {
    expect(extractIntakePatchFromTurn({
      transcript: "Kumar",
      waitingOn: ["last name", "email", "city they live in"],
      lastAgentText: "And your last name?",
    })).toEqual({ lastName: "Kumar" });
  });

  it("unchecks WFH when they say they will come to the office", () => {
    const patch = extractIntakePatchFromTurn({
      transcript: "I don't work from home. I am ready to come to the office",
      waitingOn: ["work_from_home", "work_from_home.reason"],
      lastAgentText: "What is the reason you need work from home?",
    });
    expect(patch.wantsWfh).toBe("no");
    expect(patch["work_from_home.willing_to_work_from_office"]).toBe("Yes");
  });

  it("saves 15 days notice and last working day 28 with a remark", () => {
    const patch = extractIntakePatchFromTurn({
      transcript: "My notice period is 15 days but my last working day is 28",
      waitingOn: ["servingNotice"],
      lastAgentText: "Are you serving notice?",
    });
    expect(patch.servingNotice).toBe("yes");
    expect(patch.noticePeriod).toBe("15 Days");
    expect(String(patch.lastWorkingDay)).toMatch(/^\d{4}-\d{2}-28$/);
    expect(String(patch.noticeRemarks)).toMatch(/Notice 15 Days/i);
    expect(String(patch.noticeRemarks)).toMatch(/last working day/i);
  });

  it("marks night and evening in one yes", () => {
    expect(extractIntakePatchFromTurn({
      transcript: "yes",
      waitingOn: ["shift they can work"],
      lastAgentText: "Can you do night shift and evening shift?",
    }).shiftBase).toBe("US");
  });

  it("saves one company last year as count, name wait stays next", () => {
    const patch = extractIntakePatchFromTurn({
      transcript: "I worked with one company last year",
      waitingOn: ["number of companies"],
      lastAgentText: "How many companies have you worked with?",
    });
    expect(patch.totalCompanies).toBe(1);
    expect(patch.tenure).toBe("1 year");
  });
});
