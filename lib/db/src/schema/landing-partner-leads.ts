import { pgTable, serial, text, timestamp, index } from "drizzle-orm/pg-core";

/** Public landing-page "Partner with us" inquiries. */
export const landingPartnerLeadsTable = pgTable(
  "landing_partner_leads",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    company: text("company"),
    website: text("website"),
    role: text("role"),
    message: text("message"),
    source: text("source").notNull().default("landing"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    createdIdx: index("landing_partner_leads_created_idx").on(t.createdAt),
    emailIdx: index("landing_partner_leads_email_idx").on(t.email),
  }),
);

export type LandingPartnerLead = typeof landingPartnerLeadsTable.$inferSelect;
