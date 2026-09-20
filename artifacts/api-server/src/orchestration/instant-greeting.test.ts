import { describe, expect, it } from "vitest";
import {
  buildInstantReturningGreeting,
  neutralGreeting,
  isMetaRefusalGreeting,
  isStubGreeting,
  outboundTypedWelcomeBlocksGreetingLlm,
  joinWelcomeAndOpener,
  stripWelcomePrefix,
} from "./endpointing.js";

describe("buildInstantReturningGreeting", () => {
  it("greets a remembered name in the opening language — no purpose-of-call script", () => {
    expect(buildInstantReturningGreeting("Thirumugam", "hi-IN")).toBe("नमस्ते Thirumugam.");
    expect(buildInstantReturningGreeting("Karthik", "ta")).toBe("வணக்கம் Karthik.");
    expect(buildInstantReturningGreeting(null, "en")).toBe("Hi.");
    expect(buildInstantReturningGreeting("Karthik", "ta")).not.toMatch(/விஷயமா|எதற்காக|காரணமா/);
  });
});

describe("neutralGreeting", () => {
  it("returns language-specific opener", () => {
    expect(neutralGreeting("ta-IN")).toContain("வணக்கம்");
  });
});

describe("isMetaRefusalGreeting", () => {
  it("rejects the call 9153 opener that was spoken to a lead", () => {
    expect(
      isMetaRefusalGreeting(
        "Since no CALL FLOW or GREETING was provided in the prompt, I am unable to start the call. Please provide the script and flow.",
      ),
    ).toBe(true);
  });

  it("rejects other meta / refusal shapes", () => {
    expect(isMetaRefusalGreeting("I cannot begin without a script.")).toBe(true);
    expect(isMetaRefusalGreeting("As an AI, I need more context first.")).toBe(true);
    expect(isMetaRefusalGreeting("No greeting was provided, so I will wait.")).toBe(true);
    expect(isMetaRefusalGreeting("The system prompt does not define an opener.")).toBe(true);
  });

  it("accepts genuine openers", () => {
    expect(
      isMetaRefusalGreeting("Hi, this is Robert from Casagrand Aquagrove. Am I speaking with Rajavarthini A?"),
    ).toBe(false);
    expect(isMetaRefusalGreeting("Hello! We're calling from SnapServe regarding the Voice-a-thon.")).toBe(false);
    expect(isMetaRefusalGreeting("வணக்கம், நான் ராபர்ட் பேசுறேன்.")).toBe(false);
  });

  it("treats empty text as not a refusal so the caller path still applies", () => {
    expect(isMetaRefusalGreeting("")).toBe(false);
    expect(isMetaRefusalGreeting(null)).toBe(false);
  });
});

describe("joinWelcomeAndOpener", () => {
  it("puts a stub Hello in front of the generated pitch", () => {
    expect(
      joinWelcomeAndOpener("Hello", "This is Infant from SnapServe. Got two minutes?"),
    ).toBe("Hello. This is Infant from SnapServe. Got two minutes?");
  });

  it("does not double a greeting the opener already starts with", () => {
    expect(joinWelcomeAndOpener("Hello", "Hello, this is Infant.")).toBe("Hello, this is Infant.");
    expect(joinWelcomeAndOpener("Hello", "Hi, this is Infant from SnapServe.")).toBe(
      "Hi, this is Infant from SnapServe.",
    );
  });

  it("keeps a punctuated welcome as its own sentence", () => {
    expect(joinWelcomeAndOpener("Hello!", "We're calling about Voice-a-thon.")).toBe(
      "Hello! We're calling about Voice-a-thon.",
    );
  });
});

describe("stripWelcomePrefix", () => {
  it("drops a duplicated Hello after Welcome already played", () => {
    expect(stripWelcomePrefix("Hello", "Hello, this is Infant from SnapServe.")).toBe(
      "this is Infant from SnapServe.",
    );
    expect(stripWelcomePrefix("Hello", "Hi, this is Infant from SnapServe.")).toBe(
      "this is Infant from SnapServe.",
    );
  });

  it("leaves a pitch that does not start with a greeting", () => {
    expect(stripWelcomePrefix("Hello", "This is Infant from SnapServe. Got two minutes?")).toBe(
      "This is Infant from SnapServe. Got two minutes?",
    );
  });
});

describe("outboundTypedWelcomeBlocksGreetingLlm", () => {
  it("does not treat Hello as a complete outbound opener (call 26692)", () => {
    expect(outboundTypedWelcomeBlocksGreetingLlm("Hello!", "en-IN")).toBe(false);
    expect(outboundTypedWelcomeBlocksGreetingLlm("Hi", "en")).toBe(false);
    expect(outboundTypedWelcomeBlocksGreetingLlm("Hello!", "ta-IN")).toBe(false);
  });

  it("still generates an opener when Welcome is empty", () => {
    expect(outboundTypedWelcomeBlocksGreetingLlm("", "en-IN")).toBe(false);
    expect(outboundTypedWelcomeBlocksGreetingLlm("   ", "en-IN")).toBe(false);
  });

  it("still blocks a second opener when Welcome is a real identity line (call 17455)", () => {
    expect(
      outboundTypedWelcomeBlocksGreetingLlm(
        "Hi, this is Infant from SnapServe. Got two minutes?",
        "en-IN",
      ),
    ).toBe(true);
  });
});

describe("isStubGreeting", () => {
  it("treats Hello / Hi as stubs so outbound still generates the pitch", () => {
    expect(isStubGreeting("Hello")).toBe(true);
    expect(isStubGreeting("Hi!")).toBe(true);
    expect(isStubGreeting("Hello there")).toBe(true);
    expect(isStubGreeting("Hi, this is Infant from SnapServe. Got two minutes?")).toBe(false);
  });
});
