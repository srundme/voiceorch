import { z } from "zod";
import { isStage, type Stage } from "./stages.js";
import { isDateString } from "./time.js";
import { salesConfigSchema } from "./settings-schema.js";

export const isoDateTime = z.string().datetime({ offset: true }).transform((s) => new Date(s));
export const dateString = z.string().refine(isDateString, "Expected YYYY-MM-DD");
const text = (max: number) => z.string().trim().max(max);
const optText = (max: number) => text(max).nullish();
const id = z.number().int().positive();
const queryFlag = z
  .enum(["1", "true", "0", "false"])
  .optional()
  .transform((v) => v === "1" || v === "true");
const queryId = z.coerce.number().int().positive().optional();

export const roleSchema = z.enum(["founder", "teammate"]);

export const bootstrapSchema = z.object({ email: z.string().trim().email().max(320) });
export const loginSchema = z.object({ email: z.string().trim().max(320).min(1), password: z.string().min(1).max(500) });
export const acceptInviteSchema = z.object({ name: text(200).min(1), password: z.string().min(10).max(500) });
export const inviteUserSchema = z.object({ email: z.string().trim().email().max(320), role: roleSchema });
export const updateUserSchema = z
  .object({ role: roleSchema.optional(), status: z.enum(["active", "deactivated"]).optional(), name: text(200).min(1).optional() })
  .refine((v) => v.role !== undefined || v.status !== undefined || v.name !== undefined, "Nothing to update");

export const putSettingsSchema = z.object({ config: salesConfigSchema, reason: optText(1000) });
export const listTargetsQuery = z.object({
  from: dateString.optional(),
  to: dateString.optional(),
  kind: z.enum(["daily", "cumulative_paid"]).optional(),
});
export const patchTargetSchema = z
  .object({
    dayType: z.enum(["selling", "delivery", "review"]).optional(),
    visits: z.number().int().min(0).optional(),
    conversations: z.number().int().min(0).optional(),
    demos: z.number().int().min(0).optional(),
    pilots: z.number().int().min(0).optional(),
    operatingPaid: z.number().int().min(0).optional(),
    stretchPaid: z.number().int().min(0).optional(),
    note: optText(1000),
    reason: optText(1000),
  })
  .strict();

export const contactInputSchema = z.object({
  name: text(200).default(""),
  role: optText(200),
  phone: optText(40),
  email: optText(320),
  preferredChannel: z.enum(["call", "whatsapp", "email", "linkedin"]).nullish(),
  isDecisionMaker: z.boolean().optional(),
});
export const updateContactSchema = contactInputSchema.partial().strict();

const companyFields = {
  name: text(300).min(1),
  website: optText(500),
  sector: optText(100),
  city: optText(100),
  area: optText(200),
  address: optText(1000),
  mapLink: optText(1000),
  source: optText(100),
  sourceCampaign: optText(300),
  contactPermissionEvidence: optText(2000),
  priority: z.enum(["high", "medium", "low"]),
  callingVolume: z.number().int().min(0).nullish(),
  currentCallingTeam: optText(500),
  painPoint: optText(2000),
  budgetFit: z.enum(["yes", "no", "unknown"]),
  decisionMaker: optText(300),
  nextAction: optText(500),
  nextActionDueAt: isoDateTime.nullish(),
  internalNotes: optText(5000),
  customerNotes: optText(5000),
};

export const createCompanySchema = z.object({
  ...companyFields,
  priority: companyFields.priority.optional(),
  budgetFit: companyFields.budgetFit.optional(),
  ownerId: id.nullable().optional(),
  originalEnquiryAt: isoDateTime.optional(),
  inbound: z.boolean().optional(),
  isDemo: z.boolean().optional(),
  createOpportunity: z.boolean().optional(),
  contacts: z.array(contactInputSchema).max(20).optional(),
});

export const updateCompanySchema = z.object(companyFields).partial().strict();
export const assignOwnerSchema = z.object({ ownerId: id.nullable() });

export const listCompaniesQuery = z.object({
  q: text(200).optional(),
  ownerId: queryId,
  city: text(100).optional(),
  area: text(200).optional(),
  sector: text(100).optional(),
  source: text(100).optional(),
  stage: z.string().refine(isStage, "Unknown stage").optional(),
  priority: z.enum(["high", "medium", "low"]).optional(),
  overdueNextAction: queryFlag,
  missingNextAction: queryFlag,
  unassigned: queryFlag,
  needsDedupeReview: queryFlag,
  demo: queryFlag,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

const qualificationSchema = z
  .object({
    need: optText(2000),
    callingVolume: z.number().int().min(0).nullish(),
    budgetFit: z.enum(["yes", "no", "unknown"]).nullish(),
    decisionMakerContactId: id.nullish(),
    decisionMaker: optText(300),
  })
  .partial();
const pilotReadinessSchema = z
  .object({
    dataReady: z.boolean(),
    scriptReady: z.boolean(),
    callingReadinessConfirmed: z.boolean(),
    reviewAt: z.string().datetime({ offset: true }).nullable(),
  })
  .partial();
const reviewSchema = z
  .object({ buyerFeedback: optText(5000), acceptedOutcomes: optText(5000), nextDecision: optText(2000) })
  .partial();

export const stageEvidenceSchema = z
  .object({
    qualification: qualificationSchema.optional(),
    demoBuyerContactId: id.optional(),
    demoAt: isoDateTime.optional(),
    pilotReadiness: pilotReadinessSchema.optional(),
    review: reviewSchema.optional(),
    liveAt: isoDateTime.optional(),
    reason: text(2000).optional(),
    actionAt: isoDateTime.optional(),
  })
  .strict();

export const stageChangeSchema = z.object({
  to: z.string().refine(isStage, "Unknown stage").transform((s) => s as Stage),
  note: optText(2000),
  bypassReason: optText(2000),
  evidence: stageEvidenceSchema.default({}),
});

export const updateOpportunitySchema = z
  .object({
    qualification: qualificationSchema,
    demoBuyerContactId: id.nullable(),
    demoAt: isoDateTime.nullable(),
    pilotReadiness: pilotReadinessSchema,
    review: reviewSchema,
    terms: z.record(z.unknown()),
  })
  .partial()
  .strict();

const activityFlagsSchema = z
  .object({ visit: z.boolean(), buyerConversation: z.boolean(), demo: z.boolean(), pilotStarted: z.boolean() })
  .partial();
export const activityTypeSchema = z.enum(["visit", "call", "email", "whatsapp", "linkedin", "demo", "meeting"]);

export const createActivitySchema = z.object({
  companyId: id,
  opportunityId: id.nullish(),
  contactId: id.nullish(),
  type: activityTypeSchema,
  status: z.enum(["completed", "scheduled"]).default("completed"),
  occurredAt: isoDateTime.optional(),
  scheduledAt: isoDateTime.optional(),
  flags: activityFlagsSchema.optional(),
  outcome: optText(2000),
  notes: optText(5000),
  nextAction: optText(500),
  nextActionDueAt: isoDateTime.nullish(),
});

export const updateActivitySchema = z
  .object({
    contactId: id.nullable(),
    type: activityTypeSchema,
    status: z.enum(["completed", "scheduled", "no_show"]),
    occurredAt: isoDateTime.nullable(),
    scheduledAt: isoDateTime.nullable(),
    flags: activityFlagsSchema,
    outcome: optText(2000),
    notes: optText(5000),
    nextAction: optText(500),
    nextActionDueAt: isoDateTime.nullable(),
  })
  .partial()
  .strict();

export const listActivitiesQuery = z.object({
  companyId: queryId,
  ownerId: queryId,
  scope: z.enum(["mine", "team"]).default("team"),
  from: dateString.optional(),
  to: dateString.optional(),
  type: activityTypeSchema.optional(),
  status: z.enum(["completed", "scheduled", "cancelled", "no_show"]).optional(),
  demo: queryFlag,
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export const cancelSchema = z.object({ reason: optText(1000) });

export const taskKindSchema = z.enum([
  "follow_up",
  "first_response",
  "demo",
  "pilot_review",
  "onboarding",
  "service_review",
  "renewal",
  "other",
]);

export const listTasksQuery = z.object({
  scope: z.enum(["mine", "team"]).optional(),
  ownerId: queryId,
  status: z.enum(["open", "done", "cancelled", "all"]).default("open"),
  overdue: queryFlag,
  dueToday: queryFlag,
  unassigned: queryFlag,
  companyId: queryId,
  date: dateString.optional(),
  demo: queryFlag,
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export const createTaskSchema = z.object({
  title: text(500).min(1),
  kind: taskKindSchema.default("follow_up"),
  dueAt: isoDateTime.nullish(),
  companyId: id.nullish(),
  opportunityId: id.nullish(),
  ownerId: id.nullable().optional(),
});
export const updateTaskSchema = z
  .object({ title: text(500).min(1), dueAt: isoDateTime.nullable() })
  .partial()
  .strict();
export const assignTaskSchema = z.object({ ownerId: id.nullable() });
export const completeTaskSchema = z.object({ outcome: optText(2000) });

export const todayQuery = z.object({
  date: dateString.optional(),
  scope: z.enum(["mine", "team"]).optional(),
  ownerId: queryId,
  demo: queryFlag,
});

const paise = z.number().int().min(0);
const csvInt = z.preprocess(
  (v) => (typeof v === "string" ? (v.trim() === "" ? undefined : Number(v.replace(/,/g, ""))) : v),
  z.number().int().min(0),
);
const csvMoney = z.preprocess(
  (v) => (typeof v === "string" ? (v.trim() === "" ? undefined : Number(v.replace(/,/g, ""))) : v),
  z.number().min(0),
);

export const listByCompanyQuery = z.object({ companyId: queryId, demo: queryFlag });

export const PILOT_STATUSES = ["Draft", "Setup", "Calling", "Review due", "Completed", "Cancelled"] as const;
export type PilotStatus = (typeof PILOT_STATUSES)[number];

const recordingLinkSchema = z.object({
  url: z.string().trim().url().max(2000),
  label: optText(200),
  authorized: z.boolean().default(false),
});
const readinessSchema = z
  .object({
    dataReady: z.boolean(),
    scriptApproved: z.boolean(),
    callerIdReady: z.boolean(),
    testCallDone: z.boolean(),
    contactBasisConfirmed: z.boolean(),
  })
  .partial()
  .strict();
const qualityReviewSchema = z
  .object({
    firstFiveAnsweredReviewed: z.boolean(),
    scriptAdherenceOk: z.boolean(),
    outcomesTaggedCorrectly: z.boolean(),
    issues: optText(2000),
  })
  .partial()
  .strict();

const pilotFields = {
  opportunityId: id.nullable(),
  useCase: optText(2000),
  language: optText(100),
  qualificationCriteria: optText(2000),
  approvedScript: optText(20000),
  leadCount: z.number().int().min(0).nullable(),
  contactBasisConfirmed: z.boolean(),
  campaignRef: optText(300),
  reportLink: optText(2000),
  recordingLinks: z.array(recordingLinkSchema).max(50),
  windowStart: isoDateTime.nullable(),
  windowEnd: isoDateTime.nullable(),
  reviewAt: isoDateTime.nullable(),
  ownerId: id.nullable(),
  followupOwnerId: id.nullable(),
  attemptAllowance: z.number().int().min(1).max(100_000),
  readiness: readinessSchema,
  qualityReview: qualityReviewSchema,
  buyerFeedback: optText(5000),
  acceptedOutcomesNote: optText(5000),
  proposedNextStep: optText(2000),
  customerReportNotes: optText(5000),
  internalNotes: optText(5000),
};

export const createPilotSchema = z.object(pilotFields).partial().extend({ companyId: id, isDemo: z.boolean().optional() }).strict();
export const updatePilotSchema = z.object(pilotFields).partial().strict();
export const pilotStatusSchema = z.object({
  to: z.enum(PILOT_STATUSES),
  overrideReason: optText(2000),
  reason: optText(2000),
});
export const pilotExtensionSchema = z.object({
  attempts: z.number().int().min(1),
  reason: text(2000).min(1),
  costLimitPaise: paise,
  reviewAt: isoDateTime,
});

const snapshotMetricFields = {
  attempts: csvInt,
  distinctRecords: csvInt,
  answered: csvInt,
  meaningful: csvInt,
  qualifiedPeople: csvInt,
  acceptedOutcomes: csvInt,
  callbackRequests: csvInt,
  confirmedAppointments: csvInt,
};
export const snapshotSchema = z.object({
  snapshotKey: optText(200),
  asOf: isoDateTime,
  ...snapshotMetricFields,
  connectedMinutes: csvInt.optional(),
  costPaise: csvInt.optional(),
});
export const snapshotImportRowSchema = snapshotSchema
  .extend({ asOf: z.string().trim().datetime({ offset: true }).transform((s) => new Date(s)), costRupees: csvMoney.optional() })
  .refine((r) => !(r.costPaise != null && r.costRupees != null), "Give costPaise or costRupees, not both");
export const snapshotImportSchema = z.object({
  filename: text(300).min(1),
  rows: z.array(z.record(z.unknown())).min(1).max(5000),
});

export const createProposalSchema = z.object({
  companyId: id,
  opportunityId: id.nullish(),
  monthlyFeePaise: paise.optional(),
  setupFeePaise: paise.optional(),
  includedMinutes: z.number().int().min(0).optional(),
  gstRateBps: z.number().int().min(0).max(10_000).optional(),
  scope: optText(5000),
});
export const updateProposalSchema = createProposalSchema.omit({ companyId: true, opportunityId: true }).partial().strict();
export const acceptProposalSchema = z.object({ acceptedBy: text(300).min(1), acceptedAt: isoDateTime.optional() });
export const declineProposalSchema = z.object({ reason: optText(2000) });

export const PAYMENT_KINDS = ["first_month", "renewal", "setup", "other"] as const;
export const recordPaymentSchema = z.object({
  companyId: id,
  proposalId: id.nullish(),
  subscriptionId: id.nullish(),
  kind: z.enum(PAYMENT_KINDS),
  feePaise: z.number().int().min(1),
  taxPaise: paise.default(0),
  reference: optText(300),
  receivedAt: isoDateTime,
  notes: optText(2000),
});
export const rejectPaymentSchema = z.object({ reason: text(2000).min(1) });
export const paymentAdjustmentSchema = z
  .object({
    kind: z.enum(["correction", "refund"]),
    feeDeltaPaise: z.number().int(),
    taxDeltaPaise: z.number().int().default(0),
    reason: text(2000).min(1),
  })
  .refine((a) => a.feeDeltaPaise !== 0 || a.taxDeltaPaise !== 0, "Adjustment must change an amount")
  .refine((a) => a.kind !== "refund" || (a.feeDeltaPaise <= 0 && a.taxDeltaPaise <= 0), "Refunds must be negative");
export const listPaymentsQuery = z.object({
  companyId: queryId,
  status: z.enum(["recorded", "verified", "rejected"]).optional(),
  demo: queryFlag,
});

const onboardingChecksSchema = z.record(z.boolean());
export const createSubscriptionSchema = z.object({
  companyId: id,
  proposalId: id.nullish(),
  monthlyFeePaise: z.number().int().min(1).optional(),
  includedMinutes: z.number().int().min(0).optional(),
  startDate: dateString.nullish(),
  customerOwnerId: id.nullish(),
  onboardingChecks: onboardingChecksSchema.optional(),
});
export const updateSubscriptionSchema = z
  .object({ startDate: dateString.nullable(), customerOwnerId: id.nullable(), onboardingChecks: onboardingChecksSchema })
  .partial()
  .strict();
export const goLiveSchema = z.object({ startDate: dateString.optional(), liveAt: isoDateTime.optional() });
export const cancelSubscriptionSchema = z.object({ reason: text(2000).min(1) });

export const webhookLeadSchema = z.object({
  eventId: text(200).optional(),
  source: text(100).min(1),
  campaign: optText(300),
  enquiredAt: isoDateTime,
  company: z.object({ name: text(300).min(1), website: optText(500), city: optText(100), sector: optText(100) }),
  contact: z.object({ name: optText(200), phone: optText(40), email: optText(320) }).default({}),
  consent: z
    .object({ text: text(2000).min(1), capturedAt: isoDateTime, method: text(100).min(1) })
    .optional(),
});

export const leadImportSchema = z.object({
  filename: text(300).min(1),
  rows: z.array(z.record(z.unknown())).min(1).max(5000),
  decisions: z.record(z.enum(["create", "skip"])).optional(),
});
export const leadImportRowSchema = z.object({
  name: text(300).default(""),
  website: optText(500),
  city: optText(100),
  sector: optText(100),
  source: optText(100),
  campaign: optText(300),
  contactName: optText(200),
  phone: optText(40),
  email: optText(320),
  enquiredAt: z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().trim().datetime({ offset: true }).transform((s) => new Date(s)).optional(),
  ),
});

export const CALENDAR_TYPES = ["activity", "pilot_review", "extension_review", "task", "renewal", "target"] as const;
export const calendarQuery = z.object({
  from: dateString,
  to: dateString,
  scope: z.enum(["mine", "team"]).default("team"),
  ownerId: queryId,
  types: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : [...CALENDAR_TYPES]))
    .pipe(z.array(z.enum(CALENDAR_TYPES))),
  demo: queryFlag,
});

export const reportsQuery = z.object({
  from: dateString,
  to: dateString,
  groupBy: z.enum(["city", "sector", "owner", "source"]).optional(),
  cohort: z.enum(["week", "month"]).default("week"),
  demo: queryFlag,
}).refine((q) => q.from <= q.to, { message: "from must be on or before to", path: ["from"] });

export const EXPENSE_CATEGORIES = ["pilot_cost", "ads", "travel", "tools", "commission", "other"] as const;
export const createExpenseSchema = z.object({
  date: dateString,
  category: z.enum(EXPENSE_CATEGORIES),
  isAcquisition: z.boolean().optional(),
  source: optText(100),
  sourceCampaign: optText(300),
  amountPaise: z.number().int().min(1),
  description: optText(2000),
});
export const updateExpenseSchema = createExpenseSchema.partial().strict();
export const listExpensesQuery = z.object({
  from: dateString.optional(),
  to: dateString.optional(),
  category: z.enum(EXPENSE_CATEGORIES).optional(),
  demo: queryFlag,
});

export const exportQuery = z.object({ from: dateString.optional(), to: dateString.optional(), demo: queryFlag });

export const dedupeReviewSchema = z.object({
  action: z.enum(["keep_separate", "merge"]),
  targetCompanyId: id.optional(),
  reason: optText(1000),
});

export const generateTargetsSchema = z
  .object({ from: dateString.optional(), to: dateString.optional() })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: "from must be on or before to", path: ["from"] });

export type DedupeReviewInput = z.infer<typeof dedupeReviewSchema>;
export type GenerateTargetsInput = z.infer<typeof generateTargetsSchema>;

export type CreatePilotInput = z.infer<typeof createPilotSchema>;
export type UpdatePilotInput = z.infer<typeof updatePilotSchema>;
export type PilotStatusInput = z.infer<typeof pilotStatusSchema>;
export type PilotExtensionInput = z.infer<typeof pilotExtensionSchema>;
export type SnapshotInput = z.infer<typeof snapshotSchema>;
export type CreateProposalInput = z.infer<typeof createProposalSchema>;
export type UpdateProposalInput = z.infer<typeof updateProposalSchema>;
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;
export type PaymentAdjustmentInput = z.infer<typeof paymentAdjustmentSchema>;
export type CreateSubscriptionInput = z.infer<typeof createSubscriptionSchema>;
export type UpdateSubscriptionInput = z.infer<typeof updateSubscriptionSchema>;
export type WebhookLeadInput = z.infer<typeof webhookLeadSchema>;
export type LeadImportInput = z.infer<typeof leadImportSchema>;
export type CalendarQuery = z.infer<typeof calendarQuery>;
export type ReportsQuery = z.infer<typeof reportsQuery>;
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;
export type ExportQuery = z.infer<typeof exportQuery>;
export type CreateCompanyInput = z.infer<typeof createCompanySchema>;
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;
export type ContactInput = z.infer<typeof contactInputSchema>;
export type UpdateContactInput = z.infer<typeof updateContactSchema>;
export type ListCompaniesQuery = z.infer<typeof listCompaniesQuery>;
export type StageChangeInput = z.infer<typeof stageChangeSchema>;
export type UpdateOpportunityInput = z.infer<typeof updateOpportunitySchema>;
export type CreateActivityInput = z.infer<typeof createActivitySchema>;
export type UpdateActivityInput = z.infer<typeof updateActivitySchema>;
export type ListActivitiesQuery = z.infer<typeof listActivitiesQuery>;
export type ListTasksQuery = z.infer<typeof listTasksQuery>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type TodayQuery = z.infer<typeof todayQuery>;
