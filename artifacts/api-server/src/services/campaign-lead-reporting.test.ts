import { describe, expect, it } from "vitest";
import { CONNECTED_CALL_STATUSES, campaignLeadFunnelSelect, funnelFromRow } from "../lib/campaign-lead-funnel";
import {
  campaignContactState,
  campaignReportingRates,
  campaignReportingFilterSql,
  campaignReportingSql,
  campaignReportingViewSql,
  campaignWorkState,
  countReportingMetric,
  displayDispositionBucket,
  isAnswered,
  isBusy,
  isCallingNow,
  isInterested,
  isNoPickup,
  isRetryPending,
  isTalkingNow,
  isTechnicalFailed,
  leadMatchesReportingFilter,
  leadMatchesReportingView,
  parseCampaignReportingFilter,
  projectCampaignLeadReporting,
  summarizeCampaignReporting,
  type CampaignReportingLeadInput,
} from "./campaign-lead-reporting";

function lead(partial: Partial<CampaignReportingLeadInput> & { id: number }): CampaignReportingLeadInput {
  return {
    answeredEver: false,
    callStatus: "pending",
    callAttempts: 0,
    retryPending: false,
    ...partial,
  };
}

describe("legacy production funnel is unchanged", () => {
  it("still defines Connected as call_status in connected/completed/transferred", () => {
    expect(CONNECTED_CALL_STATUSES).toEqual(["connected", "completed", "transferred"]);
    const select = campaignLeadFunnelSelect();
    expect(select).toHaveProperty("connected");
    expect(select).toHaveProperty("failed");
    expect(select).not.toHaveProperty("answered");
    expect(select).not.toHaveProperty("answeredEver");
  });

  it("still computes successRate as interested / called", () => {
    expect(funnelFromRow({
      imported: 151,
      called: 151,
      connected: 33,
      interested: 2,
      booked: 0,
      transferred: 0,
      failed: 71,
      busy: 28,
      noPickup: 5,
      voicemail: 14,
      pending: 0,
    }).successRate).toBe(1);
  });
});

describe("answered_ever drives Answered", () => {
  it("counts answered_ever true even when lifecycle is not connected", () => {
    const rows = [
      lead({ id: 1, answeredEver: true, callStatus: "completed", callAttempts: 1 }),
      lead({ id: 2, answeredEver: false, callStatus: "connected", callAttempts: 1 }),
      lead({ id: 3, answeredEver: false, callStatus: "failed", callAttempts: 1 }),
    ];
    expect(countReportingMetric(rows, "answered")).toBe(1);
    expect(isAnswered(rows[1]!)).toBe(false);
    expect(isTalkingNow(rows[1]!)).toBe(true);
  });

  it("answered + historical failed still counts Answered", () => {
    const row = lead({
      id: 10,
      answeredEver: true,
      callStatus: "failed",
      lastAttemptStatus: "completed",
      callAttempts: 2,
      callId: 99,
      latestAnsweredDuration: 38,
    });
    expect(isAnswered(row)).toBe(true);
    expect(campaignContactState(row)).toBe("answered");
    expect(countReportingMetric([row], "answered")).toBe(1);
    expect(projectCampaignLeadReporting(row).latestAnsweredCallId).toBe(99);
    expect(projectCampaignLeadReporting(row).latestAnsweredDuration).toBe(38);
    expect(projectCampaignLeadReporting(row).lifecycleStatus).toBe("failed");
  });

  it("historical failed after answered does NOT count Technical Failed", () => {
    const row = lead({
      id: 11,
      answeredEver: true,
      callStatus: "failed",
      lastAttemptStatus: "completed",
      callAttempts: 1,
    });
    expect(isTechnicalFailed(row)).toBe(false);
    expect(countReportingMetric([row], "technical_failed")).toBe(0);
  });

  it("never-answered genuine failed counts Technical Failed", () => {
    const row = lead({
      id: 12,
      answeredEver: false,
      callStatus: "failed",
      lastAttemptStatus: "failed",
      callAttempts: 2,
    });
    expect(isTechnicalFailed(row)).toBe(true);
    expect(isAnswered(row)).toBe(false);
  });

  it("later busy after previous answer does not remove Answered", () => {
    const row = lead({
      id: 13,
      answeredEver: true,
      callStatus: "busy",
      lastAttemptStatus: "busy",
      callAttempts: 3,
    });
    expect(isAnswered(row)).toBe(true);
    expect(isBusy(row)).toBe(false);
    expect(campaignContactState(row)).toBe("answered");
  });
});

describe("count definition equals row-filter definition", () => {
  const rows: CampaignReportingLeadInput[] = [
    lead({ id: 1, answeredEver: true, callStatus: "completed", operationalOutcome: "interest_confirmed", callAttempts: 1 }),
    lead({ id: 2, answeredEver: true, callStatus: "failed", operationalOutcome: "interest_confirmed", callAttempts: 1, lastAttemptStatus: "completed" }),
    lead({ id: 3, answeredEver: true, callStatus: "completed", operationalOutcome: "callback_requested", callAttempts: 1, retryPending: true }),
    lead({ id: 4, answeredEver: false, callStatus: "no_pickup", lastAttemptStatus: "no_pickup", callAttempts: 1 }),
    lead({ id: 5, answeredEver: false, callStatus: "busy", lastAttemptStatus: "busy", callAttempts: 1 }),
    lead({ id: 6, answeredEver: false, callStatus: "failed", lastAttemptStatus: "failed", callAttempts: 2 }),
    lead({ id: 7, answeredEver: true, callStatus: "voicemail", lastAttemptStatus: "voicemail", callAttempts: 1 }),
    lead({ id: 8, answeredEver: true, callStatus: "completed", operationalOutcome: "booking_created", callAttempts: 1 }),
    lead({ id: 9, retryPending: true, retryCount: 2, callStatus: "pending", callAttempts: 1, answeredEver: false }),
  ];

  it("interested count equals interested-filter row count", () => {
    const count = countReportingMetric(rows, "interested");
    const filtered = rows.filter((r) => leadMatchesReportingView(r, "interested"));
    expect(count).toBe(2);
    expect(filtered.map((r) => r.id)).toEqual([1, 2]);
    expect(filtered).toHaveLength(count);
  });

  it("callback count equals callback-filter row count", () => {
    const count = countReportingMetric(rows, "callback");
    const filtered = rows.filter((r) => leadMatchesReportingView(r, "callback"));
    expect(count).toBe(1);
    expect(filtered).toHaveLength(count);
    expect(filtered[0]?.id).toBe(3);
  });

  it("retry count uses distinct leads, not retry rows", () => {
    const twoRetries = lead({
      id: 20,
      retryPending: true,
      retryCount: 2,
      callStatus: "pending",
      callAttempts: 1,
    });
    const none = lead({ id: 21, retryPending: false, retryCount: 0, callAttempts: 1 });
    expect(countReportingMetric([twoRetries, none], "retry")).toBe(1);
    expect(isRetryPending(twoRetries)).toBe(true);
    expect(projectCampaignLeadReporting(twoRetries).retryCount).toBe(2);
  });

  it("talking-now uses connected only", () => {
    const rowsNow = [
      lead({ id: 1, callStatus: "connected", answeredEver: true, callAttempts: 1 }),
      lead({ id: 2, callStatus: "completed", answeredEver: true, callAttempts: 1 }),
      lead({ id: 3, callStatus: "calling", callAttempts: 1 }),
    ];
    expect(countReportingMetric(rowsNow, "talking")).toBe(1);
    expect(isTalkingNow(rowsNow[0]!)).toBe(true);
    expect(isTalkingNow(rowsNow[1]!)).toBe(false);
  });

  it("calling-now uses calling only", () => {
    const rowsNow = [
      lead({ id: 1, callStatus: "calling", callAttempts: 1 }),
      lead({ id: 2, callStatus: "connected", answeredEver: true, callAttempts: 1 }),
    ];
    expect(countReportingMetric(rowsNow, "calling")).toBe(1);
    expect(isCallingNow(rowsNow[0]!)).toBe(true);
  });

  it("KPI queries do not duplicate leads through retries/bookings/transfers", () => {
    const oneLead = lead({
      id: 30,
      answeredEver: true,
      callStatus: "completed",
      operationalOutcome: "booking_created",
      callAttempts: 2,
      retryPending: true,
      retryCount: 3,
    });
    const summary = summarizeCampaignReporting([oneLead]);
    expect(summary.funnel.imported).toBe(1);
    expect(summary.funnel.answered).toBe(1);
    expect(summary.funnel.booked).toBe(1);
    expect(summary.funnel.interested).toBe(0);
    expect(summary.workTechnical.retryPending).toBe(1);
  });
});

describe("no-pickup / busy / voicemail / technical failed", () => {
  it("no-pickup requires never answered", () => {
    const never = lead({ id: 1, answeredEver: false, callStatus: "no_pickup", lastAttemptStatus: "no_pickup", callAttempts: 1 });
    const afterAnswer = lead({ id: 2, answeredEver: true, callStatus: "no_pickup", lastAttemptStatus: "no_pickup", callAttempts: 2 });
    expect(isNoPickup(never)).toBe(true);
    expect(isNoPickup(afterAnswer)).toBe(false);
    expect(isAnswered(afterAnswer)).toBe(true);
  });

  it("falls back to call_status when last_attempt_status is null", () => {
    expect(isNoPickup(lead({ id: 1, answeredEver: false, callStatus: "no_pickup", callAttempts: 1 }))).toBe(true);
    expect(isBusy(lead({ id: 2, answeredEver: false, callStatus: "busy", callAttempts: 1 }))).toBe(true);
    expect(isTechnicalFailed(lead({ id: 3, answeredEver: false, callStatus: "failed", callAttempts: 1 }))).toBe(true);
  });

  it("voicemail does not erase answered history", () => {
    const row = lead({
      id: 4,
      answeredEver: true,
      callStatus: "voicemail",
      lastAttemptStatus: "voicemail",
      callAttempts: 1,
    });
    expect(isAnswered(row)).toBe(true);
    expect(countReportingMetric([row], "voicemail")).toBe(1);
    expect(countReportingMetric([row], "answered")).toBe(1);
  });

  it("treats a voicemail attempt with an LLM no-pickup stamp as voicemail", () => {
    const row = lead({
      id: 5,
      answeredEver: true,
      callStatus: "voicemail",
      lastAttemptStatus: "voicemail",
      disposition: "outcome: no pickup",
      callAttempts: 1,
    });
    expect(displayDispositionBucket(row)).toBe("voicemail");
    expect(leadMatchesReportingFilter(row, { dispositionBucket: "voicemail" })).toBe(true);
    expect(leadMatchesReportingFilter(row, { dispositionBucket: "no pickup" })).toBe(false);
    expect(countReportingMetric([row], "no_pickup")).toBe(0);
  });
});

describe("rates and work/contact state", () => {
  it("names answer / interest / conversion separately from legacy Success Rate", () => {
    const rates = campaignReportingRates({
      attempted: 100,
      answered: 40,
      interested: 10,
      legacyInterested: 16,
    });
    expect(rates.answerRate).toBe(0.4);
    expect(rates.interestRate).toBe(0.25);
    expect(rates.conversionRate).toBe(0.1);
    expect(rates.legacySuccessRate).toBe(16);
    expect(rates).not.toHaveProperty("successRate");
  });

  it("derives contactState and workState without a persisted mega-status", () => {
    expect(campaignContactState({ answeredEver: false, callAttempts: 0 })).toBe("never_attempted");
    expect(campaignContactState({ answeredEver: false, callAttempts: 1 })).toBe("attempted");
    expect(campaignContactState({ answeredEver: true, callAttempts: 1 })).toBe("answered");
    expect(campaignWorkState({ callStatus: "connected" })).toBe("live");
    expect(campaignWorkState({ callStatus: "pending", retryPending: true })).toBe("retry_scheduled");
    expect(campaignWorkState({ callStatus: "completed", operationalOutcome: "callback_requested" })).toBe("callback_due");
    expect(campaignWorkState({ callStatus: "completed" })).toBe("terminal");
  });
});

describe("filter contract", () => {
  it("parseCampaignReportingFilter reads view plus layer filters", () => {
    expect(parseCampaignReportingFilter({
      view: "interested",
      answeredEver: "true",
      retryPending: "false",
      batchId: "412",
      lifecycleStatus: "failed",
      search: "9876",
    })).toEqual({
      view: "interested",
      disposition: null,
      dispositionBucket: null,
      operationalOutcome: null,
      answeredEver: true,
      lifecycleStatus: "failed",
      lastAttemptStatus: null,
      retryPending: false,
      batchId: 412,
      source: null,
      search: "9876",
    });
  });

  it("ANDs view with extra filters so Interested-86 cannot silently widen", () => {
    const rows = [
      lead({ id: 1, operationalOutcome: "interest_confirmed", answeredEver: true, callAttempts: 1, batchId: 412 }),
      lead({ id: 2, operationalOutcome: "interest_confirmed", answeredEver: true, callAttempts: 1, batchId: 999 }),
      lead({ id: 3, operationalOutcome: "booking_created", answeredEver: true, callAttempts: 1, batchId: 412 }),
    ];
    const interested = rows.filter((r) => leadMatchesReportingFilter(r, { view: "interested" }));
    expect(interested.map((r) => r.id)).toEqual([1, 2]);
    const batch412 = rows.filter((r) => leadMatchesReportingFilter(r, { view: "interested", batchId: 412 }));
    expect(batch412.map((r) => r.id)).toEqual([1]);
  });

  it("ANDs search with view so answered rows can be narrowed by name", () => {
    const rows = [
      lead({ id: 1, name: "Priya", answeredEver: true, callAttempts: 1, phone: "111" }),
      lead({ id: 2, name: "Amit", answeredEver: true, callAttempts: 1, phone: "222" }),
      lead({ id: 3, name: "Priya", answeredEver: false, callAttempts: 1, phone: "333", lastAttemptStatus: "busy", callStatus: "busy" }),
    ];
    const answeredPriya = rows.filter((r) => leadMatchesReportingFilter(r, { view: "answered", search: "priya" }));
    expect(answeredPriya.map((r) => r.id)).toEqual([1]);
  });
});

describe("SQL fragments stay on the four-layer model", () => {
  it("view SQL is the same object as the KPI predicate SQL", () => {
    expect(campaignReportingViewSql("answered")).toBe(campaignReportingSql.answered);
    expect(campaignReportingViewSql("interested")).toBe(campaignReportingSql.interested);
    expect(campaignReportingViewSql("callback")).toBe(campaignReportingSql.callbacks);
    expect(campaignReportingViewSql("retry")).toBe(campaignReportingSql.retryPending);
    expect(campaignReportingViewSql("no_pickup")).toBe(campaignReportingSql.noPickup);
    expect(campaignReportingViewSql("busy")).toBe(campaignReportingSql.busy);
    expect(campaignReportingViewSql("voicemail")).toBe(campaignReportingSql.voicemail);
    expect(campaignReportingViewSql("technical_failed")).toBe(campaignReportingSql.technicalFailed);
  });

  it("filter SQL for each view is the same object as the KPI/view predicate", () => {
    for (const view of [
      "interested", "callback", "retry", "answered", "no_pickup", "busy", "voicemail", "technical_failed",
    ] as const) {
      expect(campaignReportingFilterSql({ view })[0]).toBe(campaignReportingViewSql(view));
    }
  });

  it("talking SQL is not reused for Answered", () => {
    expect(campaignReportingSql.talking).not.toBe(campaignReportingSql.answered);
    expect(campaignReportingViewSql("answered")).not.toBe(campaignReportingSql.talking);
  });
});

describe("legacy vs canonical overlap is valid", () => {
  it("a lead can be answered + interested + retryPending at once", () => {
    const row = lead({
      id: 40,
      answeredEver: true,
      callStatus: "pending",
      operationalOutcome: "interest_confirmed",
      retryPending: true,
      callAttempts: 1,
    });
    expect(isAnswered(row)).toBe(true);
    expect(isInterested(row)).toBe(true);
    expect(isRetryPending(row)).toBe(true);
    expect(isTechnicalFailed(row)).toBe(false);
  });
});
