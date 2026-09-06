import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";
});

import { buildToolDefs } from "./tool-executor.js";
import type { AgentTool } from "../orchestration/types.js";

const book = (extra: Partial<Extract<AgentTool, { type: "native_booking" }>> = {}): AgentTool => ({
  type: "native_booking",
  name: "book_appointment",
  description: "Book an appointment.",
  ...extra,
});

const check: AgentTool = {
  type: "native_check_availability",
  name: "check_availability",
  description: "Check slots.",
};

describe("buildToolDefs booking email schema", () => {
  it("does not require attendee_email unless the prompt says to collect one", () => {
    const def = buildToolDefs([book(), check]).find((t) => t.name === "book_appointment")!;
    expect(def.parameters.required).toEqual(["attendee_name"]);
    expect(def.parameters.properties).toHaveProperty("attendee_email");
    expect(def.parameters.properties).not.toHaveProperty("email_confirmed");
    expect(def.description).not.toMatch(/CRITICAL RULES|EMAIL CONFIRMATION/);

    const checkDef = buildToolDefs([book(), check]).find((t) => t.name === "check_availability")!;
    expect(checkDef.description).toMatch(/call book_appointment/);
    expect(checkDef.description).not.toMatch(/do not ask for an email/);
  });

  it("requires attendee_email when the prompt says collect and no email is known", () => {
    const def = buildToolDefs([book()], {
      systemPrompt: "Collect the email and book the slot.",
    }).find((t) => t.name === "book_appointment")!;
    expect(def.parameters.required).toEqual(["attendee_name", "attendee_email"]);
    expect(def.parameters.properties).not.toHaveProperty("email_confirmed");
  });

  it("does not require attendee_email when a lead/prompt address already exists", () => {
    const def = buildToolDefs([book()], {
      systemPrompt: "Collect the email. Book to ops@acme.com.",
      knownEmail: "ops@acme.com",
    }).find((t) => t.name === "book_appointment")!;
    expect(def.parameters.required).toEqual(["attendee_name"]);
  });

  it("ignores the leftover collectAttendeeEmail toggle", () => {
    const def = buildToolDefs([book({ collectAttendeeEmail: true })]).find((t) => t.name === "book_appointment")!;
    expect(def.parameters.required).toEqual(["attendee_name"]);
    expect(def.parameters.properties).not.toHaveProperty("email_confirmed");
  });
});
