import { describe, expect, it } from "vitest";
import { CONNECTED_CALL_STATUSES, campaignLeadFunnelSelect, funnelFromRow } from "../lib/campaign-lead-funnel";
import {
  campaignContactState,
  campaignDispositionState,
  campaignReportingRates,
  campaignReportingFilterSql,
  campaignReportingSql,
  campaignReportingViewSql,
  campaignWorkState,
  countReportingMetric,
  displayDispositionBucket,
  flattenDispositionTaxonomy,
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
  resolveConfiguredDisposition,
  summarizeCampaignReporting,
  summarizeDispositionHero,
  summarizeConfiguredDispositionHero,
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

  it("keeps technical labels out of business dispositions after an answered call", () => {
    const row = lead({
      id: 5,
      answeredEver: true,
      callStatus: "voicemail",
      lastAttemptStatus: "voicemail",
      disposition: "outcome: no pickup",
      callAttempts: 1,
    });
    expect(displayDispositionBucket(row)).toBe("");
    expect(campaignDispositionState(row)).toBe("needs_classification");
    expect(leadMatchesReportingFilter(row, { dispositionBucket: "voicemail" })).toBe(false);
    expect(leadMatchesReportingFilter(row, { dispositionBucket: "no pickup" })).toBe(false);
    expect(countReportingMetric([row], "no_pickup")).toBe(0);
  });

  it("preserves a real business disposition when a later attempt reaches voicemail", () => {
    const row = lead({
      id: 6,
      answeredEver: true,
      callStatus: "voicemail",
      lastAttemptStatus: "voicemail",
      disposition: "Interested: eligible",
      callAttempts: 2,
    });
    expect(displayDispositionBucket(row)).toBe("interested");
    expect(campaignDispositionState(row)).toBe("classified");
  });

  it("hero chips contain only answered business dispositions", () => {
    expect(summarizeDispositionHero([
      { answeredEver: true, disposition: "outcome: no pickup", lastAttemptStatus: "voicemail", callStatus: "voicemail", count: 4 },
      { answeredEver: true, disposition: "outcome: interested", lastAttemptStatus: "caller_hangup", callStatus: "completed", count: 13 },
      { answeredEver: true, disposition: null, lastAttemptStatus: "caller_hangup", callStatus: "completed", count: 2 },
      { answeredEver: false, disposition: null, lastAttemptStatus: "busy", callStatus: "busy", count: 31 },
    ])).toEqual([
      { bucket: "interested", count: 13 },
      { bucket: "needs_classification", count: 6 },
    ]);
  });

  it("never-answered leads are not mislabeled as needing classification", () => {
    const unanswered = lead({ id: 8, answeredEver: false, callStatus: "busy", lastAttemptStatus: "busy", callAttempts: 1 });
    const answered = lead({ id: 9, answeredEver: true, callStatus: "completed", lastAttemptStatus: "caller_hangup", callAttempts: 1 });
    expect(campaignDispositionState(unanswered)).toBe("not_applicable");
    expect(campaignDispositionState(answered)).toBe("needs_classification");
    expect(leadMatchesReportingFilter(unanswered, { dispositionBucket: "needs_classification" })).toBe(false);
    expect(leadMatchesReportingFilter(answered, { dispositionBucket: "needs_classification" })).toBe(true);
  });

  it("does not count a stale business outcome on a never-answered lead", () => {
    const stale = lead({
      id: 10,
      answeredEver: false,
      callStatus: "busy",
      lastAttemptStatus: "busy",
      operationalOutcome: "interest_confirmed",
      disposition: "Interested: eligible",
      callAttempts: 1,
    });
    expect(isInterested(stale)).toBe(false);
    expect(countReportingMetric([stale], "interested")).toBe(0);
  });
});

describe("agent-configured business dispositions", () => {
  const taxonomy = {
    "Lead Status": ["Hot Lead", "Warm Lead", "Not Interested"],
    "Next Action": ["Call Back Tomorrow"],
  };

  it("flattens the exact agent taxonomy in configured order", () => {
    expect(flattenDispositionTaxonomy(taxonomy)).toEqual([
      { key: "Lead Status: Hot Lead", label: "Hot Lead", primary: "Lead Status", sub: "Hot Lead" },
      { key: "Lead Status: Warm Lead", label: "Warm Lead", primary: "Lead Status", sub: "Warm Lead" },
      { key: "Lead Status: Not Interested", label: "Not Interested", primary: "Lead Status", sub: "Not Interested" },
      { key: "Next Action: Call Back Tomorrow", label: "Call Back Tomorrow", primary: "Next Action", sub: "Call Back Tomorrow" },
    ]);
  });

  it("does not remap configured labels to platform hardcoded meanings", () => {
    expect(resolveConfiguredDisposition("Lead Status: Hot Lead", taxonomy)?.key)
      .toBe("Lead Status: Hot Lead");
    expect(resolveConfiguredDisposition("Interested: eligible", taxonomy)).toBeNull();
  });

  it("renders zero-count configured outcomes and quarantines unknown values", () => {
    expect(summarizeConfiguredDispositionHero([
      { answeredEver: true, disposition: "Lead Status: Hot Lead", count: 7 },
      { answeredEver: true, disposition: "Hot Lead", count: 2 },
      { answeredEver: true, disposition: "provider invented value", count: 3 },
      { answeredEver: false, disposition: null, count: 20 },
    ], taxonomy)).toEqual([
      { key: "Lead Status: Hot Lead", label: "Hot Lead", primary: "Lead Status", sub: "Hot Lead", count: 9, kind: "configured" },
      { key: "Lead Status: Warm Lead", label: "Warm Lead", primary: "Lead Status", sub: "Warm Lead", count: 0, kind: "configured" },
      { key: "Lead Status: Not Interested", label: "Not Interested", primary: "Lead Status", sub: "Not Interested", count: 0, kind: "configured" },
      { key: "Next Action: Call Back Tomorrow", label: "Call Back Tomorrow", primary: "Next Action", sub: "Call Back Tomorrow", count: 0, kind: "configured" },
      { key: "needs_classification", label: "Needs classification", primary: "", sub: null, count: 3, kind: "needs_classification" },
    ]);
  });

  it("projects a lead against the configured taxonomy", () => {
    const configured = projectCampaignLeadReporting(lead({
      id: 70,
      answeredEver: true,
      disposition: "Lead Status: Warm Lead",
      callStatus: "completed",
      callAttempts: 1,
    }), taxonomy);
    expect(configured.dispositionBucket).toBe("Lead Status: Warm Lead");
    expect(configured.dispositionState).toBe("classified");

    const invalid = projectCampaignLeadReporting(lead({
      id: 71,
      answeredEver: true,
      disposition: "Interested",
      callStatus: "completed",
      callAttempts: 1,
    }), taxonomy);
    expect(invalid.dispositionBucket).toBe("");
    expect(invalid.dispositionState).toBe("needs_classification");
  });

  it("uses the same taxonomy resolution for card filters as card counts", () => {
    const exact = lead({
      id: 72,
      answeredEver: true,
      disposition: "Lead Status: Hot Lead",
      callStatus: "completed",
      callAttempts: 1,
    });
    const legacySubOnly = lead({
      id: 73,
      answeredEver: true,
      disposition: "hot_lead",
      callStatus: "completed",
      callAttempts: 1,
    });
    const unknown = lead({
      id: 74,
      answeredEver: true,
      disposition: "provider invented value",
      callStatus: "completed",
      callAttempts: 1,
    });

    expect([exact, legacySubOnly, unknown].filter((row) => leadMatchesReportingFilter(
      row,
      { disposition: "Lead Status: Hot Lead" },
      taxonomy,
    )).map((row) => row.id)).toEqual([72, 73]);
    expect([exact, legacySubOnly, unknown].filter((row) => leadMatchesReportingFilter(
      row,
      { dispositionBucket: "needs_classification" },
      taxonomy,
    )).map((row) => row.id)).toEqual([74]);
  });

  it("does not guess when the same legacy sub-label exists in two categories", () => {
    const ambiguous = {
      "Lead Status": ["Qualified"],
      "Eligibility": ["Qualified"],
    };
    expect(resolveConfiguredDisposition("Qualified", ambiguous)).toBeNull();
    expect(campaignDispositionState({
      answeredEver: true,
      disposition: "Qualified",
      callStatus: "completed",
    }, ambiguous)).toBe("needs_classification");
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
    expect(campaignReportingViewSql("attempted")).toBe(campaignReportingSql.attempted);
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
      "attempted", "interested", "callback", "retry", "answered", "no_pickup", "busy", "voicemail", "technical_failed",
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
