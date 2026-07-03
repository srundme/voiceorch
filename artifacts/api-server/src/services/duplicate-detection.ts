/**
 * Duplicate Detection Engine
 *
 * Detects duplicate leads at import time (batch wizard) using normalized_phone.
 * Scope: within the same campaign. Cross-campaign = informational warning only.
 *
 * Three policies (set per batch):
 *  - ignore:              Create the lead anyway, mark duplicate_status = 'duplicate'
 *  - skip:                Discard silently, count in import summary
 *  - reject_with_report:  Discard and include in error report with reason
 */

import { and, eq, not } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@workspace/db/schema";
import { campaignLeadsTable } from "@workspace/db/schema";
import type { DuplicatePolicy } from "@workspace/db/schema";

export type { DuplicatePolicy };

export interface DuplicateCheckInput {
  normalizedPhone: string;
  campaignId: number;
  policy: DuplicatePolicy;
}

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  existingLeadId?: number;
  action: "create" | "skip" | "reject";
  reportEntry?: DuplicateReportEntry;
}

export interface DuplicateReportEntry {
  phone: string;
  normalizedPhone: string;
  reason: "duplicate_phone";
  existingLeadId: number;
  rowIndex?: number;
}

export interface ImportSummary {
  totalRows: number;
  leadsCreated: number;
  duplicatesFound: number;
  duplicatesAction: string;
  invalidPhones: number;
  errors: DuplicateReportEntry[];
}

/**
 * Check whether a normalized phone already exists in the campaign.
 * Returns the action to take and report entry if needed.
 *
 * Scope note: a prior row that was pre-dial `skipped` (no agent assigned /
 * DNC / TRAI block) and never actually dialed (call_attempts = 0) is NOT
 * treated as a blocking duplicate. Those rows are excluded here so that a
 * lead which never got a real call can be re-imported and re-dialed once the
 * underlying condition (agent assigned, DNC/TRAI cleared) is resolved —
 * otherwise "Skip duplicates" would match the phone against itself forever
 * and the number can never be dialed. DNC/TRAI are independently re-checked
 * at import/dial time, so excluding them here does not bypass those gates.
 * Rows that are pending, actively calling, or have a genuine call outcome
 * (connected/completed/failed/etc.) still count as duplicates as before.
 */
export async function checkDuplicate(
  db: NodePgDatabase<typeof schema>,
  input: DuplicateCheckInput,
): Promise<DuplicateCheckResult> {
  const existing = await db
    .select({ id: campaignLeadsTable.id })
    .from(campaignLeadsTable)
    .where(
      and(
        eq(campaignLeadsTable.campaignId, input.campaignId),
        eq(campaignLeadsTable.normalizedPhone, input.normalizedPhone),
        not(
          and(
            eq(campaignLeadsTable.callStatus, "skipped"),
            eq(campaignLeadsTable.callAttempts, 0),
          )!,
        ),
      ),
    )
    .limit(1);

  if (existing.length === 0) {
    return { isDuplicate: false, action: "create" };
  }

  const existingLeadId = existing[0].id;

  switch (input.policy) {
    case "ignore":
      return {
        isDuplicate: true,
        existingLeadId,
        action: "create",
      };

    case "skip":
      return {
        isDuplicate: true,
        existingLeadId,
        action: "skip",
      };

    case "reject_with_report":
      return {
        isDuplicate: true,
        existingLeadId,
        action: "reject",
        reportEntry: {
          phone: input.normalizedPhone,
          normalizedPhone: input.normalizedPhone,
          reason: "duplicate_phone",
          existingLeadId,
        },
      };

    default:
      return { isDuplicate: false, action: "create" };
  }
}

/**
 * Check for cross-campaign duplicates — informational warning only, never rejects.
 * Returns existing campaign names for display in the batch wizard.
 */
export async function checkCrossCampaignDuplicates(
  db: NodePgDatabase<typeof schema>,
  normalizedPhones: string[],
  currentCampaignId: number,
  userId: string,
): Promise<Map<string, number[]>> {
  if (normalizedPhones.length === 0) return new Map();

  const existing = await db
    .select({
      normalizedPhone: campaignLeadsTable.normalizedPhone,
      campaignId: campaignLeadsTable.campaignId,
    })
    .from(campaignLeadsTable)
    .where(
      and(
        eq(campaignLeadsTable.campaignId, currentCampaignId),
      ),
    );

  const result = new Map<string, number[]>();
  for (const row of existing) {
    if (!row.normalizedPhone) continue;
    const campaigns = result.get(row.normalizedPhone) ?? [];
    if (!campaigns.includes(row.campaignId)) {
      campaigns.push(row.campaignId);
      result.set(row.normalizedPhone, campaigns);
    }
  }
  return result;
}

/**
 * Build an empty ImportSummary to accumulate counts during batch import.
 */
export function createImportSummary(totalRows: number, policy: DuplicatePolicy): ImportSummary {
  return {
    totalRows,
    leadsCreated: 0,
    duplicatesFound: 0,
    duplicatesAction: policy,
    invalidPhones: 0,
    errors: [],
  };
}
