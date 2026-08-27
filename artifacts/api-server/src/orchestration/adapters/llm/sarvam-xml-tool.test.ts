import { describe, expect, it } from "vitest";
import { parseToolEnvelope, parseXmlToolCall, xmlToolSniff } from "./sarvam.js";

const CALL_12705 = `<tool_call>next_service_suggestion
<arg_key>offering_type</arg_key>
<arg_value>B2B + B2C Travel Portal with CRM Integration</arg_value>
<arg_key>portal_type</arg_key>
<arg_value>B2B and B2C</arg_value>
<arg_key>business_stage</arg_key>
<arg_value>existing agency moving online</arg_value>
<arg_key>integrations</arg_key>
<arg_value>CRM</arg_value>
</tool_call>`;

describe("parseXmlToolCall", () => {
  it("parses the Sarvam XML envelope from call 12705", () => {
    const parsed = parseXmlToolCall(CALL_12705);
    expect(parsed?.name).toBe("next_service_suggestion");
    expect(parsed?.args).toEqual({
      offering_type: "B2B + B2C Travel Portal with CRM Integration",
      portal_type: "B2B and B2C",
      business_stage: "existing agency moving online",
      integrations: "CRM",
    });
  });

  it("still parses when the closing tag is missing", () => {
    const parsed = parseXmlToolCall("<tool_call>next_service_lookup\n<arg_key>x</arg_key>\n<arg_value>y</arg_value>");
    expect(parsed?.name).toBe("next_service_lookup");
    expect(parsed?.args).toEqual({ x: "y" });
  });

  it("returns null for spoken prose", () => {
    expect(parseXmlToolCall("हाँ बिल्कुल हो जाएगी।")).toBeNull();
  });

  it("parses XML that follows spoken text (call 14160)", () => {
    const mixed = `वही है मैडम
<tool_call>send_email
<arg_key>to</arg_key>
<arg_value>gopinwrk@gmail.com</arg_value>
<arg_key>subject</arg_key>
<arg_value>Demo Confirmation</arg_value>
</tool_call>`;
    const parsed = parseXmlToolCall(mixed);
    expect(parsed?.name).toBe("send_email");
    expect(parsed?.args).toEqual({
      to: "gopinwrk@gmail.com",
      subject: "Demo Confirmation",
    });
  });
});

describe("parseToolEnvelope", () => {
  it("dispatches hallucinated XML tools even when they are not in the valid set", () => {
    const env = parseToolEnvelope(CALL_12705, new Set(["end_call", "schedule_callback"]));
    expect(env?.format).toBe("xml");
    expect(env?.name).toBe("next_service_suggestion");
  });

  it("does not treat emotion markup as a tool", () => {
    expect(parseToolEnvelope('<emotion value="curious"/> Are you looking at flights?', new Set(["end_call"]))).toBeNull();
  });
});

describe("xmlToolSniff", () => {
  it("holds a split <tool_call prefix and then commits", () => {
    expect(xmlToolSniff("<")).toBe("hold");
    expect(xmlToolSniff("<tool")).toBe("hold");
    expect(xmlToolSniff("<tool_call>next")).toBe("yes");
  });

  it("lets emotion tags through to TTS", () => {
    expect(xmlToolSniff('<emotion value="curious"/>')).toBe("no");
  });
});
