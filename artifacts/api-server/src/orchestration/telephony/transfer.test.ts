import { describe, expect, it } from "vitest";
import {
  buildVobizMergeCustomerXml,
  buildVobizMergeSalesXml,
  buildVobizMergeWaitXml,
  vobizMergeRoom,
} from "./transfer.js";

describe("VoBiz 3-way merge XML", () => {
  it("uses a unique alphanumeric room per call/transfer", () => {
    expect(vobizMergeRoom(24579, 12)).toBe("ssmerge24579t12");
  });

  it("parks the customer until sales starts the conference", () => {
    const xml = buildVobizMergeCustomerXml({
      room: "ssmerge1t2",
      waitSoundUrl: "https://app.example/wait",
      callbackUrl: "https://app.example/cb",
    });
    expect(xml).toContain('startConferenceOnEnter="false"');
    expect(xml).toContain('stayAlone="true"');
    expect(xml).toContain("ssmerge1t2");
    expect(xml).toContain("https://app.example/wait");
  });

  it("lets sales start the room without ending it on exit", () => {
    const xml = buildVobizMergeSalesXml({
      room: "ssmerge1t2",
      callbackUrl: "https://app.example/cb",
    });
    expect(xml).toContain('startConferenceOnEnter="true"');
    expect(xml).toContain('endConferenceOnExit="false"');
  });

  it("loops hold speech for waitSound", () => {
    expect(buildVobizMergeWaitXml()).toContain('loop="0"');
  });
});
