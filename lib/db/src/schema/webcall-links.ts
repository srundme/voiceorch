import {
  pgTable, serial, text, integer, boolean, timestamp, index,
} from "drizzle-orm/pg-core";
import { agentsTable } from "./agents";

/** Purpose stored on the per-agent website widget link. */
export const WEBSITE_EMBED_PURPOSE = "website-embed";
export const WEBSITE_EMBED_LABEL = "Website embed";

/**
 * Shareable webcall join links — guests open /join/:token without logging in.
 * Billing stays on the agent owner's wallet. The website widget uses a link
 * with purpose `website-embed`.
 */
export const webcallLinksTable = pgTable("webcall_links", {
  id: serial("id").primaryKey(),
  agentId: integer("agent_id").notNull().references(() => agentsTable.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  /** Opaque public token: /join/:token and WS ?share= */
  token: text("token").notNull().unique(),
  label: text("label"),
  /** Optional purpose shown on the join page (e.g. KYC, claim inspection). */
  purpose: text("purpose"),
  active: boolean("active").notNull().default(true),
  /** When true, join UI requires camera before connecting. */
  requireCamera: boolean("require_camera").notNull().default(false),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  maxUses: integer("max_uses"),
  useCount: integer("use_count").notNull().default(0),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("webcall_links_agent_id_idx").on(t.agentId),
  index("webcall_links_user_id_idx").on(t.userId),
  index("webcall_links_token_idx").on(t.token),
]);

export type WebcallLink = typeof webcallLinksTable.$inferSelect;
export type InsertWebcallLink = typeof webcallLinksTable.$inferInsert;
