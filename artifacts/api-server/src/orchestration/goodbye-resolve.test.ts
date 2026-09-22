import { describe, expect, it } from "vitest";
import {
  DEFAULT_GOODBYE_MESSAGE,
  defaultGoodbyeMessage,
  isStubGoodbye,
  resolveGoodbyeMessage,
} from "./types.js";

describe("resolveGoodbyeMessage", () => {
  it("skips hangup-detector stubs and does not inject a hardcoded farewell", () => {
    expect(isStubGoodbye("thankyou")).toBe(true);
    expect(isStubGoodbye("bye")).toBe(true);
    expect(resolveGoodbyeMessage(undefined, ["thankyou", "bye"], "en")).toBeNull();
    expect(resolveGoodbyeMessage("thankyou", ["bye"], "ta")).toBe("thankyou");
  });

  it("keeps a real spoken goodbye line", () => {
    const line = "Thanks for your time. Have a great day. Goodbye!";
    expect(isStubGoodbye(line)).toBe(false);
    expect(resolveGoodbyeMessage(line, ["thankyou"], "en")).toBe(line);
    expect(resolveGoodbyeMessage(undefined, ["thankyou", line], "en")).toBe(line);
  });

  it("honors a short explicit end-greeting box (not a detector fallback)", () => {
    expect(resolveGoodbyeMessage("உடம்பப் பார்த்துக்கோங்கப்பா", [], "ta")).toBe(
      "உடம்பப் பார்த்துக்கோங்கப்பா",
    );
    expect(resolveGoodbyeMessage("bye", [], "en")).toBe("bye");
  });

  it("still exposes language defaults for intake-only silent fallback", () => {
    expect(defaultGoodbyeMessage("ta")).toContain("நன்றி");
    expect(defaultGoodbyeMessage("en")).toBe(DEFAULT_GOODBYE_MESSAGE);
  });
});
