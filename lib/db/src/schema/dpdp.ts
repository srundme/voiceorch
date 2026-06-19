import { pgTable, text, serial, integer, timestamp, boolean, uniqueIndex, index } from "drizzle-orm/pg-core";

/**
 * DPDP (Digital Personal Data Protection Act 2023) compliance tables.
 * ─────────────────────────────────────────────────────────────────────────────
 * A non-invasive pre/post wrapper that mirrors the TRAI tables. Unlike TRAI,
 * NOTHING here ever blocks a call from dialing — these tables are purely for:
 *   1. Recording a documented consent basis per campaign (audit-only).
 *   2. Flagging whether PII was detected in a finalized transcript.
 *   3. Tracking admin-triggered erasure requests.
 *
 * The enabled flag lives on the agent's existing `agent_config.compliance.dpdp`
 * boolean — these tables never carry a separate enable column.
 */

/**
 * Documented consent basis for running a campaign whose agent has DPDP enabled.
 * Record-keeping only — it never gates dialing or per-call checks.
 *   basisType: "existing_customer" | "service_callback" | "fresh_marketing_consent" | "other"
 */
export const campaignConsentBasisTable = pgTable(
  "campaign_consent_basis",
  {
    id:               serial("id").primaryKey(),
    campaignId:       integer("campaign_id").notNull(),
    basisType:        text("basis_type").notNull(),
    attestedBy:       text("attested_by"),
    attestedAt:       timestamp("attested_at", { withTimezone: true }).notNull().defaultNow(),
    consentSource:    text("consent_source"),
    consentDateRange: text("consent_date_range"),
    proofReference:   text("proof_reference"),
    notes:            text("notes"),
  },
  (t) => [uniqueIndex("dpdp_consent_basis_campaign_idx").on(t.campaignId)],
);

export type CampaignConsentBasis = typeof campaignConsentBasisTable.$inferSelect;
export type InsertCampaignConsentBasis = typeof campaignConsentBasisTable.$inferInsert;

/**
 * Post-call PII detection log for DPDP-enabled agents. One row per finalized
 * DPDP call (regardless of whether PII was detected). The presence of a row
 * also marks a call as "DPDP was enabled at call time" for the anonymization job.
 */
export const dpdpCallComplianceLogTable = pgTable(
  "dpdp_call_compliance_log",
  {
    id:          serial("id").primaryKey(),
    agentId:     integer("agent_id"),
    callId:      integer("call_id"),
    phoneNumber: text("phone_number").notNull(),
    piiDetected: boolean("pii_detected").notNull().default(false),
    createdAt:   timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("dpdp_compliance_log_agent_idx").on(t.agentId),
    index("dpdp_compliance_log_call_idx").on(t.callId),
    index("dpdp_compliance_log_phone_idx").on(t.phoneNumber),
  ],
);

export type DpdpCallComplianceLog = typeof dpdpCallComplianceLogTable.$inferSelect;
export type InsertDpdpCallComplianceLog = typeof dpdpCallComplianceLogTable.$inferInsert;

/**
 * Admin-triggered erasure (right-to-be-forgotten) requests. Each row records
 * that all call logs/transcripts/recordings for a phone number were marked for
 * deletion/anonymization. status is "completed" once processed.
 */
export const dpdpErasureRequestsTable = pgTable(
  "dpdp_erasure_requests",
  {
    id:          serial("id").primaryKey(),
    phoneNumber: text("phone_number").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    status:      text("status").notNull().default("completed"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [index("dpdp_erasure_phone_idx").on(t.phoneNumber)],
);

export type DpdpErasureRequest = typeof dpdpErasureRequestsTable.$inferSelect;
export type InsertDpdpErasureRequest = typeof dpdpErasureRequestsTable.$inferInsert;
