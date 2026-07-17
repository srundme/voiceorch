import { describe, it, expect } from "vitest";
import { redactTranscriptPII, buildGuardrailsBlock } from "./guardrails.js";

describe("redactTranscriptPII", () => {
  it("redacts payment card numbers (grouped and contiguous)", () => {
    expect(redactTranscriptPII("Caller: my card is 4111 1111 1111 1111")).not.toContain("4111");
    expect(redactTranscriptPII("Caller: 4111111111111111")).toContain("[redacted card]");
  });

  it("redacts PAN and Aadhaar", () => {
    expect(redactTranscriptPII("Caller: PAN ABCDE1234F")).toContain("[redacted PAN]");
    expect(redactTranscriptPII("Caller: aadhaar 1234 5678 9012")).toContain("[redacted Aadhaar]");
  });

  it("redacts numeric secrets but keeps benign 'pin code'", () => {
    expect(redactTranscriptPII("Agent: OTP is 456789")).not.toContain("456789");
    expect(redactTranscriptPII("Caller: cvv 123")).toContain("[redacted]");
    // "pin code 600001" is an address pincode, not a secret — must stay intact.
    expect(redactTranscriptPII("Caller: my pin code 600001")).toContain("600001");
  });

  it("PRESERVES lead contact data (phone + email)", () => {
    const t = "Caller: reach me on 9876543210 or john@example.com, +91 98765 43210";
    const out = redactTranscriptPII(t);
    expect(out).toContain("9876543210");
    expect(out).toContain("john@example.com");
    expect(out).toContain("98765 43210");
  });

  it("leaves prices and short numbers untouched", () => {
    expect(redactTranscriptPII("Agent: the fee is 50000 rupees")).toContain("50000");
  });

  it("handles empty / null input", () => {
    expect(redactTranscriptPII("")).toBe("");
    expect(redactTranscriptPII(null)).toBe("");
    expect(redactTranscriptPII(undefined)).toBe("");
  });
});

describe("buildGuardrailsBlock", () => {
  it("includes the agent name and defers identity to compliance disclosures", () => {
    const b = buildGuardrailsBlock("Malar");
    expect(b).toContain("Malar");
    expect(b).toContain("SECURITY & IDENTITY GUARDRAILS");
    expect(b.toLowerCase()).toContain("ignore previous instructions");
  });

  it("falls back to a generic name when none given", () => {
    expect(buildGuardrailsBlock(null)).toContain("the assistant");
  });
});
