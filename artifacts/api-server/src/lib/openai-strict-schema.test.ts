import { describe, expect, it } from "vitest";
import { isOpenAiInvalidSchemaError, toOpenAiStrictSchema } from "./openai-strict-schema.js";

describe("toOpenAiStrictSchema", () => {
  it("requires every property and strips OpenAI-unsupported keywords (call 20746)", () => {
    const schema = toOpenAiStrictSchema({
      type: "object",
      additionalProperties: false,
      properties: {
        sentiment: { type: "string", enum: ["positive", "neutral"] },
        keyTopics: { type: "array", items: { type: "string" }, maxItems: 6 },
        summary: { type: "string" },
        purchaseIntentScore: { type: "integer", minimum: 0, maximum: 100 },
        agentPerformance: {
          type: "object",
          additionalProperties: false,
          properties: {
            empathy: { type: "integer", minimum: 1, maximum: 5 },
            notes: { type: "string" },
          },
        },
      },
      required: ["sentiment", "keyTopics", "purchaseIntentScore"],
    });

    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(expect.arrayContaining([
      "sentiment",
      "keyTopics",
      "summary",
      "purchaseIntentScore",
      "agentPerformance",
    ]));
    const props = schema.properties as Record<string, any>;
    expect(props.keyTopics.maxItems).toBeUndefined();
    expect(props.purchaseIntentScore.minimum).toBeUndefined();
    expect(props.purchaseIntentScore.maximum).toBeUndefined();
    expect(props.summary.type).toEqual(["string", "null"]);
    expect(props.agentPerformance.type).toEqual(["object", "null"]);
    expect(props.agentPerformance.required).toEqual(["empathy", "notes"]);
    expect(props.agentPerformance.properties.empathy.minimum).toBeUndefined();
  });

  it("rewrites enum+null so OpenAI does not reject the schema", () => {
    const schema = toOpenAiStrictSchema({
      type: "object",
      properties: {
        demo: { type: ["string", "null"], enum: ["yes", "no", null] },
      },
      required: ["demo"],
      additionalProperties: false,
    });
    const demo = (schema.properties as Record<string, any>).demo;
    expect(demo.anyOf).toEqual([
      { type: "string", enum: ["yes", "no"] },
      { type: "null" },
    ]);
  });
});

describe("isOpenAiInvalidSchemaError", () => {
  it("detects the 400 OpenAI structured-output rejection", () => {
    const err = Object.assign(new Error("400 Invalid schema for response_format 'disposition'"), {
      status: 400,
      error: { param: "response_format" },
    });
    expect(isOpenAiInvalidSchemaError(err)).toBe(true);
    expect(isOpenAiInvalidSchemaError(new Error("429 rate limit"))).toBe(false);
  });
});
