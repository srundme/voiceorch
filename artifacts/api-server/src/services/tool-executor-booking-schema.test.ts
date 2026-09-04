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
  it("does not require attendee_email unless the tool opts in (call 20423)", () => {
    const def = buildToolDefs([book(), check]).find((t) => t.name === "book_appointment")!;
    expect(def.parameters.required).toEqual(["attendee_name"]);
    expect(def.parameters.properties).toHaveProperty("attendee_email");
    expect(def.parameters.properties).not.toHaveProperty("email_confirmed");
    expect(String((def.parameters.properties as Record<string, { description?: string }>)["attendee_email"]?.description))
      .toMatch(/Do not ask the caller to invent one/);
    expect(def.description).toMatch(/Do NOT ask the caller to give an email/);
    expect(def.description).toMatch(/agent instructions/);
    expect(def.description).not.toMatch(/EMAIL CONFIRMATION/);

    const checkDef = buildToolDefs([book(), check]).find((t) => t.name === "check_availability")!;
    expect(checkDef.description).toMatch(/do not ask for an email unless it is already/);
  });

  it("requires attendee_email only when collectAttendeeEmail is true", () => {
    const def = buildToolDefs([book({ collectAttendeeEmail: true })]).find((t) => t.name === "book_appointment")!;
    expect(def.parameters.required).toEqual(["attendee_name", "attendee_email"]);
    expect(def.parameters.properties).toHaveProperty("attendee_email");
    expect(def.parameters.properties).toHaveProperty("email_confirmed");
    expect(def.description).toMatch(/EMAIL CONFIRMATION/);
  });
});
