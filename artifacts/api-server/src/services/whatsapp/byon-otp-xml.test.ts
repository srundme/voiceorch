import { describe, expect, it } from "vitest";
import { buildByonOtpHangupXml, buildByonOtpRecordXml } from "./byon-otp-xml.js";

describe("buildByonOtpRecordXml", () => {
  it("uses Vobiz Record action (not Plivo callbackUrl)", () => {
    const xml = buildByonOtpRecordXml(
      "https://app.snapserve.ai/api/webhooks/vobiz/wa-otp-recording?vid=abc",
    );
    expect(xml).toContain('action="https://app.snapserve.ai/api/webhooks/vobiz/wa-otp-recording?vid=abc"');
    expect(xml).toContain('method="POST"');
    expect(xml).not.toContain("callbackUrl");
    expect(xml).not.toContain("transcriptionUrl");
  });

  it("escapes ampersands in the action URL", () => {
    const xml = buildByonOtpRecordXml("https://app.snapserve.ai/api/x?vid=1&foo=2");
    expect(xml).toContain("vid=1&amp;foo=2");
  });
});

describe("buildByonOtpHangupXml", () => {
  it("returns VoiceXML not JSON", () => {
    expect(buildByonOtpHangupXml()).toBe("<Response><Hangup/></Response>");
  });
});
