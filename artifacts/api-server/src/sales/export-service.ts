import { and, asc, eq, gte, lt, lte, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import {
  salesActivitiesTable,
  salesCompaniesTable,
  salesExpensesTable,
  salesPaymentsTable,
  salesPilotsTable,
  salesUsersTable,
} from "@workspace/db/schema";
import { toCsv, type CsvColumn } from "./csv.js";
import type { SalesDb } from "./db.js";
import { paymentViews } from "./payment-service.js";
import { latestSnapshots } from "./pilot-service.js";
import type { ExportQuery } from "./schemas.js";
import { periodFromDates } from "./time.js";

export const EXPORT_KINDS = ["companies", "activities", "payments", "pilots", "expenses"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

const col = <T>(header: string, value: (row: T) => unknown): CsvColumn<T> => ({ header, value });

function timeRange(column: PgColumn, q: ExportQuery, tz: string): SQL[] {
  if (!q.from && !q.to) return [];
  const period = periodFromDates(q.from ?? q.to!, q.to ?? q.from!, tz);
  return [gte(column, period.start), lt(column, period.end)];
}

export async function exportCsv(db: SalesDb, kind: ExportKind, q: ExportQuery, tz: string): Promise<string> {
  const users = await db.select({ id: salesUsersTable.id, name: salesUsersTable.name, email: salesUsersTable.email }).from(salesUsersTable);
  const userName = (id: number | null) => (id == null ? "" : users.find((u) => u.id === id)?.name || users.find((u) => u.id === id)?.email || String(id));
  const companyNames = new Map(
    (await db.select({ id: salesCompaniesTable.id, name: salesCompaniesTable.name }).from(salesCompaniesTable).where(eq(salesCompaniesTable.isDemo, q.demo))).map((c) => [c.id, c.name]),
  );

  switch (kind) {
    case "companies": {
      const rows = await db
        .select()
        .from(salesCompaniesTable)
        .where(and(eq(salesCompaniesTable.isDemo, q.demo), ...timeRange(salesCompaniesTable.createdAt, q, tz)))
        .orderBy(asc(salesCompaniesTable.id));
      type R = (typeof rows)[number];
      return toCsv<R>([
        col("id", (r) => r.id),
        col("name", (r) => r.name),
        col("website", (r) => r.website),
        col("sector", (r) => r.sector),
        col("city", (r) => r.city),
        col("area", (r) => r.area),
        col("owner", (r) => userName(r.ownerId)),
        col("source", (r) => r.source),
        col("original_source", (r) => r.originalSource),
        col("original_campaign", (r) => r.originalSourceCampaign),
        col("inbound", (r) => r.isInbound),
        col("original_enquiry_at", (r) => r.originalEnquiryAt),
        col("priority", (r) => r.priority),
        col("budget_fit", (r) => r.budgetFit),
        col("next_action", (r) => r.nextAction),
        col("next_action_due_at", (r) => r.nextActionDueAt),
        col("last_activity_at", (r) => r.lastActivityAt),
        col("first_paid_at", (r) => r.firstPaidAt),
        col("needs_dedupe_review", (r) => r.needsDedupeReview),
        col("created_at", (r) => r.createdAt),
      ], rows);
    }
    case "activities": {
      const rows = await db
        .select()
        .from(salesActivitiesTable)
        .where(and(eq(salesActivitiesTable.isDemo, q.demo), ...timeRange(salesActivitiesTable.createdAt, q, tz)))
        .orderBy(asc(salesActivitiesTable.id));
      type R = (typeof rows)[number];
      return toCsv<R>([
        col("id", (r) => r.id),
        col("company_id", (r) => r.companyId),
        col("company", (r) => companyNames.get(r.companyId)),
        col("owner", (r) => userName(r.ownerId)),
        col("type", (r) => r.type),
        col("status", (r) => r.status),
        col("occurred_at", (r) => r.occurredAt),
        col("scheduled_at", (r) => r.scheduledAt),
        col("visit", (r) => r.flagVisit),
        col("first_visit", (r) => r.flagFirstVisit),
        col("buyer_conversation", (r) => r.flagBuyerConversation),
        col("demo", (r) => r.flagDemo),
        col("outcome", (r) => r.outcome),
        col("next_action", (r) => r.nextAction),
        col("next_action_due_at", (r) => r.nextActionDueAt),
      ], rows);
    }
    case "payments": {
      const rows = await paymentViews(
        db,
        await db
          .select()
          .from(salesPaymentsTable)
          .where(and(eq(salesPaymentsTable.isDemo, q.demo), ...timeRange(salesPaymentsTable.receivedAt, q, tz)))
          .orderBy(asc(salesPaymentsTable.receivedAt), asc(salesPaymentsTable.id)),
      );
      type R = (typeof rows)[number];
      return toCsv<R>([
        col("id", (r) => r.id),
        col("company_id", (r) => r.companyId),
        col("company", (r) => companyNames.get(r.companyId)),
        col("kind", (r) => r.kind),
        col("status", (r) => r.status),
        col("received_at", (r) => r.receivedAt),
        col("fee_paise", (r) => r.feePaise),
        col("tax_paise", (r) => r.taxPaise),
        col("net_fee_paise", (r) => r.netFeePaise),
        col("net_tax_paise", (r) => r.netTaxPaise),
        col("refunded_paise", (r) => r.refundedPaise),
        col("adjustments", (r) => r.adjustments.length),
        col("reference", (r) => r.reference),
        col("verified_at", (r) => r.verifiedAt),
        col("verified_by", (r) => userName(r.verifiedBy)),
      ], rows);
    }
    case "pilots": {
      const rows = await db
        .select()
        .from(salesPilotsTable)
        .where(and(eq(salesPilotsTable.isDemo, q.demo), ...timeRange(salesPilotsTable.createdAt, q, tz)))
        .orderBy(asc(salesPilotsTable.id));
      const latest = await latestSnapshots(db, rows.map((r) => r.id));
      type R = (typeof rows)[number];
      return toCsv<R>([
        col("id", (r) => r.id),
        col("company_id", (r) => r.companyId),
        col("company", (r) => companyNames.get(r.companyId)),
        col("status", (r) => r.status),
        col("owner", (r) => userName(r.ownerId)),
        col("onboarding_started_at", (r) => r.onboardingStartedAt),
        col("campaign_started_at", (r) => r.campaignStartedAt),
        col("review_at", (r) => r.reviewAt),
        col("attempt_allowance", (r) => r.attemptAllowance),
        col("extension_attempts", (r) => r.extensionAttempts),
        col("snapshot_as_of", (r) => latest.get(r.id)?.asOf),
        col("attempts", (r) => latest.get(r.id)?.attempts),
        col("answered", (r) => latest.get(r.id)?.answered),
        col("meaningful", (r) => latest.get(r.id)?.meaningful),
        col("qualified_people", (r) => latest.get(r.id)?.qualifiedPeople),
        col("accepted_outcomes", (r) => latest.get(r.id)?.acceptedOutcomes),
        col("callback_requests", (r) => latest.get(r.id)?.callbackRequests),
        col("confirmed_appointments", (r) => latest.get(r.id)?.confirmedAppointments),
        col("cost_paise", (r) => latest.get(r.id)?.costPaise),
        col("completed_at", (r) => r.completedAt),
      ], rows);
    }
    case "expenses": {
      const conds: SQL[] = [eq(salesExpensesTable.isDemo, q.demo)];
      if (q.from) conds.push(gte(salesExpensesTable.date, q.from));
      if (q.to) conds.push(lte(salesExpensesTable.date, q.to));
      const rows = await db.select().from(salesExpensesTable).where(and(...conds)).orderBy(asc(salesExpensesTable.date), asc(salesExpensesTable.id));
      type R = (typeof rows)[number];
      return toCsv<R>([
        col("id", (r) => r.id),
        col("date", (r) => r.date),
        col("category", (r) => r.category),
        col("acquisition", (r) => r.isAcquisition),
        col("source", (r) => r.source),
        col("campaign", (r) => r.sourceCampaign),
        col("amount_paise", (r) => r.amountPaise),
        col("description", (r) => r.description),
      ], rows);
    }
  }
}
