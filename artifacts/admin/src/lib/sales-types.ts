export const ORDERED_STAGES = [
  "Identified",
  "Qualified",
  "Demo booked",
  "Demo completed",
  "Pilot ready",
  "Pilot running",
  "Results reviewed",
  "Proposal",
  "Paid",
  "Live",
] as const;
export const SIDE_STAGES = ["Later", "Lost"] as const;
export const ALL_STAGES = [...ORDERED_STAGES, ...SIDE_STAGES] as const;
export const BYPASSABLE_STAGES: readonly Stage[] = ["Demo booked", "Demo completed", "Pilot ready", "Pilot running", "Results reviewed"];
export type Stage = (typeof ALL_STAGES)[number];

export const PILOT_STATUSES = ["Draft", "Setup", "Calling", "Review due", "Completed", "Cancelled"] as const;
export type PilotStatus = (typeof PILOT_STATUSES)[number];
export const ACTIVE_PILOT_STATUSES: readonly PilotStatus[] = ["Setup", "Calling", "Review due"];
export const NEXT_PILOT_STATUS: Partial<Record<PilotStatus, PilotStatus>> = {
  Draft: "Setup",
  Setup: "Calling",
  Calling: "Review due",
  "Review due": "Completed",
};

export const ACTIVITY_TYPES = ["visit", "call", "email", "whatsapp", "linkedin", "demo", "meeting"] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];
export const TASK_KINDS = ["follow_up", "first_response", "demo", "pilot_review", "onboarding", "service_review", "renewal", "other"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];
export const PAYMENT_KINDS = ["first_month", "renewal", "setup", "other"] as const;
export const EXPENSE_CATEGORIES = ["pilot_cost", "ads", "travel", "tools", "commission", "other"] as const;
export const EXPORT_KINDS = ["companies", "activities", "payments", "pilots", "expenses"] as const;
export const CALENDAR_TYPES = ["activity", "pilot_review", "extension_review", "task", "renewal", "target"] as const;
export type CalendarType = (typeof CALENDAR_TYPES)[number];

export type Role = "founder" | "teammate";
export type Iso = string;

export type SalesUser = { id: number; email: string; name: string; role: Role };
export type TeamMember = SalesUser & { status?: string };
export type SalesUserFull = SalesUser & { status: string; lastLoginAt: Iso | null; deactivatedAt: Iso | null; createdAt: Iso };
export type SalesInvite = { id: number; email: string; role: Role; invitedBy: number | null; expiresAt: Iso; createdAt: Iso };
export type InviteResult = { invite: SalesInvite; token: string; inviteUrlPath: string };

export type Ratio = { value: number | null; label: string };
export type Rate = { value: number | null; numerator: number; denominator: number; label: string };
export type GoalProgress = { actual: number; target: number; remaining: number; progress: Ratio };
export type CashTotals = { feePaise: number; taxPaise: number; totalPaise: number };

export type SalesConfig = {
  timezone: string;
  sprint: { start: string; end: string };
  goals: { operatingNewPaid: number; stretchNewPaid: number; stretchMrrPaise: number };
  cities: { field: string[]; remote: string[] };
  sectors: string[];
  sources: string[];
  offer: { monthlyFeePaise: number; includedMinutes: number; gstRateBps: number };
  pilot: { attemptAllowance: number; durationDays: number; extensionMin: number; extensionMax: number; activeCapacity: number };
  dailyTargets: {
    visits: number;
    deliveryDayVisits: number;
    conversationsMin: number;
    conversationsMax: number;
    demosMin: number;
    demosMax: number;
    pilots: number;
  };
  sundayIsReview: boolean;
  responseTargetMinutes: number;
  defaultInboundOwnerId: number | null;
  businessHours: { start: string; end: string; days: number[] };
  forecast: { assumptions: Array<{ key: string; label: string; value: number }> };
};
export type SettingsView = { config: SalesConfig; updatedBy: number | null; updatedAt: Iso | null };

export type Target = {
  id: number;
  date: string;
  kind: "daily" | "cumulative_paid";
  dayType: "selling" | "delivery" | "review";
  visits: number;
  conversations: number;
  demos: number;
  pilots: number;
  operatingPaid: number;
  stretchPaid: number;
  note: string | null;
};

export type Company = {
  id: number;
  isDemo: boolean;
  name: string;
  website: string | null;
  sector: string | null;
  city: string | null;
  area: string | null;
  address: string | null;
  mapLink: string | null;
  ownerId: number | null;
  source: string | null;
  sourceCampaign: string | null;
  originalSource: string | null;
  originalSourceCampaign: string | null;
  originalEnquiryAt: Iso | null;
  contactPermissionEvidence: string | null;
  priority: "high" | "medium" | "low";
  callingVolume: number | null;
  currentCallingTeam: string | null;
  painPoint: string | null;
  budgetFit: "yes" | "no" | "unknown";
  decisionMaker: string | null;
  lastActivityAt: Iso | null;
  nextAction: string | null;
  nextActionDueAt: Iso | null;
  firstPaidAt: Iso | null;
  duplicateOfCompanyId: number | null;
  needsDedupeReview: boolean;
  internalNotes: string | null;
  customerNotes: string | null;
  isInbound: boolean;
  createdAt: Iso;
  updatedAt: Iso;
};
export type CompanyListItem = Company & { ownerName: string | null; stage: Stage | null; opportunityId: number | null; nextActionOverdue: boolean };
export type CompanyList = { items: CompanyListItem[]; total: number; page: number; pageSize: number };

export type Contact = {
  id: number;
  companyId: number;
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
  preferredChannel: "call" | "whatsapp" | "email" | "linkedin" | null;
  isDecisionMaker: boolean;
  createdAt: Iso;
};

export type Qualification = { need?: string | null; callingVolume?: number | null; budgetFit?: string | null; decisionMakerContactId?: number | null; decisionMaker?: string | null };
export type OppPilotReadiness = { dataReady?: boolean; scriptReady?: boolean; callingReadinessConfirmed?: boolean; reviewAt?: string | null };
export type OppReview = { buyerFeedback?: string | null; acceptedOutcomes?: string | null; nextDecision?: string | null };

export type Opportunity = {
  id: number;
  companyId: number;
  stage: Stage;
  stageChangedAt: Iso;
  ownerId: number | null;
  qualification: Qualification | null;
  demoBuyerContactId: number | null;
  demoAt: Iso | null;
  pilotReadiness: OppPilotReadiness | null;
  review: OppReview | null;
  laterReason: string | null;
  laterActionAt: Iso | null;
  lostReason: string | null;
  bypassReason: string | null;
  isDemo: boolean;
  closedAt: Iso | null;
};

export type StageHistory = {
  id: number;
  opportunityId: number;
  fromStage: Stage | null;
  toStage: Stage;
  changedBy: number | null;
  changedAt: Iso;
  evidence: Record<string, unknown> | null;
  bypass: boolean;
  note: string | null;
};

export type Activity = {
  id: number;
  companyId: number;
  opportunityId: number | null;
  contactId: number | null;
  ownerId: number | null;
  type: ActivityType;
  status: "completed" | "scheduled" | "cancelled" | "no_show";
  occurredAt: Iso | null;
  scheduledAt: Iso | null;
  flagVisit: boolean;
  flagFirstVisit: boolean;
  flagBuyerConversation: boolean;
  flagDemo: boolean;
  flagPilotStarted: boolean;
  outcome: string | null;
  notes: string | null;
  nextAction: string | null;
  nextActionDueAt: Iso | null;
  isDemo: boolean;
  createdAt: Iso;
  companyName?: string;
};

export type Task = {
  id: number;
  companyId: number | null;
  opportunityId: number | null;
  pilotId: number | null;
  subscriptionId: number | null;
  ownerId: number | null;
  title: string;
  kind: TaskKind;
  dueAt: Iso | null;
  status: "open" | "done" | "cancelled";
  outcome: string | null;
  completedAt: Iso | null;
  isDemo: boolean;
  createdAt: Iso;
  companyName?: string | null;
  overdue?: boolean;
};

export type Snapshot = {
  id: number;
  pilotId: number;
  snapshotKey: string;
  asOf: Iso;
  source: string;
  attempts: number;
  distinctRecords: number;
  answered: number;
  meaningful: number;
  qualifiedPeople: number;
  acceptedOutcomes: number;
  callbackRequests: number;
  confirmedAppointments: number;
  connectedMinutes: number;
  costPaise: number;
  createdBy: number | null;
  createdAt: Iso;
  updatedAt: Iso;
};

export type PilotReadiness = { dataReady?: boolean; scriptApproved?: boolean; callerIdReady?: boolean; testCallDone?: boolean; contactBasisConfirmed?: boolean };
export type QualityReview = { firstFiveAnsweredReviewed?: boolean; scriptAdherenceOk?: boolean; outcomesTaggedCorrectly?: boolean; issues?: string | null };
export type RecordingLink = { url: string; label?: string | null; authorized: boolean };

export type Allowance = {
  baseAllowance: number;
  extensionAttempts: number | null;
  revisedAllowance: number;
  attemptsUsed: number | null;
  remaining: number;
  overAllowance: boolean;
  overBy: number;
  note: string;
};

export type PilotRates = Record<"answerRate" | "meaningfulRate" | "qualifiedRate" | "acceptedRate" | "callbackRate" | "appointmentRate", Rate>;

export type Pilot = {
  id: number;
  companyId: number;
  opportunityId: number | null;
  status: PilotStatus;
  useCase: string | null;
  language: string | null;
  qualificationCriteria: string | null;
  approvedScript: string | null;
  leadCount: number | null;
  contactBasisConfirmed: boolean;
  campaignRef: string | null;
  reportLink: string | null;
  recordingLinks: RecordingLink[] | null;
  onboardingStartedAt: Iso | null;
  campaignStartedAt: Iso | null;
  windowStart: Iso | null;
  windowEnd: Iso | null;
  reviewAt: Iso | null;
  ownerId: number | null;
  followupOwnerId: number | null;
  attemptAllowance: number;
  extensionAttempts: number | null;
  extensionReason: string | null;
  extensionCostLimitPaise: number | null;
  extensionReviewAt: Iso | null;
  extensionApprovedBy: number | null;
  capacityOverrideReason: string | null;
  capacityOverrideBy: number | null;
  readiness: PilotReadiness | null;
  qualityReview: QualityReview | null;
  buyerFeedback: string | null;
  acceptedOutcomesNote: string | null;
  proposedNextStep: string | null;
  customerReportNotes: string | null;
  internalNotes: string | null;
  cancelledReason: string | null;
  isDemo: boolean;
  createdAt: Iso;
  updatedAt: Iso;
  completedAt: Iso | null;
  latestSnapshot: Snapshot | null;
  allowance: Allowance;
  rates: PilotRates;
  companyName?: string;
};
export type PilotDetail = { pilot: Pilot; snapshots: Snapshot[]; newPilotRule: string };

export type ReportMetric = { value: number | null; insufficientData: boolean; display?: string };
export type ReportRate = Rate & { insufficientData: boolean; display?: string };
export type PilotReport = {
  title: string;
  generatedAt: Iso;
  company: { id: number; name: string; city: string | null; sector: string | null };
  pilot: {
    id: number;
    status: PilotStatus;
    useCase: string | null;
    language: string | null;
    qualificationCriteria: string | null;
    leadCount: number | null;
    onboardingStartedAt: Iso | null;
    campaignStartedAt: Iso | null;
    windowStart: Iso | null;
    windowEnd: Iso | null;
    reviewAt: Iso | null;
    completedAt: Iso | null;
  };
  dataAsOf: Iso | null;
  hasData: boolean;
  metrics: Record<string, ReportMetric>;
  rates: Record<string, ReportRate>;
  allowance: Omit<Allowance, "remaining">;
  extension: { attempts: number; reviewAt: Iso | null } | null;
  buyerFeedback: string | null;
  acceptedOutcomes: string | null;
  proposedNextStep: string | null;
  notes: string | null;
  recordingLinks: Array<{ url: string; label: string | null }>;
  rules: Record<string, string>;
};

export type ProposalAmounts = {
  monthlyFeePaise: number;
  monthlyTaxPaise: number;
  monthlyTotalPaise: number;
  setupFeePaise: number;
  setupTaxPaise: number;
  setupTotalPaise: number;
  firstInvoiceTotalPaise: number;
};
export type Proposal = {
  id: number;
  companyId: number;
  opportunityId: number | null;
  monthlyFeePaise: number;
  setupFeePaise: number;
  includedMinutes: number;
  scope: string | null;
  gstRateBps: number;
  status: "draft" | "sent" | "accepted" | "declined";
  termsAcceptedAt: Iso | null;
  termsAcceptedBy: string | null;
  sentAt: Iso | null;
  declinedAt: Iso | null;
  declineReason: string | null;
  createdAt: Iso;
  amounts: ProposalAmounts;
};

export type PaymentAdjustment = { id: number; paymentId: number; kind: "correction" | "refund"; feeDeltaPaise: number; taxDeltaPaise: number; reason: string; createdBy: number | null; createdAt: Iso };
export type Payment = {
  id: number;
  companyId: number;
  proposalId: number | null;
  subscriptionId: number | null;
  kind: (typeof PAYMENT_KINDS)[number];
  feePaise: number;
  taxPaise: number;
  reference: string | null;
  receivedAt: Iso;
  status: "recorded" | "verified" | "rejected";
  verifiedAt: Iso | null;
  verifiedBy: number | null;
  refundedPaise: number;
  notes: string | null;
  isDemo: boolean;
  createdAt: Iso;
  adjustments: PaymentAdjustment[];
  netFeePaise: number;
  netTaxPaise: number;
};

export type Subscription = {
  id: number;
  companyId: number;
  proposalId: number | null;
  monthlyFeePaise: number;
  includedMinutes: number;
  customerOwnerId: number | null;
  status: "active" | "paused" | "cancelled";
  startDate: string | null;
  liveAt: Iso | null;
  renewalDate: string | null;
  onboardingChecks: Record<string, boolean> | null;
  pausedAt: Iso | null;
  cancelledAt: Iso | null;
  cancelReason: string | null;
  isDemo: boolean;
  createdAt: Iso;
};

export type FirstResponse = {
  enquiredAt: Iso;
  dueAt: Iso;
  respondedAt: Iso | null;
  responseActivityId: number | null;
  responseType: string | null;
  businessMinutes: number | null;
  elapsedBusinessMinutes: number | null;
  targetMinutes: number;
  withinTarget: boolean | null;
  overdue: boolean;
  rule: string;
};

export type Touchpoint = {
  id: number;
  companyId: number;
  kind: "original" | "webhook" | "import" | "manual";
  source: string | null;
  campaign: string | null;
  occurredAt: Iso;
  eventId: string | null;
  permissionEvidence: string | null;
  details: Record<string, unknown> | null;
  isDemo: boolean;
  createdBy: number | null;
  createdAt: Iso;
};

export type DedupeReviewResult =
  | { action: "keep_separate"; companyId: number }
  | { action: "merge"; companyId: number; mergedCompanyId: number; moved: { contacts: number; activities: number; tasks: number; touchpoints: number } };

export type GenerateTargetsResult = { from: string; to: string; created: { daily: number; milestones: number }; skippedExisting: number };

export type CompanyDetail = {
  company: Company;
  owner: { id: number; name: string } | null;
  duplicateOf: { id: number; name: string } | null;
  contacts: Contact[];
  opportunity: Opportunity | null;
  opportunities: Opportunity[];
  stageHistory: StageHistory[];
  activities: Activity[];
  tasks: Task[];
  touchpoints: Touchpoint[];
  pilots: Pilot[];
  proposals: Proposal[];
  payments: Payment[];
  subscription: Subscription | null;
  subscriptions: Subscription[];
  firstResponse: FirstResponse | null;
  notes: { internal: string | null; customerFacing: string | null };
};

export type TodayAction = {
  priority: number;
  kind: "overdue_task" | "appointment" | "inbound_lead";
  title: string;
  companyId: number | null;
  companyName: string | null;
  taskId: number | null;
  activityId: number | null;
  pilotId: number | null;
  at: Iso | null;
  ageMinutes: number | null;
};

export type TodayView = {
  date: string;
  timezone: string;
  scope: "mine" | "team";
  ownerId: number | null;
  demo: boolean;
  sprint: { start: string; end: string };
  newPaying: {
    sprintToDate: number;
    selectedDay: number;
    period: { from: string; to: string };
    operating: GoalProgress;
    stretch: GoalProgress;
    milestone: { date: string; operatingPaid: number; stretchPaid: number; operatingProgress: Ratio; stretchProgress: Ratio } | null;
  };
  revenue: {
    activeMrrPaise: number;
    activeSubscriptions: number;
    overdueMrrPaise: number;
    overdueSubscriptions: number;
    mrrRule: string;
    stretchMrr: GoalProgress;
    cashCollected: { sprintToDate: CashTotals; selectedDay: CashTotals };
  };
  activity: {
    date: string;
    dayType: string | null;
    isReviewDay: boolean;
    actual: { visits: number; firstVisits: number; conversations: number; demos: number; pilots: number };
    target: { visits: number; conversations: number; demos: number; pilots: number } | null;
    ranges: { conversations: { min: number; max: number }; demos: { min: number; max: number } };
    progress: Record<"visits" | "conversations" | "demos" | "pilots", Ratio>;
  };
  activePilots: { count: number; teamCount: number; capacity: number; utilization: Ratio; atCapacity: boolean };
  overdueFollowUps: Array<{ id: number; title: string; kind: string; dueAt: Iso | null; ownerId: number | null; companyId: number | null; companyName: string | null; overdueMinutes: number | null }>;
  todaysAppointments: Array<{ kind: string; activityId: number | null; pilotId: number | null; at: Iso; ownerId: number | null; companyId: number; companyName: string; contactId: number | null }>;
  unassignedInbound: Array<{
    id: number;
    name: string;
    source: string | null;
    sourceCampaign: string | null;
    city: string | null;
    enquiredAt: Iso;
    ageMinutes: number;
    businessAgeMinutes: number;
    responseDueAt: Iso;
    breachedResponseTarget: boolean;
  }>;
  upcomingRenewals: Array<{ subscriptionId: number; companyId: number; companyName: string; renewalDate: string; monthlyFeePaise: number; customerOwnerId: number | null }>;
  nextActions: { missing: number; overdue: number; rule: string };
  actions: TodayAction[];
};

export type CalendarEvent = {
  type: CalendarType;
  key: string;
  title: string;
  start: Iso;
  allDay: boolean;
  date: string | null;
  status: string | null;
  ownerId: number | null;
  companyId: number | null;
  companyName: string | null;
  activityId?: number;
  pilotId?: number;
  taskId?: number;
  subscriptionId?: number;
  details?: Record<string, unknown>;
};
export type CalendarView = { from: string; to: string; timezone: string; scope: string; ownerId: number | null; demo: boolean; types: string[]; events: CalendarEvent[] };

type ActivityCounts = { visits: number; firstVisits: number; conversations: number; demos: number; pilotsStarted: number; newPaid: number };
export type ReportsView = {
  from: string;
  to: string;
  timezone: string;
  demo: boolean;
  groupBy: string | null;
  activity: { totals: ActivityCounts; groups: Array<{ key: string } & ActivityCounts> | null; newPilotRule: string };
  funnel: { note: string; steps: Array<{ stage: string; count: number; fromPrevious: Rate | null }> };
  stageAgeing: { asOf: Iso; buckets: string[]; stages: Array<{ stage: string; total: number; buckets: Record<string, number> }> };
  lossReasons: Array<{ reason: string; count: number }>;
  pilotCosts: { pilotsStarted: number; snapshotCostPaise: number; pilotCostExpensesPaise: number; totalPaise: number; perPilotPaise: number | null; rule: string };
  cash: CashTotals & { byKind: Record<string, CashTotals>; rule: string };
  newPaidClients: { count: number; rule: string; items: Array<{ companyId: number; name: string; firstPaidAt: Iso; source: string | null }> };
  newLive: { count: number; rule: string; items: Array<{ subscriptionId: number; companyId: number; name: string | null; liveAt: Iso; status: string }> };
  mrr: { asOfDate: string; activeMrrPaise: number; activeSubscriptions: number; overdueMrrPaise: number; overdueSubscriptions: number; mrrRule: string };
  renewals: {
    dueInPeriod: number;
    overdue: number;
    upcoming: number;
    verifiedRenewalPayments: number;
    verifiedRenewalFeePaise: number;
    items: Array<{ subscriptionId: number; companyId: number; companyName: string | null; renewalDate: string; monthlyFeePaise: number; status: string }>;
    rule: string;
  };
  pilotCohorts: {
    kind: "week" | "month";
    rule: string;
    cohorts: Array<{ cohortStart: string; cohortAgeDays: number; started: number; active: number; completed: number; cancelled: number; converted: number; pending: number; extensions: number; conversionRate: Rate }>;
  };
  acquisitionCost: { includedExpenseCategories: string[]; label: string; bySource: Array<{ source: string; spendPaise: number; newPaid: number; costPerNewPaidPaise: number | null }> };
  targets: {
    note: string;
    days: number;
    visits: { target: number; actual: number; progress: Ratio };
    conversations: { target: number; actual: number; progress: Ratio };
    demos: { target: number; actual: number; progress: Ratio };
    pilots: { target: number; actual: number; progress: Ratio };
    goals: SalesConfig["goals"];
  };
  forecast: {
    label: string;
    assumptions: SalesConfig["forecast"]["assumptions"];
    inputs: { remainingSprintFrom: string; sprintEnd: string; remainingTargetVisits: number; activePilotsNow: number; method: string };
    missingAssumptions: string[];
    projected: Record<string, number> | null;
  };
};

export type Expense = {
  id: number;
  date: string;
  category: (typeof EXPENSE_CATEGORIES)[number];
  isAcquisition: boolean;
  source: string | null;
  sourceCampaign: string | null;
  amountPaise: number;
  description: string | null;
  isDemo: boolean;
  createdAt: Iso;
};

export type LeadDecision = "create" | "update" | "skip" | "review" | "reject";
export type LeadPlanRow = { row: number; decision: LeadDecision; reason: string; name: string | null; matchedCompanyId: number | null; matchedOn: string | null; updates: string[] };
export type LeadPreview = { counts: Record<LeadDecision, number>; rows: LeadPlanRow[] };
export type LeadCommit = { importId: number; counts: Record<LeadDecision, number>; results: Array<{ row: number; decision: LeadDecision; companyId: number | null; reason: string }> };
export type SnapshotImportResult = { importId: number; pilotId: number; rows: number; created: number; corrected: number; unchanged: number; rejected: Array<{ row: number; reason: string }>; pilot: Pilot };
