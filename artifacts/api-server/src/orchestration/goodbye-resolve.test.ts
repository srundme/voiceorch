import { describe, expect, it } from "vitest";
import {
  DEFAULT_GOODBYE_MESSAGE,
  defaultGoodbyeMessage,
  isStubGoodbye,
  resolveGoodbyeMessage,
} from "./types.js";

describe("resolveGoodbyeMessage", () => {
  it("skips hangup-detector stubs like thankyou and uses a real farewell", () => {
    expect(isStubGoodbye("thankyou")).toBe(true);
    expect(isStubGoodbye("bye")).toBe(true);
    expect(resolveGoodbyeMessage(undefined, ["thankyou", "bye"], "en")).toBe(
      DEFAULT_GOODBYE_MESSAGE,
    );
    expect(resolveGoodbyeMessage("thankyou", ["bye"], "ta")).toBe(
      defaultGoodbyeMessage("ta"),
    );
  });

  it("keeps a real spoken goodbye line", () => {
    const line = "Thanks for your time. Have a great day. Goodbye!";
    expect(isStubGoodbye(line)).toBe(false);
    expect(resolveGoodbyeMessage(line, ["thankyou"], "en")).toBe(line);
    expect(resolveGoodbyeMessage(undefined, ["thankyou", line], "en")).toBe(line);
  });
});
