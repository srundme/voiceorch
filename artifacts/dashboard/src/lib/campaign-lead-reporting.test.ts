import { describe, expect, it } from "vitest";
import {
  OUTCOME_CARDS,
  PRIMARY_LEAD_VIEWS,
  attemptStatusLabel,
  batchLeadsHref,
  businessOutcomeLabel,
  campaignLeadsHref,
  contactStateLabel,
  displayDispositionLabel,
  leadsSearchFromFilter,
  nextWorkLabel,
  parseLeadsSearch,
  primaryLeadTone,
  resolveCampaignTab,
  type CampaignReportingLead,
} from "./campaign-lead-reporting";

function lead(partial: Partial<CampaignReportingLead>): CampaignReportingLead {
  return {
    leadId: 1,
    batchId: 412,
    phone: "+91",
    name: "Test",
    answeredEver: false,
    lifecycleStatus: "pending",
    lastAttemptStatus: null,
    operationalOutcome: "pending",
    disposition: null,
    dispositionState: "not_applicable",
    callAttempts: 0,
    latestCallId: null,
    latestAnsweredCallId: null,
    latestAnsweredDuration: null,
    retryPending: false,
    retryScheduledAt: null,
    retryReason: null,
    retryCount: 0,
    callbackRequested: false,
    bookingCreated: false,
    transferCompleted: false,
    contactState: "never_attempted",
    workState: "terminal",
    ...partial,
  };
}

describe("campaign tab IA", () => {
  it("collapses legacy eight tabs into four workspaces", () => {
    expect(resolveCampaignTab("live-queue")).toEqual({ tab: "overview" });
    expect(resolveCampaignTab("callbacks")).toEqual({ tab: "leads", view: "callback" });
    expect(resolveCampaignTab("transfers")).toEqual({ tab: "leads", operationalOutcome: "transfer_completed" });
    expect(resolveCampaignTab("bookings")).toEqual({ tab: "leads", operationalOutcome: "booking_created" });
    expect(resolveCampaignTab("config")).toEqual({ tab: "settings" });
    expect(resolveCampaignTab("incoming")).toEqual({ tab: "leads" });
    expect(resolveCampaignTab("leads")).toEqual({ tab: "leads" });
  });
});

describe("leads URL filters are linkable", () => {
  it("round-trips view=interested", () => {
    const href = campaignLeadsHref(449, { view: "interested" });
    expect(href).toBe("/app/campaigns/449?tab=leads&view=interested");
    expect(parseLeadsSearch("tab=leads&view=interested").view).toBe("interested");
  });

  it("maps every Overview outcome card to the same view= filter", () => {
    for (const card of OUTCOME_CARDS) {
      const href = campaignLeadsHref(449, { view: card.view });
      expect(href).toBe(`/app/campaigns/449?tab=leads&view=${card.view}`);
      expect(parseLeadsSearch(href.split("?")[1] ?? "").view).toBe(card.view);
    }
  });

  it("keeps campaign filters campaign-level and batch filters batch-scoped", () => {
    expect(campaignLeadsHref(449, { view: "busy" })).toBe("/app/campaigns/449?tab=leads&view=busy");
    expect(campaignLeadsHref(449, { view: "busy" })).not.toContain("batchId=");
    const batchHref = batchLeadsHref(449, 412, { view: "busy" });
    expect(batchHref).toBe("/app/campaigns/449/batches/412?view=busy");
    expect(batchHref).not.toContain("tab=leads");
  });

  it("round-trips the needs-classification business filter", () => {
    const href = campaignLeadsHref(449, { dispositionBucket: "needs_classification" });
    expect(href).toBe("/app/campaigns/449?tab=leads&dispositionBucket=needs_classification");
    expect(parseLeadsSearch(href.split("?")[1] ?? "").dispositionBucket).toBe("needs_classification");
  });

  it("combines search with view=", () => {
    const href = campaignLeadsHref(449, { view: "answered", search: "priya" });
    expect(href).toContain("view=answered");
    expect(href).toContain("search=priya");
    const parsed = parseLeadsSearch(href.split("?")[1] ?? "");
    expect(parsed).toMatchObject({ view: "answered", search: "priya" });
  });

  it("round-trips refresh/back query state including answered + retry chips", () => {
    for (const view of PRIMARY_LEAD_VIEWS.map((v) => v.id).filter((id) => id !== "all")) {
      const qs = leadsSearchFromFilter({ view }).slice(1);
      expect(parseLeadsSearch(qs).view).toBe(view);
    }
  });

  it("preserves extra filters on parse", () => {
    const parsed = parseLeadsSearch("view=retry&batchId=412&answeredEver=true");
    expect(parsed).toMatchObject({ view: "retry", batchId: 412, answeredEver: true });
  });
  it("maps Failed chip to technical_failed and Retry to retry", () => {
    expect(campaignLeadsHref(449, { view: "technical_failed" })).toBe(
      "/app/campaigns/449?tab=leads&view=technical_failed",
    );
    expect(campaignLeadsHref(449, { view: "retry" })).toBe(
      "/app/campaigns/449?tab=leads&view=retry",
    );
    expect(parseLeadsSearch("view=technical_failed").view).toBe("technical_failed");
    expect(batchLeadsHref(449, 412, { view: "technical_failed" })).toContain("view=technical_failed");
  });
  it("humanizes snake_case disposition labels", () => {
    expect(displayDispositionLabel("nature_of_business")).toBe("Nature Of Business");
    expect(displayDispositionLabel("needs_classification")).toBe("Needs classification");
  });
});

describe("historical answered+failed presentation", () => {
  it("renders Contact=Answered and not a primary Failed tone", () => {
    const row = lead({
      answeredEver: true,
      lifecycleStatus: "failed",
      lastAttemptStatus: "completed",
      operationalOutcome: "no_contact",
      contactState: "answered",
      callAttempts: 1,
    });
    expect(contactStateLabel(row.contactState)).toBe("Answered");
    expect(primaryLeadTone(row)).toBe("default");
    expect(nextWorkLabel(row)).toBe("Terminal");
  });

  it("later busy after answer stays Answered / Interested / Busy", () => {
    const row = lead({
      answeredEver: true,
      lifecycleStatus: "busy",
      lastAttemptStatus: "busy",
      operationalOutcome: "interest_confirmed",
      contactState: "answered",
      callAttempts: 2,
    });
    expect(contactStateLabel(row.contactState)).toBe("Answered");
    expect(businessOutcomeLabel(row.operationalOutcome)).toBe("Interested");
    expect(attemptStatusLabel(row.lastAttemptStatus)).toBe("Busy");
    expect(primaryLeadTone(row)).toBe("default");
  });

  it("answered+failed last_attempt failed is not a primary red Failed", () => {
    const row = lead({
      answeredEver: true,
      lifecycleStatus: "failed",
      lastAttemptStatus: "failed",
      operationalOutcome: "no_contact",
      contactState: "answered",
      callAttempts: 1,
    });
    expect(contactStateLabel(row.contactState)).toBe("Answered");
    expect(primaryLeadTone(row)).toBe("default");
    expect(businessOutcomeLabel(row.operationalOutcome)).toBe("No Contact");
  });

  it("never-answered technical failed is attention", () => {
    const row = lead({
      answeredEver: false,
      lifecycleStatus: "failed",
      contactState: "attempted",
      callAttempts: 2,
    });
    expect(primaryLeadTone(row)).toBe("attention");
  });
});

describe("disposition display", () => {
  it("title-cases canonical buckets", () => {
    expect(displayDispositionLabel("no pickup")).toBe("No Pickup");
    expect(displayDispositionLabel("voicemail")).toBe("Voicemail");
    expect(displayDispositionLabel("callback requested")).toBe("Callback Requested");
    expect(displayDispositionLabel("unlabeled")).toBe("Needs classification");
    expect(displayDispositionLabel("needs_classification")).toBe("Needs classification");
  });
});
