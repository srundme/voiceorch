import { describe, expect, it } from "vitest";
import {
  dispositionMatchesTransfer,
  normalizeLeadTransferInput,
  parseLeadTransferConfig,
} from "./campaign-lead-transfer.js";

describe("campaign lead transfer", () => {
  it("matches primary and primary:sub", () => {
    const disp = { primary: "Interested", sub: "Hot" };
    expect(dispositionMatchesTransfer(disp, ["Interested"])).toBe(true);
    expect(dispositionMatchesTransfer(disp, ["Interested:Hot"])).toBe(true);
    expect(dispositionMatchesTransfer(disp, ["Not Interested"])).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(
      dispositionMatchesTransfer({ primary: "Interested" }, ["interested"]),
    ).toBe(true);
  });

  it("parseLeadTransferConfig requires https webhook", () => {
    expect(
      parseLeadTransferConfig({
        enabled: true,
        dispositions: ["Interested"],
        destination: "webhook",
        webhookUrl: "http://insecure.example",
      }),
    ).toBeNull();
    expect(
      parseLeadTransferConfig({
        enabled: true,
        dispositions: ["Interested"],
        destination: "webhook",
        webhookUrl: "https://hooks.zapier.com/x",
      })?.enabled,
    ).toBe(true);
  });

  it("normalizeLeadTransferInput disables incomplete configs", () => {
    const out = normalizeLeadTransferInput({
      enabled: true,
      dispositions: [],
      destination: "webhook",
    });
    expect(out?.enabled).toBe(false);
  });
});
