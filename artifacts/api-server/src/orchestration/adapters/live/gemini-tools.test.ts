import { Type } from "@google/genai";
import { describe, expect, it } from "vitest";
import { toGeminiLiveTools, toGeminiPropertySchema } from "./gemini-tools.js";
import type { ToolDefinition } from "../../types.js";

const sendWhatsapp: ToolDefinition = {
  name: "send_whatsapp",
  description: "Send a WhatsApp message to the caller.",
  parameters: {
    type: "object",
    properties: {
      to_phone: { type: "string", description: "Recipient phone" },
      params: {
        type: "array",
        items: { type: "string" },
        description: "Ordered template body values",
      },
      message: { type: "string", description: "Extra notes" },
    },
    required: [],
  },
};

describe("toGeminiLiveTools send_whatsapp", () => {
  it("sends ARRAY params with items so Gemini does not 400", () => {
    const tools = toGeminiLiveTools([sendWhatsapp]);
    const props = tools![0]!.functionDeclarations![0]!.parameters!.properties!;
    expect(props["params"]?.type).toBe(Type.ARRAY);
    expect(props["params"]?.items).toEqual({ type: Type.STRING });
    expect(props["to_phone"]?.type).toBe(Type.STRING);
  });

  it("defaults items to STRING when an array omitted them", () => {
    const schema = toGeminiPropertySchema({ type: "array", description: "tags" });
    expect(schema.type).toBe(Type.ARRAY);
    expect(schema.items).toEqual({ type: Type.STRING });
  });

  it("keeps enum fields", () => {
    const schema = toGeminiPropertySchema({
      type: "string",
      enum: ["a", "b"],
      description: "pick",
    });
    expect(schema.enum).toEqual(["a", "b"]);
    expect(schema.format).toBe("enum");
  });
});
