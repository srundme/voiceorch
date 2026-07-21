import { describe, it, expect } from "vitest";
import { renderVoiceathonCertificatePdf } from "./voiceathon-certificate.js";

describe("renderVoiceathonCertificatePdf", () => {
  it("renders a non-empty PDF buffer", async () => {
    const pdf = await renderVoiceathonCertificatePdf({
      eventTitle: "Campus Voice-a-thon",
      recipientName: "Ada Lovelace",
      teamName: "Analytical Engines",
      type: "participation",
      verificationCode: "VC-TESTCODE123",
      issuedAt: new Date("2026-07-21T00:00:00Z"),
    });
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(500);
    expect(pdf.subarray(0, 4).toString("ascii")).toBe("%PDF");
  });
});
