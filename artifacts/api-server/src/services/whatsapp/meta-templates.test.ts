import { describe, expect, it } from "vitest";
import { resolveMetaTemplate, toTemplateCatalog, type MetaTemplateChoice, type MetaTemplateInfo } from "./meta.js";
import { resolveConnectionTemplateName } from "./payload.js";
import { hasAgentTemplatePicks, normalizeAgentWaTemplates } from "./agent-templates.js";

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
