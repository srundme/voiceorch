import { describe, expect, it } from "vitest";
import { describeApiKeyShapeError } from "./mcp-oauth-helpers.js";

const validKey = `sk_live_${"a1b2c3d4".repeat(8)}`;

describe("describeApiKeyShapeError", () => {
  it("accepts a well-formed key", () => {
    expect(validKey).toHaveLength(72);
    expect(describeApiKeyShapeError(validKey)).toBeNull();
  });

  it("accepts a key with surrounding whitespace", () => {
    expect(describeApiKeyShapeError(`  ${validKey}\n`)).toBeNull();
  });

  it("rejects the masked preview copied from the API Keys list", () => {
    const masked = `sk_live_a1b2c3d4${"•".repeat(32)}`;
    expect(describeApiKeyShapeError(masked)).toMatch(/masked preview/i);
  });

  it("rejects an empty paste", () => {
    expect(describeApiKeyShapeError("   ")).toMatch(/paste an api key/i);
  });

  it("rejects a key without the sk_live_ prefix", () => {
    expect(describeApiKeyShapeError("pk_live_abc")).toMatch(/start with sk_live_/i);
  });

  it("rejects non-hex characters", () => {
    expect(describeApiKeyShapeError(`sk_live_${"z".repeat(64)}`)).toMatch(/never generate/i);
  });

  it("reports the length when the key is truncated", () => {
    const truncated = validKey.slice(0, 40);
    expect(describeApiKeyShapeError(truncated)).toMatch(/40 characters/);
  });
});
