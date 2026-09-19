import { describe, expect, it } from "vitest";
import {
  applyAnsweredEverTransition,
  assertV2AnsweredNotFailed,
  buildCampaignLeadStateV2CanaryLog,
  buildCampaignLeadStateV2Shadow,
  campaignLeadWritePatch,
  CAMPAIGN_CONCURRENCY_SLOT_STATUSES,
  CAMPAIGN_LEAD_STATE_V2_EVENT,
  classifyCampaignCallEnd,
  classifyCampaignHangupLegacy,
  finalizeV2Park,
  inferExpectedDisconnect,
  isCampaignLeadClaimableByRefill,
  isCampaignLeadStateV2,
  isCampaignLeadStateV2Writer,
  isConcurrencySlotReleased,
  planV2AnsweredHangup,
  proposeCampaignLeadPark,
  resolveCampaignLeadStateV2Mode,
  shouldCancelDroppedRetryAfterDisposition,
  shouldDeferCarrierTerminalOnAnsweredLead,
  shouldLogCampaignLeadStateV2Canary,
  shouldLogCampaignLeadStateV2Shadow,
  shouldPreserveBusinessDisposition,
  v2ParkNeverAnsweredFailed,
  v2ParkStuckAnswered,
  type ClassifyCampaignCallEndInput,
} from "./campaign-lead-state-v2.js";

function classify(partial: Partial<ClassifyCampaignCallEndInput> & Pick<
  ClassifyCampaignCallEndInput,
  "durationSeconds" | "turnCount"
>) {
  return classifyCampaignCallEnd({
    naturalEndTriggered: false,
    wasTransferred: false,
    conversationCompleted: false,
    transcriptHasFarewellEnding: false,
    endReasonHint: null,
    callEndedReason: "user_hangup",
    expectedDisconnect: true,
    isVoicemail: false,
    ...partial,
  });
}

describe("CAMPAIGN_LEAD_STATE_V2 flag", () => {
  it("defaults off so production hangup parking is unchanged", () => {
    expect(resolveCampaignLeadStateV2Mode({})).toBe("off");
    expect(isCampaignLeadStateV2({})).toBe(false);
    expect(isCampaignLeadStateV2({ CAMPAIGN_LEAD_STATE_V2: "off" })).toBe(false);
    expect(isCampaignLeadStateV2({ CAMPAIGN_LEAD_STATE_V2: "" })).toBe(false);
    expect(isCampaignLeadStateV2Writer(449, { CAMPAIGN_LEAD_STATE_V2: "off" })).toBe(false);
  });

  it("shadow never writes V2 parking", () => {
    const env = { CAMPAIGN_LEAD_STATE_V2: "shadow" };
    expect(resolveCampaignLeadStateV2Mode(env)).toBe("shadow");
    expect(isCampaignLeadStateV2Writer(449, env)).toBe(false);
    expect(shouldLogCampaignLeadStateV2Shadow(env)).toBe(true);
    expect(shouldLogCampaignLeadStateV2Canary(449, env)).toBe(false);
  });

  it("canary writes only for allowlisted campaign IDs", () => {
    const env = {
      CAMPAIGN_LEAD_STATE_V2: "canary",
      CAMPAIGN_LEAD_STATE_V2_CANARY_CAMPAIGN_IDS: "449",
    };
    expect(isCampaignLeadStateV2Writer(449, env)).toBe(true);
    expect(isCampaignLeadStateV2Writer(1, env)).toBe(false);
    expect(isCampaignLeadStateV2(env)).toBe(false);
    expect(shouldLogCampaignLeadStateV2Canary(449, env)).toBe(true);
    expect(shouldLogCampaignLeadStateV2Canary(1, env)).toBe(false);
  });

  it("turns on globally only for explicit on/true/1", () => {
    expect(isCampaignLeadStateV2({ CAMPAIGN_LEAD_STATE_V2: "on" })).toBe(true);
    expect(isCampaignLeadStateV2Writer(1, { CAMPAIGN_LEAD_STATE_V2: "on" })).toBe(true);
    expect(isCampaignLeadStateV2({ CAMPAIGN_LEAD_STATE_V2: "true" })).toBe(true);
    expect(isCampaignLeadStateV2({ CAMPAIGN_LEAD_STATE_V2: "1" })).toBe(true);
  });
});

describe("classifyCampaignCallEnd — production fixtures", () => {
  it("Call 26475 Call me Monday is D (business ending), not a network drop", () => {
    const result = classify({
      durationSeconds: 18,
      turnCount: 1,
      callEndedReason: "user_hangup",
      expectedDisconnect: true,
      disposition: "call back requested",
      lastUserTranscript: "No no not now I am driving ya. Call me Monday.",
    } as ClassifyCampaignCallEndInput);

    expect(result.class).toBe("D");
    expect(result.retryEligible).toBe(false);
    expect(result.proposedRetryReason).not.toBe("network_drop");
    expect(result.proposedRetryReason).not.toBe("dropped");
    expect(result.lastAttemptStatus).toBe("caller_hangup");
    expect(["completed", "pending"]).toContain(result.proposedLeadStatus);
  });

  it("Call 26477 38s interested conversation is caller/normal ending, not a network drop", () => {
    const result = classify({
      durationSeconds: 38,
      turnCount: 5,
      callEndedReason: "user_hangup",
      expectedDisconnect: true,
      conversationCompleted: false,
      naturalEndTriggered: false,
      disposition: "interested",
    });

    expect(result.class).not.toBe("A");
    expect(["B", "C", "D"]).toContain(result.class);
    expect(result.retryEligible).toBe(false);
    expect(result.lastAttemptStatus).not.toBe("dropped");
  });

  it("Call 26441 29s interested conversation is caller/normal ending, not a network drop", () => {
    const result = classify({
      durationSeconds: 29,
      turnCount: 3,
      callEndedReason: "user_hangup",
      expectedDisconnect: true,
      conversationCompleted: false,
      naturalEndTriggered: false,
      disposition: "interested",
    });

    expect(result.class).not.toBe("A");
    expect(["B", "C", "D"]).toContain(result.class);
    expect(result.retryEligible).toBe(false);
    expect(result.lastAttemptStatus).not.toBe("dropped");
  });

  it("synthetic media disconnect while waiting for a reply is A and retry-eligible", () => {
    const result = classify({
      durationSeconds: 12,
      turnCount: 1,
      endReasonHint: "media_disconnect",
      callEndedReason: "media_disconnect",
      expectedDisconnect: false,
      waitingForReply: true,
      conversationCompleted: false,
      transcriptHasFarewellEnding: false,
      naturalEndTriggered: false,
    });

    expect(result.class).toBe("A");
    expect(result.retryEligible).toBe(true);
    expect(result.lastAttemptStatus).toBe("dropped");
    expect(result.proposedRetryReason).toBe("dropped");
  });
});

describe("classifyCampaignCallEnd — critical negatives", () => {
  it("duration > 15 && !naturalEndTriggered is not by itself a network drop", () => {
    const result = classify({
      durationSeconds: 38,
      turnCount: 5,
      naturalEndTriggered: false,
      callEndedReason: "user_hangup",
      expectedDisconnect: true,
    });
    expect(result.class).not.toBe("A");
    expect(result.retryEligible).toBe(false);
    expect(result.lastAttemptStatus).toBe("caller_hangup");
  });

  it("user_hangup after a meaningful conversation is not automatically a network drop", () => {
    const result = classify({
      durationSeconds: 29,
      turnCount: 3,
      callEndedReason: "user_hangup",
      expectedDisconnect: true,
      naturalEndTriggered: false,
      conversationCompleted: false,
    });
    expect(result.class).toBe("B");
    expect(result.retryEligible).toBe(false);
  });

  it("caller hangup is not automatically retryable", () => {
    const result = classify({
      durationSeconds: 20,
      turnCount: 2,
      callEndedReason: "user_hangup",
      expectedDisconnect: true,
    });
    expect(result.retryEligible).toBe(false);
    expect(result.proposedRetryReason).toBeNull();
  });

  it("genuine media drop remains retryable", () => {
    const result = classify({
      durationSeconds: 22,
      turnCount: 2,
      endReasonHint: "media_disconnect",
      callEndedReason: "media_disconnect",
      expectedDisconnect: false,
      waitingForReply: true,
    });
    expect(result.class).toBe("A");
    expect(result.retryEligible).toBe(true);
  });

  it("does not use a business disposition as the technical attempt status", () => {
    const result = classify({
      durationSeconds: 38,
      turnCount: 5,
      disposition: "interested",
      callEndedReason: "user_hangup",
      expectedDisconnect: true,
    });
    expect(result.lastAttemptStatus).not.toBe("interested");
    expect(["caller_hangup", "completed", "agent_end"]).toContain(result.lastAttemptStatus);
  });

  it("does not treat carrier_disconnect alone as a genuine drop", () => {
    const result = classify({
      durationSeconds: 28,
      turnCount: 3,
      callEndedReason: "carrier_disconnect",
      endReasonHint: "carrier_disconnect",
      expectedDisconnect: false,
      waitingForReply: false,
    });
    expect(result.class).not.toBe("A");
    expect(result.retryEligible).toBe(false);
    expect(result.lastAttemptStatus).not.toBe("dropped");
  });

  it("user_hangup expected=true stays non-retryable even if carrier later reports disconnect", () => {
    const result = classify({
      durationSeconds: 38,
      turnCount: 5,
      callEndedReason: "user_hangup",
      endReasonHint: "carrier_disconnect",
      expectedDisconnect: true,
      waitingForReply: false,
    });
    expect(result.class).not.toBe("A");
    expect(result.retryEligible).toBe(false);
    expect(result.lastAttemptStatus).toBe("caller_hangup");
  });

  it("carrier_disconnect + unexpected + waiting for reply is a genuine drop", () => {
    const result = classify({
      durationSeconds: 20,
      turnCount: 2,
      callEndedReason: "carrier_disconnect",
      endReasonHint: "carrier_disconnect",
      expectedDisconnect: false,
      waitingForReply: true,
    });
    expect(result.class).toBe("A");
    expect(result.retryEligible).toBe(true);
    expect(result.lastAttemptStatus).toBe("dropped");
  });

  it("early_media_drop remains a genuine drop", () => {
    const result = classify({
      durationSeconds: 8,
      turnCount: 0,
      callEndedReason: "early_media_drop",
      expectedDisconnect: false,
    });
    expect(result.class).toBe("A");
    expect(result.retryEligible).toBe(true);
  });
});

describe("legacy hangup (V2 off) is unchanged", () => {
  it("still treats duration>15 without naturalEnd as network_drop / lead failed", () => {
    expect(
      classifyCampaignHangupLegacy({
        isVoicemail: false,
        naturalEndTriggered: false,
        wasTransferred: false,
        durationSeconds: 38,
      }),
    ).toEqual({
      oldClassification: "network_drop",
      oldLeadStatus: "failed",
      oldRetryReason: "network_drop",
    });
  });

  it("still parks a natural end as completed with no retry", () => {
    expect(
      classifyCampaignHangupLegacy({
        isVoicemail: false,
        naturalEndTriggered: true,
        wasTransferred: false,
        durationSeconds: 38,
      }),
    ).toEqual({
      oldClassification: "completed",
      oldLeadStatus: "completed",
      oldRetryReason: null,
    });
  });
});

describe("answered_ever is monotonic", () => {
  it("never goes backwards through applyAnsweredEverTransition", () => {
    let lead = { answeredEver: false, callStatus: "calling", lastAttemptStatus: null as string | null };
    lead = applyAnsweredEverTransition(lead, {
      answeredEver: true,
      callStatus: "connected",
      lastAttemptStatus: "answered",
    });
    expect(lead.answeredEver).toBe(true);

    lead = applyAnsweredEverTransition(lead, {
      callStatus: "busy",
      lastAttemptStatus: "busy",
    });
    expect(lead.answeredEver).toBe(true);
    expect(lead.lastAttemptStatus).toBe("busy");

    lead = applyAnsweredEverTransition(lead, {
      callStatus: "no_pickup",
      lastAttemptStatus: "no_pickup",
    });
    expect(lead.answeredEver).toBe(true);

    lead = applyAnsweredEverTransition(lead, {
      callStatus: "failed",
      lastAttemptStatus: "failed",
    });
    expect(lead.answeredEver).toBe(true);
  });

  it("throws if a writer tries to set answered_ever false", () => {
    expect(() => campaignLeadWritePatch({ answeredEver: false })).toThrow(/monotonic/);
    expect(() =>
      applyAnsweredEverTransition({ answeredEver: true, callStatus: "connected" }, { answeredEver: false }),
    ).toThrow(/monotonic/);
  });
});

describe("invariants under V2 proposed park", () => {
  it("answered lead cannot become lead-level failed under V2", () => {
    for (const fixture of [
      classify({ durationSeconds: 38, turnCount: 5, disposition: "interested" }),
      classify({
        durationSeconds: 18,
        turnCount: 1,
        lastUserTranscript: "Call me Monday.",
        disposition: "callback requested",
      }),
      classify({
        durationSeconds: 22,
        turnCount: 2,
        endReasonHint: "media_disconnect",
        callEndedReason: "media_disconnect",
        expectedDisconnect: false,
        waitingForReply: true,
      }),
    ]) {
      const park = proposeCampaignLeadPark({ answeredEver: true, classification: fixture });
      expect(park.leadStatus).not.toBe("failed");
    }
  });

  it("positive disposition survives later technical attempts", () => {
    expect(
      shouldPreserveBusinessDisposition({
        existing: "outcome: interested",
        incoming: "NOT_CONNECTED: no_answer",
      }),
    ).toBe(true);
    expect(
      shouldPreserveBusinessDisposition({
        existing: "interested",
        incoming: null,
      }),
    ).toBe(true);
    expect(
      shouldPreserveBusinessDisposition({
        existing: "interested",
        incoming: "outcome: very interested",
      }),
    ).toBe(false);
  });

  it("callback survives later technical attempts", () => {
    expect(
      shouldPreserveBusinessDisposition({
        existing: "call back requested",
        incoming: "busy",
      }),
    ).toBe(true);
  });

  it("interested survives a no-pickup retry label", () => {
    expect(
      shouldPreserveBusinessDisposition({
        existing: "interested",
        incoming: "no pickup",
      }),
    ).toBe(true);
  });

  it("connected carrier-failed race does not clobber answered state under V2", () => {
    expect(
      shouldDeferCarrierTerminalOnAnsweredLead({
        v2: true,
        answeredEver: true,
        callStatus: "connected",
      }),
    ).toBe(true);

    const afterRace = applyAnsweredEverTransition(
      { answeredEver: true, callStatus: "connected", lastAttemptStatus: "answered" },
      { lastAttemptStatus: "failed" },
    );
    expect(afterRace.answeredEver).toBe(true);
    expect(afterRace.callStatus).toBe("connected");
  });

  it("does not defer the carrier terminal while V2 is off", () => {
    expect(
      shouldDeferCarrierTerminalOnAnsweredLead({
        v2: false,
        answeredEver: true,
        callStatus: "connected",
      }),
    ).toBe(false);
  });

  it("concurrency semantics remain calling | connected", () => {
    expect([...CAMPAIGN_CONCURRENCY_SLOT_STATUSES]).toEqual(["calling", "connected"]);
  });
});

describe("shadow comparison payload", () => {
  it("includes old vs V2 fields without applying V2", () => {
    const input: ClassifyCampaignCallEndInput = {
      naturalEndTriggered: false,
      wasTransferred: false,
      conversationCompleted: false,
      transcriptHasFarewellEnding: false,
      endReasonHint: null,
      callEndedReason: "user_hangup",
      expectedDisconnect: true,
      turnCount: 5,
      durationSeconds: 38,
      isVoicemail: false,
      disposition: "interested",
    };
    const classification = classifyCampaignCallEnd(input);
    const legacy = classifyCampaignHangupLegacy({
      isVoicemail: false,
      naturalEndTriggered: false,
      wasTransferred: false,
      durationSeconds: 38,
    });
    const shadow = buildCampaignLeadStateV2Shadow({
      answeredEver: true,
      classification,
      legacy,
      endReasonHint: null,
      callEndedReason: "user_hangup",
      expectedDisconnect: inferExpectedDisconnect("user_hangup"),
      durationSeconds: 38,
      turnCount: 5,
      conversationCompleted: false,
      naturalEndTriggered: false,
    });

    expect(shadow.oldClassification).toBe("network_drop");
    expect(shadow.oldLeadStatus).toBe("failed");
    expect(shadow.oldRetryReason).toBe("network_drop");
    expect(shadow.v2Classification).not.toBe("A");
    expect(shadow.proposedLeadStatus).not.toBe("failed");
    expect(shadow.answeredEver).toBe(true);
    expect(shadow.expectedDisconnect).toBe(true);
    expect(shadow.duration).toBe(38);
    expect(shadow.turnCount).toBe(5);
    expect(isCampaignLeadStateV2({ CAMPAIGN_LEAD_STATE_V2: "off" })).toBe(false);
  });
});

describe("V2 answered hangup parking", () => {
  it("Failed ∩ answered_ever = 0 on the V2 path", () => {
    const hangups = [
      classify({ durationSeconds: 38, turnCount: 5, disposition: "interested" }),
      classify({ durationSeconds: 18, turnCount: 1, lastUserTranscript: "Call me Monday." }),
      classify({
        durationSeconds: 22,
        turnCount: 2,
        endReasonHint: "media_disconnect",
        callEndedReason: "media_disconnect",
        expectedDisconnect: false,
        waitingForReply: true,
      }),
      classify({ durationSeconds: 29, turnCount: 3, callEndedReason: "user_hangup", expectedDisconnect: true }),
    ];
    for (const classification of hangups) {
      for (const retryOk of [true, false]) {
        const park = proposeCampaignLeadPark({ answeredEver: true, classification, retryOk });
        expect(park.leadStatus).not.toBe("failed");
        expect(() => assertV2AnsweredNotFailed({ answeredEver: true, callStatus: park.leadStatus })).not.toThrow();
      }
    }
  });

  it("genuine drop → pending + retry when insert succeeds", () => {
    const classification = classify({
      durationSeconds: 22,
      turnCount: 2,
      endReasonHint: "media_disconnect",
      callEndedReason: "media_disconnect",
      expectedDisconnect: false,
      waitingForReply: true,
    });
    const plan = planV2AnsweredHangup({ answeredEver: true, classification });
    expect(plan.wantsRetry).toBe(true);
    expect(plan.retryReason).toBe("dropped");
    const park = finalizeV2Park({ plan, retryOk: true });
    expect(park.callStatus).toBe("pending");
    expect(park.lastAttemptStatus).toBe("dropped");
    expect(park.retryScheduled).toBe(true);
    expect(isConcurrencySlotReleased(park.callStatus)).toBe(true);
  });

  it("retry insertion failure cannot expose immediately claimable pending", () => {
    const classification = classify({
      durationSeconds: 22,
      turnCount: 2,
      endReasonHint: "media_disconnect",
      callEndedReason: "media_disconnect",
      expectedDisconnect: false,
      waitingForReply: true,
    });
    const plan = planV2AnsweredHangup({ answeredEver: true, classification });
    const park = finalizeV2Park({ plan, retryOk: false });
    expect(park.callStatus).toBe("completed");
    expect(park.callStatus).not.toBe("pending");
    expect(park.callStatus).not.toBe("failed");
    expect(isCampaignLeadClaimableByRefill({
      callStatus: park.callStatus,
      pendingRetryScheduledAt: null,
    })).toBe(false);
  });

  it("pending retry cannot be claimed before scheduled_at", () => {
    const now = new Date("2026-09-19T12:00:00Z");
    expect(isCampaignLeadClaimableByRefill({
      callStatus: "pending",
      pendingRetryScheduledAt: new Date("2026-09-19T13:00:00Z"),
      now,
    })).toBe(false);
    expect(isCampaignLeadClaimableByRefill({
      callStatus: "pending",
      pendingRetryScheduledAt: new Date("2026-09-19T11:00:00Z"),
      now,
    })).toBe(true);
  });

  it("normal caller hangup → completed, no network retry", () => {
    const classification = classify({
      durationSeconds: 38,
      turnCount: 5,
      callEndedReason: "user_hangup",
      expectedDisconnect: true,
    });
    const park = proposeCampaignLeadPark({ answeredEver: true, classification });
    expect(classification.class).toBe("B");
    expect(park.leadStatus).toBe("completed");
    expect(park.retryReason).toBeNull();
    expect(isConcurrencySlotReleased(park.leadStatus)).toBe(true);
  });

  it("callback → completed + no network-drop retry", () => {
    const classification = classify({
      durationSeconds: 18,
      turnCount: 1,
      disposition: "call back requested",
      lastUserTranscript: "Call me Monday.",
    });
    expect(classification.class).toBe("D");
    const park = proposeCampaignLeadPark({ answeredEver: true, classification });
    expect(park.leadStatus).toBe("completed");
    expect(park.retryReason).not.toBe("network_drop");
    expect(park.retryReason).not.toBe("dropped");
  });

  it("interested → completed + interested preserved", () => {
    const classification = classify({
      durationSeconds: 38,
      turnCount: 5,
      disposition: "interested",
    });
    const park = proposeCampaignLeadPark({ answeredEver: true, classification });
    expect(park.leadStatus).toBe("completed");
    expect(shouldPreserveBusinessDisposition({
      existing: "interested",
      incoming: "NOT_CONNECTED: no_answer",
    })).toBe(true);
  });

  it("later busy after previous answer does not erase answered/business state", () => {
    let lead = {
      answeredEver: true,
      callStatus: "completed",
      lastAttemptStatus: "caller_hangup",
      disposition: "interested",
      operationalOutcome: "interest_confirmed",
    };
    lead = applyAnsweredEverTransition(lead, {
      callStatus: "calling",
    });
    lead = applyAnsweredEverTransition(lead, {
      callStatus: "busy",
      lastAttemptStatus: "busy",
    });
    expect(lead.answeredEver).toBe(true);
    expect(lead.disposition).toBe("interested");
    expect(lead.operationalOutcome).toBe("interest_confirmed");
    expect(lead.lastAttemptStatus).toBe("busy");
    expect(lead.callStatus).not.toBe("failed");
  });

  it("webhook race cannot overwrite a connected answered session", () => {
    expect(
      shouldDeferCarrierTerminalOnAnsweredLead({
        v2: true,
        answeredEver: true,
        callStatus: "connected",
      }),
    ).toBe(true);
  });

  it("stuck sweep cannot create answered+failed", () => {
    expect(v2ParkStuckAnswered({ answeredEver: true, retryOk: true })).toBe("pending");
    expect(v2ParkStuckAnswered({ answeredEver: true, retryOk: false })).toBe("completed");
    expect(v2ParkStuckAnswered({ answeredEver: true, retryOk: false })).not.toBe("failed");
    expect(v2ParkStuckAnswered({ answeredEver: false, retryOk: false })).toBe("failed");
  });

  it("answered never-answered failed terminal parks pending/completed, never failed", () => {
    expect(v2ParkNeverAnsweredFailed({
      answeredEver: true,
      mappedStatus: "failed",
      retryOk: true,
    })).toBe("pending");
    expect(v2ParkNeverAnsweredFailed({
      answeredEver: true,
      mappedStatus: "failed",
      retryOk: false,
    })).toBe("completed");
    expect(v2ParkNeverAnsweredFailed({
      answeredEver: true,
      mappedStatus: "busy",
      retryOk: false,
    })).toBe("busy");
  });

  it("cancels a provisional dropped retry after business disposition", () => {
    expect(shouldCancelDroppedRetryAfterDisposition("interested")).toBe(true);
    expect(shouldCancelDroppedRetryAfterDisposition("call back requested")).toBe(true);
    expect(shouldCancelDroppedRetryAfterDisposition("not interested")).toBe(true);
    expect(shouldCancelDroppedRetryAfterDisposition("NOT_CONNECTED: no_answer")).toBe(false);
  });

  it("canary log includes the required fields", () => {
    const log = buildCampaignLeadStateV2CanaryLog({
      campaignId: 449,
      leadId: 11431,
      callId: 26477,
      answeredEver: true,
      classifierClass: "D",
      endReason: "user_hangup",
      expectedDisconnect: true,
      previousCallStatus: "connected",
      finalCallStatus: "completed",
      lastAttemptStatus: "caller_hangup",
      retryScheduled: false,
      retryReason: null,
      retryId: null,
      retryCancelledAfterDisposition: false,
      disposition: "interested",
      operationalOutcome: "interest_confirmed",
      attempts: 1,
    });
    expect(log.event).toBe("campaign_lead_state_v2");
    expect(log.slotReleased).toBe(true);
    expect(CAMPAIGN_LEAD_STATE_V2_EVENT).toBe("Campaign Lead State V2");
  });

  it("legacy/off path remains behaviorally unchanged", () => {
    expect(
      classifyCampaignHangupLegacy({
        isVoicemail: false,
        naturalEndTriggered: false,
        wasTransferred: false,
        durationSeconds: 38,
      }).oldLeadStatus,
    ).toBe("failed");
    expect(isCampaignLeadStateV2Writer(449, { CAMPAIGN_LEAD_STATE_V2: "off" })).toBe(false);
    expect(shouldDeferCarrierTerminalOnAnsweredLead({
      v2: false,
      answeredEver: true,
      callStatus: "connected",
    })).toBe(false);
    expect(v2ParkStuckAnswered({ answeredEver: false, retryOk: true })).toBe("failed");
  });
});
