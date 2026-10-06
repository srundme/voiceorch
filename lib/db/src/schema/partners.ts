import { pgTable, text, serial, timestamp, integer, index, jsonb, customType } from "drizzle-orm/pg-core";

/** Raw binary column (PostgreSQL `bytea`) stored/returned as a Node Buffer. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

/**
 * Partners — resellers who onboard and manage their own client accounts.
 *
 * A partner IS a regular user (userId = clerk id) with an extra partner row.
 * Pricing model (spread): the platform charges the partner `baseRateCentsPerMin`
 * for every client-minute; the partner sets a per-client rate (>= base). The
 * client wallet is debited at the client rate and the spread is credited to
 * the partner's wallet on every billed call.
 *
 * All *Cents columns store INR paise (see lib/money-inr.ts in api-server).
 */
export const partnersTable = pgTable("partners", {
  id: serial("id").primaryKey(),
  /** Clerk id of the partner's own user account. */
  userId: text("user_id").notNull().unique("partners_user_id_unique"),
  companyName: text("company_name").notNull(),
  /** active | suspended — suspended partners' clients bill at the standard flat rate (no spread). */
  status: text("status").notNull().default("active"),
  /** What the platform charges the partner per client-minute (paise). */
  baseRateCentsPerMin: integer("base_rate_cents_per_min").notNull().default(500),
  /** Pre-filled rate for newly linked clients (paise / min). */
  defaultClientRateCentsPerMin: integer("default_client_rate_cents_per_min").notNull().default(500),
  /**
   * Maximum concurrent active calls allowed across all client accounts of this partner.
   * Admin sets this capacity ceiling (e.g. 50, 100).
   */
  concurrentLimit: integer("concurrent_limit").notNull().default(10),
  /** Optional white-label logo shown on the partner's clients' dashboards. */
  logoData: bytea("logo_data"),
  logoMime: text("logo_mime"),
  /** Unguessable capability token for the public logo URL. */
  logoToken: text("logo_token").unique("partners_logo_token_unique"),
  /** Custom headline on the white-label login gateway (null → default from company name). */
  loginTitle: text("login_title"),
  /** Supporting copy under the login headline. */
  loginSubtitle: text("login_subtitle"),
  /**
   * White-label subdomain slug → `{slug}.{PARTNER_SUBDOMAIN_ROOT}`
   * e.g. slug "acme" → acme.snapserve.ai
   */
  /**
   * Custom referral / affiliate code for word-of-mouth client signups (e.g. "SANJAY").
   * Unique, case-insensitive lookup.
   */
  referralCode: text("referral_code").unique("partners_referral_code_unique"),
  /**
   * White-label subdomain slug → `{slug}.{PARTNER_SUBDOMAIN_ROOT}`
   * e.g. slug "acme" → acme.snapserve.ai
   */
  slug: text("slug").unique("partners_slug_unique"),
  /** Partner-owned hostname (e.g. app.acme.com). */
  customDomain: text("custom_domain").unique("partners_custom_domain_unique"),
  /** none | pending | active | failed */
  customDomainStatus: text("custom_domain_status").notNull().default("none"),
  /** TXT / verify token for custom-domain DNS proof. */
  domainVerifyToken: text("domain_verify_token"),
  customDomainVerifiedAt: timestamp("custom_domain_verified_at", { withTimezone: true }),
  /** Display name on client emails, e.g. "Acme". */
  mailFromName: text("mail_from_name"),
  /** From address on client emails, e.g. noreply@acme.com. Domain must be DKIM-authenticated. */
  mailFromEmail: text("mail_from_email"),
  /** none | pending | verified | failed */
  mailDomainStatus: text("mail_domain_status").notNull().default("none"),
  /** Brevo DNS records the partner must add (brevo_code / DKIM / DMARC). */
  mailDnsRecords: jsonb("mail_dns_records").$type<Array<{
    key: string;
    host: string;
    type: string;
    value: string;
    ok: boolean;
  }>>(),
  mailDomainVerifiedAt: timestamp("mail_domain_verified_at", { withTimezone: true }),
  /** Shown to managed clients instead of support@snapserve.ai */
  supportEmail: text("support_email"),
  supportUrl: text("support_url"),
  docsUrl: text("docs_url"),
  termsUrl: text("terms_url"),
  privacyUrl: text("privacy_url"),
  /**
   * Max agents any single client of this partner may create.
   * null = no limit (unlimited). Enforced at POST /agents in the API.
   */
  maxAgents: integer("max_agents"),
  /**
   * Max client accounts this partner may onboard via POST /partner/clients.
   * null = no limit (unlimited).
   */
  maxClients: integer("max_clients"),
  /** Default permission template for newly onboarded clients of this partner. */
  defaultClientPermissions: jsonb("default_client_permissions").$type<{
    navVisibility?: {
      agents?: boolean;
      knowledge?: boolean;
      squads?: boolean;
      phoneNumbers?: boolean;
      campaigns?: boolean;
      flows?: boolean;
      connections?: boolean;
      bookings?: boolean;
      callLogs?: boolean;
      analytics?: boolean;
      developers?: boolean;
      settings?: boolean;
      billing?: boolean;
    };
    mode?: "full" | "read_only";
  }>(),
  /**
   * Affiliate & Referral Program Configuration
   */
  /** Cookie / click tracking duration (days) until signup. */
  referralAttributionDays: integer("referral_attribution_days").notNull().default(60),
  /** Partner commission share (%) from each wallet recharge. */
  referralCommissionPercent: integer("referral_commission_percent").notNull().default(10),
  /** Number of months from user signup during which recharges yield commission. */
  referralCommissionMonths: integer("referral_commission_months").notNull().default(6),
  /**
   * Option A milestone: Minimum unique recharging users required before accumulated
   * referral commissions unlock into the partner's wallet balance.
   */
  referralMinRechargedUsers: integer("referral_min_recharged_users").notNull().default(10),
  /** Extra bonus credit (%) given to the referred user on their 1st recharge. */
  referralAudienceBonusPercent: integer("referral_audience_bonus_percent").notNull().default(10),
  /** Free call minutes gifted to referred user at signup (e.g. 100 free minutes). */
  referralAudienceFreeMinutes: integer("referral_audience_free_minutes").notNull().default(100),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

/**
 * Partner client invites. The invited person clicks the emailed link, signs
 * in (or signs up), and explicitly accepts — acceptance links users.partnerId.
 */
export const partnerInvitesTable = pgTable("partner_invites", {
  id: serial("id").primaryKey(),
  partnerId: integer("partner_id").notNull().references(() => partnersTable.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  name: text("name"),
  /** Per-client rate the partner picked at invite time (paise / min); null → partner default at accept. */
  rateCentsPerMin: integer("rate_cents_per_min"),
  /** pending | accepted | revoked */
  status: text("status").notNull().default("pending"),
  token: text("token").notNull().unique("partner_invites_token_unique"),
  invitedAt: timestamp("invited_at", { withTimezone: true }).notNull().defaultNow(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  /** Clerk id of the user who accepted. */
  acceptedUserId: text("accepted_user_id"),
}, (t) => [
  index("partner_invites_partner_id_idx").on(t.partnerId),
]);

/**
 * Walk-in signups who entered or clicked a partner's affiliate referral code (e.g. SANJAY).
 */
export const partnerReferralsTable = pgTable("partner_referrals", {
  id: serial("id").primaryKey(),
  partnerId: integer("partner_id").notNull().references(() => partnersTable.id, { onDelete: "cascade" }),
  referralCode: text("referral_code").notNull(),
  userId: text("user_id").notNull(), // clerk id of user
  userEmail: text("user_email"),
  userName: text("user_name"),
  status: text("status").notNull().default("signed_up"), // signed_up | onboarded | active
  /** Date of user's first completed wallet recharge. */
  firstRechargeAt: timestamp("first_recharge_at", { withTimezone: true }),
  /** Total count of wallet recharges made by this referred user. */
  rechargeCount: integer("recharge_count").notNull().default(0),
  /** Total cumulative amount (paise) recharged by this referred user. */
  totalRechargedPaise: integer("total_recharged_paise").notNull().default(0),
  /** Total cumulative commission (paise) earned by the partner from this user. */
  totalEarnedPaise: integer("total_earned_paise").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("partner_referrals_partner_id_idx").on(t.partnerId),
  index("partner_referrals_code_idx").on(t.referralCode),
  index("partner_referrals_user_id_idx").on(t.userId),
]);

/**
 * Detailed ledger of commissions earned by a partner from referred users' wallet recharges.
 * Supports Option A: status stays "pending" until partner reaches referralMinRechargedUsers,
 * after which pending rows flip to "credited" and deposit into the partner's wallet.
 */
export const partnerReferralEarningsTable = pgTable("partner_referral_earnings", {
  id: serial("id").primaryKey(),
  partnerId: integer("partner_id").notNull().references(() => partnersTable.id, { onDelete: "cascade" }),
  referralId: integer("referral_id").references(() => partnerReferralsTable.id, { onDelete: "set null" }),
  userId: text("user_id").notNull(), // clerkId of paying referred user
  rechargeTxnId: integer("recharge_txn_id"),
  rechargeAmountPaise: integer("recharge_amount_paise").notNull(),
  commissionPercent: integer("commission_percent").notNull().default(10),
  earnedPaise: integer("earned_paise").notNull(),
  status: text("status").notNull().default("pending"), // pending | credited
  creditedAt: timestamp("credited_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("partner_referral_earnings_partner_id_idx").on(t.partnerId),
  index("partner_referral_earnings_user_id_idx").on(t.userId),
  index("partner_referral_earnings_status_idx").on(t.status),
]);

/**
 * Admin-created partner setups for emails that have NO account yet.
 * Applied automatically at signup (services/partner-promotion.ts): the new
 * user immediately becomes a partner with these settings and the row is
 * removed. Email is stored lowercased.
 */
export const partnerPendingPromotionsTable = pgTable("partner_pending_promotions", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique("partner_pending_promotions_email_unique"),
  companyName: text("company_name").notNull(),
  baseRateCentsPerMin: integer("base_rate_cents_per_min").notNull().default(500),
  defaultClientRateCentsPerMin: integer("default_client_rate_cents_per_min").notNull().default(500),
  concurrentLimit: integer("concurrent_limit").notNull().default(10),
  referralCode: text("referral_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Partner = typeof partnersTable.$inferSelect;
export type InsertPartner = typeof partnersTable.$inferInsert;
export type PartnerInvite = typeof partnerInvitesTable.$inferSelect;
export type InsertPartnerInvite = typeof partnerInvitesTable.$inferInsert;
export type PartnerReferral = typeof partnerReferralsTable.$inferSelect;
export type InsertPartnerReferral = typeof partnerReferralsTable.$inferInsert;
export type PartnerReferralEarning = typeof partnerReferralEarningsTable.$inferSelect;
export type InsertPartnerReferralEarning = typeof partnerReferralEarningsTable.$inferInsert;
export type PartnerPendingPromotion = typeof partnerPendingPromotionsTable.$inferSelect;
