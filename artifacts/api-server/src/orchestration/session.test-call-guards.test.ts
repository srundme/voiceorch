/**
 * endSession is ~1.6k lines of side effects; booting it needs a live pipeline.
 * These checks pin the AI Test Call guards at the source level so a refactor
 * can't silently start sending webhooks / memory / CRM pushes for test legs,
 * or stop billing them. Policy values are covered in ai-test-calls/policy.test.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "session.ts"), "utf8");
const endSessionSrc = src.slice(src.indexOf("export async function endSession("), src.indexOf("export async function failSession("));

describe("endSession AI Test Call guards", () => {
  it("derives the policy from the persisted call row", () => {
    expect(endSessionSrc).toContain("const effects = endSessionSideEffects(call.isTest === true);");
  });

  it.each([
    ["TRAI opt-out scan", "if (traiEnabled && effects.traiOptOutScan)"],
    ["resume context", "!isCampaignCall && effects.resumeContext)"],
    ["auto-redial", "if (ag && effects.autoRedial && autoRedialCfg?.enabled"],
    ["rolling agent stats", "if (effects.rollingAgentStats) {"],
    ["campaign intelligence", "if (effects.campaignHooks && session.campaignLeadId && transcript"],
    ["inbound campaign match", "effects.inboundCampaignMatch &&"],
    ["agent webhook URL", "if (ag.webhookUrl && effects.webhooks)"],
    ["workspace webhooks", "if (webhookUserId && effects.webhooks)"],
    ["caller memory", "if (effects.callerMemory && session.callerPhone"],
  ])("gates %s", (_label, snippet) => {
    expect(endSessionSrc).toContain(snippet);
  });

  it("returns before campaign/CRM/sheets/messaging/flow/Zelto pushes for test legs", () => {
    const guard = endSessionSrc.indexOf("if (!effects.campaignHooks) {");
    expect(guard).toBeGreaterThan(-1);
    for (const push of [
      "applyCampaignDispositionOutcome",
      "maybeTransferCampaignLead",
      "writeSheetAutoCallResults",
      "maybeRunAgentAfterCallMessages",
      "maybeRunAfterCallBranches",
      "fireCallEndedFlows",
      "pushCallToZelto",
      "onSquadCampaignCallEnded",
    ]) {
      const at = endSessionSrc.indexOf(push);
      expect(at, push).toBeGreaterThan(guard);
    }
  });

  it("keeps billing and the success-criteria judge ungated", () => {
    const billing = endSessionSrc.indexOf("Atomic billing claim");
    expect(billing).toBeGreaterThan(-1);
    const billingBlockStart = endSessionSrc.lastIndexOf("if (", billing);
    expect(endSessionSrc.slice(billingBlockStart, billing)).not.toContain("effects.");
    const judge = endSessionSrc.indexOf("Did this call meet the success criteria?");
    const guard = endSessionSrc.indexOf("if (!effects.campaignHooks) {");
    expect(judge).toBeGreaterThan(-1);
    expect(judge).toBeLessThan(guard);
  });

  it("links inbound legs to test runs at session creation", () => {
    expect(src).toContain("const testRunId = await claimInboundTestLeg({");
  });
});
