import { describe, expect, it } from "vitest";
import {
  buildMetaParams,
  inferTemplateSlotRoles,
  resolveMetaTemplate,
  toTemplateCatalog,
  type MetaTemplateChoice,
  type MetaTemplateInfo,
} from "./meta.js";
import { resolveConnectionTemplateName } from "./payload.js";
import { hasAgentTemplatePicks, normalizeAgentWaTemplates } from "./agent-templates.js";

describe("buildMetaParams", () => {
  const clinicBody =
    "Vanakkam {{1}}, your appointment with {{2}} on {{3}} at {{4}} is confirmed at Aarthi Clinic, Redhills. — AutoFlow";
  const agentName = "Divya · Aarthi Clinic (AutoFlow Demo)";

  it("maps clinic 4-blank templates to caller / doctor / date / time — not agent name + blob", () => {
    expect(buildMetaParams("call_summary", {
      businessName: agentName,
      summary: "27 Aug 2026, 9:30 am IST",
      callerName: "Priya",
      doctor: "Dr. Aarthi",
      bodyPreview: clinicBody,
    }, 4)).toEqual(["Priya", "Dr. Aarthi", "27 Aug 2026", "9:30 am IST"]);
  });

  it("does not change slot order when template_hint flips", () => {
    const ctx = {
      businessName: agentName,
      summary: "Aarthi Clinic, Redhills, Chennai",
      callerName: "Priya",
      doctor: "Dr. Aarthi",
      date: "27 Aug 2026",
      time: "9:30 am IST",
      bodyPreview: clinicBody,
    };
    expect(buildMetaParams("call_summary", ctx, 4)).toEqual(
      buildMetaParams("booking_confirmed", ctx, 4),
    );
    expect(buildMetaParams("call_summary", ctx, 4)).toEqual([
      "Priya", "Dr. Aarthi", "27 Aug 2026", "9:30 am IST",
    ]);
  });

  it("rescues the old [agentName, datetime, —, —] layout when caller + doctor are known", () => {
    expect(buildMetaParams("call_summary", {
      businessName: agentName,
      summary: "",
      callerName: "Priya",
      doctor: "Dr. Aarthi",
      explicitParams: [agentName, "27 Aug 2026, 9:30 am IST", "—", "—"],
      bodyPreview: clinicBody,
    }, 4)).toEqual(["Priya", "Dr. Aarthi", "27 Aug 2026", "9:30 am IST"]);
  });

  it("keeps 1-variable templates on the message content", () => {
    expect(buildMetaParams("call_summary", {
      businessName: agentName,
      summary: "Clinic address: Redhills",
    }, 1)).toEqual(["Clinic address: Redhills"]);
  });

  it("keeps legacy 2-variable templates as business + summary when body is unknown", () => {
    expect(buildMetaParams("call_summary", {
      businessName: agentName,
      summary: "Thanks for calling",
      callerName: "Priya",
    }, 2)).toEqual([agentName, "Thanks for calling"]);
  });

  it("fills caller/doctor/date/time on 4-blank templates even without a body preview", () => {
    const ctx = {
      businessName: agentName,
      summary: "27 Aug 2026, 9:30 am IST",
      callerName: "Priya",
      doctor: "Dr. Aarthi",
    };
    expect(buildMetaParams("call_summary", ctx, 4)).toEqual([
      "Priya", "Dr. Aarthi", "27 Aug 2026", "9:30 am IST",
    ]);
    expect(buildMetaParams("booking_confirmed", ctx, 4)).toEqual([
      "Priya", "Dr. Aarthi", "27 Aug 2026", "9:30 am IST",
    ]);
  });
});

describe("inferTemplateSlotRoles", () => {
  it("reads Vanakkam / with / on / at as name, doctor, date, time", () => {
    expect(inferTemplateSlotRoles(
      "Vanakkam {{1}}, your appointment with {{2}} on {{3}} at {{4}} is confirmed",
      4,
    )).toEqual(["name", "doctor", "date", "time"]);
  });
});

describe("resolveMetaTemplate", () => {
  const booking: MetaTemplateChoice = { name: "book", language: "en", paramCount: 2 };
  const summary: MetaTemplateChoice = { name: "sum", language: "en", paramCount: 1 };
  const def: MetaTemplateChoice = { name: "def", language: "en", paramCount: 1 };

  it("prefers hint-specific over default and call_summary", () => {
    expect(resolveMetaTemplate({
      default: def,
      call_summary: summary,
      booking_confirmed: booking,
    }, "booking_confirmed")).toEqual(booking);
  });

  it("falls back to default when hint missing", () => {
    expect(resolveMetaTemplate({
      default: def,
      call_summary: summary,
    }, "booking_confirmed")).toEqual(def);
  });

  it("falls back to call_summary when default missing", () => {
    expect(resolveMetaTemplate({
      call_summary: summary,
    }, "callback_scheduled")).toEqual(summary);
  });

  it("returns null when nothing linked", () => {
    expect(resolveMetaTemplate({}, "call_summary")).toBeNull();
  });
});

describe("resolveConnectionTemplateName", () => {
  it("resolves hint → default → call_summary", () => {
    expect(resolveConnectionTemplateName({
      default: "d",
      call_summary: "s",
      booking_confirmed: "b",
    }, "booking_confirmed")).toBe("b");
    expect(resolveConnectionTemplateName({
      default: "d",
      call_summary: "s",
    }, "booking_confirmed")).toBe("d");
    expect(resolveConnectionTemplateName({
      call_summary: "s",
    }, "booking_confirmed")).toBe("s");
  });
});

describe("normalizeAgentWaTemplates / hasAgentTemplatePicks", () => {
  it("keeps default + outcome slots", () => {
    const n = normalizeAgentWaTemplates({
      default: { name: "d", language: "en", paramCount: 1 },
      call_summary: { name: "s", language: "ta", paramCount: 2 },
      junk: { name: "x", language: "en", paramCount: 0 },
    });
    expect(n.default?.name).toBe("d");
    expect(n.call_summary?.language).toBe("ta");
    expect((n as Record<string, unknown>)["junk"]).toBeUndefined();
    expect(hasAgentTemplatePicks(n)).toBe(true);
    expect(hasAgentTemplatePicks({})).toBe(false);
  });
});

describe("toTemplateCatalog", () => {
  it("keeps APPROVED and omits PENDING", () => {
    const list: MetaTemplateInfo[] = [
      { name: "a", language: "en", status: "APPROVED", category: "UTILITY", paramCount: 1, bodyPreview: "hi" },
      { name: "b", language: "en", status: "PENDING", category: "UTILITY", paramCount: 0, bodyPreview: "" },
    ];
    expect(toTemplateCatalog(list)).toHaveLength(1);
    expect(toTemplateCatalog(list)[0]!.name).toBe("a");
  });

  it("keeps templates when BSP/Meta omit status", () => {
    const list: MetaTemplateInfo[] = [
      { name: "hello", language: "en_US", status: "", category: null, paramCount: 0, bodyPreview: "" },
    ];
    expect(toTemplateCatalog(list)).toHaveLength(1);
    expect(toTemplateCatalog(list)[0]!.status).toBe("APPROVED");
  });
});
