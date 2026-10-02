import { and, eq, inArray } from "drizzle-orm";
import {
  salesActivitiesTable,
  salesCompaniesTable,
  salesContactsTable,
  salesExpensesTable,
  salesOpportunitiesTable,
  salesPaymentsTable,
  salesPilotSnapshotsTable,
  salesPilotsTable,
  salesProposalsTable,
  salesStageHistoryTable,
  salesSubscriptionsTable,
  salesTasksTable,
  salesTouchpointsTable,
} from "@workspace/db/schema";
import { writeAudit, type SalesActor, type SalesDb } from "./db.js";
import { normalizeCompanyName, normalizePhone } from "./normalize.js";
import type { SalesConfig } from "./settings-schema.js";
import { addDays, addMonths, localDateString } from "./time.js";

const DAY = 86_400_000;

export const DEMO_COMPANIES = [
  { key: "kaveri", name: "Demo — Kaveri HR Consultants (fictional)", sector: "HR consultancy", city: "Bengaluru", area: "Jayanagar", contact: "Asha (fictional)", phone: "+91 00000 00001", email: "asha@kaveri-hr.example.invalid" },
  { key: "nandi", name: "Demo — Nandi Loan Associates (fictional)", sector: "Loan DSA", city: "Bengaluru", area: "Malleshwaram", contact: "Ravi (fictional)", phone: "+91 00000 00002", email: "ravi@nandi-loans.example.invalid" },
  { key: "cubbon", name: "Demo — Cubbon Realty Partners (fictional)", sector: "Real estate", city: "Chennai", area: "Adyar", contact: "Meena (fictional)", phone: "+91 00000 00003", email: "meena@cubbon-realty.example.invalid" },
] as const;

export async function demoStatus(db: SalesDb) {
  const rows = await db.select({ id: salesCompaniesTable.id }).from(salesCompaniesTable).where(eq(salesCompaniesTable.isDemo, true));
  return { demoCompanies: rows.length };
}

export async function seedDemo(db: SalesDb, actor: SalesActor, config: SalesConfig, now = new Date()) {
  return db.transaction(async (tx) => {
    const names = DEMO_COMPANIES.map((c) => c.name);
    const existing = await tx
      .select({ id: salesCompaniesTable.id, name: salesCompaniesTable.name })
      .from(salesCompaniesTable)
      .where(and(eq(salesCompaniesTable.isDemo, true), inArray(salesCompaniesTable.name, names)));
    if (existing.length) return { seeded: false, companyIds: existing.map((c) => c.id) };

    const ids: Record<string, number> = {};
    const t = (daysAgo: number, hourUtc = 6) => new Date(Math.floor((now.getTime() - daysAgo * DAY) / DAY) * DAY + hourUtc * 3_600_000);
    for (const c of DEMO_COMPANIES) {
      const [company] = await tx
        .insert(salesCompaniesTable)
        .values({
          isDemo: true,
          name: c.name,
          nameNormalized: normalizeCompanyName(c.name),
          sector: c.sector,
          city: c.city,
          area: c.area,
          ownerId: actor.id,
          source: c.key === "cubbon" ? "website_form" : "field_visit",
          originalSource: c.key === "cubbon" ? "website_form" : "field_visit",
          originalEnquiryAt: t(12),
          isInbound: c.key === "cubbon",
          painPoint: "Missed inbound calls after office hours (fictional)",
          callingVolume: 1500,
          budgetFit: "yes",
          decisionMaker: c.contact,
          lastActivityAt: t(2),
          internalNotes: "Demo data — fictional company.",
          customerNotes: "Demo data — fictional company.",
          createdBy: actor.id,
        })
        .returning();
      ids[c.key] = company!.id;
      await tx.insert(salesTouchpointsTable).values({
        companyId: company!.id,
        kind: "original",
        source: company!.originalSource,
        occurredAt: t(12),
        isDemo: true,
        createdBy: actor.id,
      });
      await tx.insert(salesContactsTable).values({
        companyId: company!.id,
        name: c.contact,
        role: "Owner",
        phone: c.phone,
        phoneNormalized: normalizePhone(c.phone),
        email: c.email,
        emailNormalized: c.email,
        isDecisionMaker: true,
      });
      await tx.insert(salesActivitiesTable).values([
        { companyId: company!.id, ownerId: actor.id, type: "visit", status: "completed", occurredAt: t(10), flagVisit: true, flagFirstVisit: true, flagBuyerConversation: true, outcome: "Met the owner (fictional)", isDemo: true, createdBy: actor.id },
        { companyId: company!.id, ownerId: actor.id, type: "demo", status: "completed", occurredAt: t(7), flagDemo: true, flagBuyerConversation: true, outcome: "Demo went well (fictional)", isDemo: true, createdBy: actor.id },
      ]);
    }

    const stages: Record<string, string> = { kaveri: "Paid", nandi: "Pilot running", cubbon: "Qualified" };
    const oppIds: Record<string, number> = {};
    for (const c of DEMO_COMPANIES) {
      const [opp] = await tx
        .insert(salesOpportunitiesTable)
        .values({ companyId: ids[c.key]!, stage: stages[c.key]!, stageChangedAt: t(2), ownerId: actor.id, isDemo: true })
        .returning();
      oppIds[c.key] = opp!.id;
      await tx.insert(salesStageHistoryTable).values({ opportunityId: opp!.id, fromStage: null, toStage: stages[c.key]!, changedBy: actor.id, changedAt: t(2), note: "Demo seed" });
    }

    const [pilot] = await tx
      .insert(salesPilotsTable)
      .values({
        companyId: ids["nandi"]!,
        opportunityId: oppIds["nandi"]!,
        status: "Calling",
        useCase: "Call back loan enquiries within 5 minutes (fictional)",
        language: "Kannada + English",
        qualificationCriteria: "Salaried, loan need above ₹5 lakh (fictional)",
        approvedScript: "Demo script (fictional)",
        leadCount: 300,
        contactBasisConfirmed: true,
        onboardingStartedAt: t(5),
        campaignStartedAt: t(4),
        reviewAt: new Date(now.getTime() + 2 * DAY),
        ownerId: actor.id,
        attemptAllowance: config.pilot.attemptAllowance,
        readiness: { dataReady: true, scriptApproved: true, callerIdReady: true, testCallDone: true, contactBasisConfirmed: true },
        qualityReview: { firstFiveAnsweredReviewed: true },
        customerReportNotes: "Demo pilot — all numbers are fictional.",
        internalNotes: "Demo internal note (fictional).",
        isDemo: true,
      })
      .returning();
    await tx.insert(salesPilotSnapshotsTable).values([
      { pilotId: pilot!.id, snapshotKey: "demo:day1", asOf: t(3), source: "demo", attempts: 80, distinctRecords: 70, answered: 40, meaningful: 25, qualifiedPeople: 10, acceptedOutcomes: 6, callbackRequests: 5, confirmedAppointments: 3, connectedMinutes: 90, costPaise: 120_000, createdBy: actor.id },
      { pilotId: pilot!.id, snapshotKey: "demo:day2", asOf: t(1), source: "demo", attempts: 160, distinctRecords: 140, answered: 85, meaningful: 50, qualifiedPeople: 22, acceptedOutcomes: 12, callbackRequests: 9, confirmedAppointments: 7, connectedMinutes: 190, costPaise: 250_000, createdBy: actor.id },
    ]);

    const [proposal] = await tx
      .insert(salesProposalsTable)
      .values({
        companyId: ids["kaveri"]!,
        opportunityId: oppIds["kaveri"]!,
        monthlyFeePaise: config.offer.monthlyFeePaise,
        includedMinutes: config.offer.includedMinutes,
        gstRateBps: config.offer.gstRateBps,
        status: "accepted",
        sentAt: t(4),
        termsAcceptedAt: t(3),
        termsAcceptedBy: "Asha (fictional)",
        createdBy: actor.id,
      })
      .returning();
    const paidAt = t(2);
    const startDate = localDateString(t(1), config.timezone);
    const [sub] = await tx
      .insert(salesSubscriptionsTable)
      .values({
        companyId: ids["kaveri"]!,
        proposalId: proposal!.id,
        monthlyFeePaise: proposal!.monthlyFeePaise,
        includedMinutes: proposal!.includedMinutes,
        customerOwnerId: actor.id,
        status: "active",
        startDate,
        renewalDate: addMonths(startDate, 1),
        onboardingChecks: { numberConnected: true, scriptLive: true, reportingShared: false },
        isDemo: true,
      })
      .returning();
    await tx.insert(salesPaymentsTable).values({
      companyId: ids["kaveri"]!,
      proposalId: proposal!.id,
      subscriptionId: sub!.id,
      kind: "first_month",
      feePaise: proposal!.monthlyFeePaise,
      taxPaise: Math.round((proposal!.monthlyFeePaise * proposal!.gstRateBps) / 10_000),
      reference: "DEMO-UTR-0001",
      receivedAt: paidAt,
      status: "verified",
      verifiedAt: paidAt,
      verifiedBy: actor.id,
      isDemo: true,
      createdBy: actor.id,
    });
    await tx.update(salesCompaniesTable).set({ firstPaidAt: paidAt }).where(eq(salesCompaniesTable.id, ids["kaveri"]!));
    await tx.insert(salesTasksTable).values({
      companyId: ids["cubbon"]!,
      ownerId: actor.id,
      title: "Book a demo with Meena (fictional)",
      kind: "follow_up",
      dueAt: new Date(now.getTime() + DAY),
      dedupeKey: `demo:${ids["cubbon"]}:follow_up`,
      isDemo: true,
      createdBy: actor.id,
    });
    await tx.insert(salesExpensesTable).values({
      date: addDays(localDateString(now, config.timezone), -3),
      category: "ads",
      isAcquisition: true,
      source: "website_form",
      amountPaise: 500_000,
      description: "Demo ad spend (fictional)",
      isDemo: true,
      createdBy: actor.id,
    });
    await writeAudit(tx, { actorUserId: actor.id, entity: "sales_demo", entityId: null, action: "seeded", after: { companyIds: Object.values(ids) } });
    return { seeded: true, companyIds: Object.values(ids) };
  });
}

export async function clearDemo(db: SalesDb, actor: SalesActor) {
  return db.transaction(async (tx) => {
    const tasks = await tx.delete(salesTasksTable).where(eq(salesTasksTable.isDemo, true)).returning({ id: salesTasksTable.id });
    const expenses = await tx.delete(salesExpensesTable).where(eq(salesExpensesTable.isDemo, true)).returning({ id: salesExpensesTable.id });
    await tx.delete(salesPaymentsTable).where(eq(salesPaymentsTable.isDemo, true));
    await tx.delete(salesSubscriptionsTable).where(eq(salesSubscriptionsTable.isDemo, true));
    await tx.delete(salesPilotsTable).where(eq(salesPilotsTable.isDemo, true));
    await tx.delete(salesActivitiesTable).where(eq(salesActivitiesTable.isDemo, true));
    await tx.delete(salesOpportunitiesTable).where(eq(salesOpportunitiesTable.isDemo, true));
    const companies = await tx.delete(salesCompaniesTable).where(eq(salesCompaniesTable.isDemo, true)).returning({ id: salesCompaniesTable.id });
    const removed = { companies: companies.length, tasks: tasks.length, expenses: expenses.length };
    await writeAudit(tx, { actorUserId: actor.id, entity: "sales_demo", entityId: null, action: "cleared", after: removed });
    return removed;
  });
}
