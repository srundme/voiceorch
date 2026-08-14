import { pgTable, text, serial, timestamp, integer, index, customType } from "drizzle-orm/pg-core";

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
  slug: text("slug").unique("partners_slug_unique"),
  /** Partner-owned hostname (e.g. app.acme.com). */
  customDomain: text("custom_domain").unique("partners_custom_domain_unique"),
  /** none | pending | active | failed */
  customDomainStatus: text("custom_domain_status").notNull().default("none"),
  /** TXT / verify token for custom-domain DNS proof. */
  domainVerifyToken: text("domain_verify_token"),
  customDomainVerifiedAt: timestamp("custom_domain_verified_at", { withTimezone: true }),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Partner = typeof partnersTable.$inferSelect;
export type InsertPartner = typeof partnersTable.$inferInsert;
export type PartnerInvite = typeof partnerInvitesTable.$inferSelect;
export type InsertPartnerInvite = typeof partnerInvitesTable.$inferInsert;
export type PartnerPendingPromotion = typeof partnerPendingPromotionsTable.$inferSelect;
